package http

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

type accountUser struct {
	Login string `json:"login"`
	Name  string `json:"name"`
	Role  string `json:"role"`
}
type accountPending struct {
	Verifier, Return string
	Until            time.Time
}
type accountAuth struct {
	origin, public string
	client         *http.Client
	mu             sync.Mutex
	pending        map[string]accountPending
}

var accountTokenPattern = regexp.MustCompile(`^kat_[0-9a-f]{48}$`)

func authOrigin(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") ||
		(u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost" || u.Hostname() == "::1"))) {
		return "", fmt.Errorf("Account and LMS origins require HTTPS (HTTP is allowed for loopback tests)")
	}
	return strings.TrimSuffix(u.String(), "/"), nil
}
func opaque() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func tokenOf(r *http.Request) string {
	if strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
		return strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	}
	if c, err := r.Cookie("lms_session"); err == nil {
		return c.Value
	}
	return ""
}
func (a *accountAuth) call(r *http.Request, method, path, token string, input, output any) int {
	var body io.Reader
	if input != nil {
		data, err := json.Marshal(input)
		if err != nil {
			return http.StatusBadRequest
		}
		body = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(r.Context(), method, a.origin+path, body)
	if err != nil {
		return http.StatusServiceUnavailable
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := a.client.Do(req)
	if err != nil {
		return http.StatusServiceUnavailable
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 500 {
		return http.StatusServiceUnavailable
	}
	if resp.StatusCode != http.StatusOK {
		return resp.StatusCode
	}
	if output != nil && json.NewDecoder(io.LimitReader(resp.Body, 65536)).Decode(output) != nil {
		return http.StatusServiceUnavailable
	}
	return http.StatusOK
}
func (a *accountAuth) identity(r *http.Request) (accountUser, int) {
	token := tokenOf(r)
	if !accountTokenPattern.MatchString(token) {
		return accountUser{}, http.StatusUnauthorized
	}
	var out struct {
		User accountUser `json:"user"`
		App  string      `json:"app"`
	}
	status := a.call(r, http.MethodGet, "/api/extensions/session", token, nil, &out)
	if status != 200 {
		return accountUser{}, status
	}
	if out.App != "lms_node" || out.User.Login == "" || (out.User.Role != "viewer" && out.User.Role != "editor" && out.User.Role != "admin") {
		return accountUser{}, http.StatusForbidden
	}
	return out.User, 200
}
func authError(w http.ResponseWriter, status int) {
	message := "Нет доступа к LMS"
	if status == 401 {
		message = "Войдите через Account"
	} else if status != 403 {
		status = 503
		message = "Account недоступен, повторите позже"
	}
	writeJSON(w, status, map[string]any{"error": message, "authRequired": status == 401})
}
func (a *accountAuth) wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if !strings.HasPrefix(path, "/api/ui/") || path == "/api/ui/auth/config" {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		user, status := a.identity(r)
		if status != 200 {
			authError(w, status)
			return
		}
		mutating := r.Method != http.MethodGet && r.Method != http.MethodHead
		if mutating && !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") && (a.public == "" || r.Header.Get("Origin") != a.public) {
			authError(w, 403)
			return
		}
		readPost := r.Method == http.MethodPost && (path == "/api/ui/media/extract" || path == "/api/ui/jobs/preflight" || (strings.HasPrefix(path, "/api/ui/nodes/") && strings.HasSuffix(path, "/storage/estimate")))
		if mutating && !readPost && path != "/api/ui/auth/logout" {
			if user.Role == "viewer" || ((strings.HasPrefix(path, "/api/ui/nodes") || strings.HasPrefix(path, "/api/ui/profiles")) && user.Role != "admin") {
				authError(w, 403)
				return
			}
		}
		if path == "/api/ui/auth/session" {
			if r.Method != http.MethodGet {
				w.WriteHeader(405)
				return
			}
			writeJSON(w, 200, map[string]any{"enabled": true, "user": user, "accountOrigin": a.origin})
			return
		}
		if path == "/api/ui/auth/logout" {
			if r.Method != http.MethodPost {
				w.WriteHeader(405)
				return
			}
			a.sessionCookie(w, "", -1)
			status = a.call(r, http.MethodDelete, "/api/extensions/session", tokenOf(r), nil, nil)
			if status != 200 && status != 401 {
				authError(w, status)
				return
			}
			writeJSON(w, 200, map[string]bool{"ok": true})
			return
		}
		next.ServeHTTP(w, r)
	})
}
func (a *accountAuth) sessionCookie(w http.ResponseWriter, token string, age int) {
	http.SetCookie(w, &http.Cookie{Name: "lms_session", Value: token, Path: "/", HttpOnly: true, Secure: strings.HasPrefix(a.public, "https://"), SameSite: http.SameSiteLaxMode, MaxAge: age})
}
func (a *accountAuth) login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(405)
		return
	}
	if a.public == "" {
		writeJSON(w, 503, map[string]string{"error": "ROUTERD_PUBLIC_ORIGIN is required for web login"})
		return
	}
	state, verifier := opaque(), opaque()
	back := r.URL.Query().Get("return")
	if !strings.HasPrefix(back, "/") || strings.HasPrefix(back, "//") || strings.ContainsAny(back, "\\\r\n") {
		back = "/"
	}
	a.mu.Lock()
	for key, value := range a.pending {
		if time.Now().After(value.Until) {
			delete(a.pending, key)
		}
	}
	if len(a.pending) >= 1000 {
		a.mu.Unlock()
		w.WriteHeader(429)
		return
	}
	a.pending[state] = accountPending{Verifier: verifier, Return: back, Until: time.Now().Add(10 * time.Minute)}
	a.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: "lms_auth_state", Value: state, Path: "/auth/", HttpOnly: true, Secure: strings.HasPrefix(a.public, "https://"), SameSite: http.SameSiteLaxMode, MaxAge: 600})
	challenge := sha256.Sum256([]byte(verifier))
	query := url.Values{"client_id": {"lms-web"}, "redirect_uri": {a.public + "/auth/callback"}, "state": {state}, "code_challenge": {base64.RawURLEncoding.EncodeToString(challenge[:])}, "code_challenge_method": {"S256"}}
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, a.origin+"/extensions/authorize?"+query.Encode(), 302)
}
func (a *accountAuth) callback(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	if r.Method != http.MethodGet {
		w.WriteHeader(405)
		return
	}
	state := r.URL.Query().Get("state")
	cookie, err := r.Cookie("lms_auth_state")
	if err != nil || len(state) < 32 || subtle.ConstantTimeCompare([]byte(state), []byte(cookie.Value)) != 1 {
		authError(w, 401)
		return
	}
	a.mu.Lock()
	pending, ok := a.pending[state]
	delete(a.pending, state)
	a.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: "lms_auth_state", Path: "/auth/", HttpOnly: true, MaxAge: -1})
	if !ok || time.Now().After(pending.Until) || r.URL.Query().Get("error") != "" {
		authError(w, 401)
		return
	}
	var result struct {
		Token   string `json:"access_token"`
		Expires int    `json:"expires_in"`
	}
	status := a.call(r, http.MethodPost, "/api/extensions/token", "", map[string]string{"grant_type": "authorization_code", "client_id": "lms-web", "redirect_uri": a.public + "/auth/callback", "code": r.URL.Query().Get("code"), "code_verifier": pending.Verifier}, &result)
	if status != 200 || !accountTokenPattern.MatchString(result.Token) || result.Expires <= 0 {
		authError(w, status)
		return
	}
	if result.Expires <= 0 || result.Expires > 30*86400 {
		result.Expires = 30 * 86400
	}
	a.sessionCookie(w, result.Token, result.Expires)
	http.Redirect(w, r, pending.Return, 302)
}
func withAccount(mux *http.ServeMux, origin, public string) http.Handler {
	if origin == "" {
		mux.HandleFunc("/api/ui/auth/config", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]bool{"enabled": false}) })
		return mux
	}
	origin, err := authOrigin(origin)
	if err != nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, 503, map[string]string{"error": "Invalid Account origin configuration"})
		})
	}
	if public != "" {
		public, err = authOrigin(public)
		if err != nil {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				writeJSON(w, 503, map[string]string{"error": "Invalid LMS public origin configuration"})
			})
		}
	}
	a := &accountAuth{origin: origin, public: public, pending: make(map[string]accountPending), client: &http.Client{Timeout: 4 * time.Second, CheckRedirect: func(r *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }}}
	mux.HandleFunc("/api/ui/auth/config", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.WriteHeader(405)
			return
		}
		writeJSON(w, 200, map[string]any{"enabled": true, "accountOrigin": a.origin})
	})
	mux.HandleFunc("/auth/login", a.login)
	mux.HandleFunc("/auth/callback", a.callback)
	return a.wrap(mux)
}
