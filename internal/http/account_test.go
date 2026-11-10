package http

import (
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

const testAccountToken = "kat_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

func TestAccountBasicPreservesHTTPSMobileClients(t *testing.T) {
	role, status, calls := "editor", 200, 0
	account := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/api/gateway/basic" || r.Header.Get("X-Gateway-Token") != "dedicated-test-credential" || r.Header.Get("Authorization") != "" {
			t.Error("wrong Basic validation channel")
		}
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["app"] != "lms_node" || body["login"] != "mobile" || body["password"] != "fixture-only-password" {
			t.Error("invalid credentials body")
		}
		if status != 200 {
			w.WriteHeader(status)
			return
		}
		_ = json.NewEncoder(w).Encode(accountUser{Login: "mobile", Role: role})
	}))
	defer account.Close()
	build := func(key string) http.Handler {
		mux := http.NewServeMux()
		mux.HandleFunc("/api/ui/jobs", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
		return withAccount(mux, account.URL, "https://lms.example", key)
	}
	h := build("dedicated-test-credential")
	request := func(handler http.Handler, method, peer, proto string, secure bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "/api/ui/jobs", nil)
		r.RemoteAddr = peer
		r.SetBasicAuth("mobile", "fixture-only-password")
		r.Header.Set("X-Forwarded-Proto", proto)
		if secure {
			r.TLS = &tls.ConnectionState{}
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	for _, tc := range []struct{ peer, proto string }{{"127.0.0.1:1000", "http"}, {"192.0.2.1:1000", "https"}} {
		if w := request(h, "GET", tc.peer, tc.proto, false); w.Code != 401 {
			t.Fatalf("insecure Basic: %d", w.Code)
		}
	}
	if calls != 0 {
		t.Fatal("insecure Basic reached Account")
	}
	if w := request(build(""), "GET", "127.0.0.1:1000", "https", false); w.Code != 401 || calls != 0 {
		t.Fatal("Basic enabled without service credential")
	}
	if w := request(h, "POST", "127.0.0.1:1000", "https", false); w.Code != 204 {
		t.Fatalf("mobile write %d", w.Code)
	}
	role = "viewer"
	if w := request(h, "POST", "127.0.0.1:1000", "https", false); w.Code != 403 {
		t.Fatalf("viewer write %d", w.Code)
	}
	if w := request(h, "GET", "192.0.2.1:1000", "", true); w.Code != 204 {
		t.Fatalf("real TLS read %d", w.Code)
	}
	for _, expected := range []int{401, 403, 429, 503} {
		status = expected
		if w := request(h, "GET", "127.0.0.1:1000", "https", false); w.Code != expected {
			t.Fatalf("status %d became %d", expected, w.Code)
		}
	}
}

func authRequest(h http.Handler, method, path, token, origin string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, nil)
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	for _, cookie := range cookies {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestAccountRolesRevocationAndCSRF(t *testing.T) {
	role, app, status := "viewer", "lms_node", 200
	account := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+testAccountToken {
			t.Error("missing scoped bearer")
		}
		if status != 200 {
			w.WriteHeader(status)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"user": accountUser{Login: "tester", Name: "Test", Role: role}, "app": app})
	}))
	defer account.Close()
	mux := http.NewServeMux()
	mux.HandleFunc("/api/ui/", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
	h := withAccount(mux, account.URL, "https://lms.example")
	if w := authRequest(h, "GET", "/api/ui/jobs", "", " "); w.Code != 401 || !strings.Contains(w.Body.String(), `"authRequired":true`) {
		t.Fatalf("anonymous: %d %s", w.Code, w.Body.String())
	}
	cases := []struct {
		role, method, path string
		status             int
	}{
		{"viewer", "GET", "/api/ui/jobs", 204},
		{"viewer", "POST", "/api/ui/jobs/preflight", 204},
		{"viewer", "POST", "/api/ui/media/extract", 204},
		{"viewer", "POST", "/api/ui/nodes/id/storage/estimate", 204},
		{"viewer", "POST", "/api/ui/jobs", 403},
		{"viewer", "DELETE", "/api/ui/jobs/id", 403},
		{"editor", "POST", "/api/ui/jobs", 204},
		{"editor", "PUT", "/api/ui/nodes/id", 403},
		{"editor", "POST", "/api/ui/profiles", 403},
		{"admin", "PUT", "/api/ui/nodes/id", 204},
	}
	for _, tc := range cases {
		t.Run(tc.role+tc.method+tc.path, func(t *testing.T) {
			role = tc.role
			w := authRequest(h, tc.method, tc.path, testAccountToken, "")
			if w.Code != tc.status {
				t.Fatalf("got %d want %d", w.Code, tc.status)
			}
		})
	}
	role = "editor"
	cookie := &http.Cookie{Name: "lms_session", Value: testAccountToken}
	for _, origin := range []string{"", "https://evil.example"} {
		if w := authRequest(h, "POST", "/api/ui/jobs", "", origin, cookie); w.Code != 403 {
			t.Fatalf("CSRF %s: %d", origin, w.Code)
		}
	}
	if w := authRequest(h, "POST", "/api/ui/jobs", "", "https://lms.example", cookie); w.Code != 204 {
		t.Fatalf("same-origin cookie: %d", w.Code)
	}
	w := authRequest(h, "GET", "/api/ui/auth/session", testAccountToken, "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"role":"editor"`) || strings.Contains(w.Body.String(), testAccountToken) || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("session: %d %s", w.Code, w.Body.String())
	}
	app = "other"
	if w := authRequest(h, "GET", "/api/ui/jobs", testAccountToken, ""); w.Code != 403 {
		t.Fatalf("wrong app %d", w.Code)
	}
	app = "lms_node"
	role = "none"
	if w := authRequest(h, "GET", "/api/ui/jobs", testAccountToken, ""); w.Code != 403 {
		t.Fatalf("removed role %d", w.Code)
	}
	role = "editor"
	status = 401
	if w := authRequest(h, "GET", "/api/ui/jobs", testAccountToken, ""); w.Code != 401 {
		t.Fatalf("revoked %d", w.Code)
	}
	status = 500
	if w := authRequest(h, "GET", "/api/ui/jobs", testAccountToken, ""); w.Code != 503 {
		t.Fatalf("outage %d", w.Code)
	}
}

func TestAccountWebLoginBindsStatePKCEAndRevokes(t *testing.T) {
	var challenge, callback string
	exchanges, revocations := 0, 0
	account := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/extensions/token":
			exchanges++
			var body map[string]string
			_ = json.NewDecoder(r.Body).Decode(&body)
			digest := sha256.Sum256([]byte(body["code_verifier"]))
			if base64.RawURLEncoding.EncodeToString(digest[:]) != challenge || body["redirect_uri"] != callback || body["client_id"] != "lms-web" || body["code"] != "valid-code" {
				t.Error("incorrect code exchange")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"access_token": testAccountToken, "expires_in": 3600})
		case "/api/extensions/session":
			if r.Method == "DELETE" {
				revocations++
				_, _ = w.Write([]byte(`{"ok":true}`))
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"user": accountUser{Login: "tester", Role: "editor"}, "app": "lms_node"})
		default:
			t.Errorf("unexpected Account path: %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer account.Close()
	h := withAccount(http.NewServeMux(), account.URL, "https://lms.example")
	login := authRequest(h, "GET", "/auth/login?return="+url.QueryEscape("//evil.example/"), "", "")
	target, err := url.Parse(login.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	q := target.Query()
	challenge = q.Get("code_challenge")
	callback = q.Get("redirect_uri")
	state := q.Get("state")
	if login.Code != 302 || target.Host != strings.TrimPrefix(account.URL, "http://") || q.Get("code_challenge_method") != "S256" || len(challenge) != 43 || len(state) != 43 {
		t.Fatalf("login redirect: %d %s", login.Code, target)
	}
	stateCookie := login.Result().Cookies()[0]
	if !stateCookie.HttpOnly || !stateCookie.Secure || stateCookie.SameSite != http.SameSiteLaxMode {
		t.Fatal("unsafe state cookie")
	}
	path := "/auth/callback?state=" + state + "&code=valid-code"
	if w := authRequest(h, "GET", path, "", ""); w.Code != 401 {
		t.Fatalf("unbound state: %d", w.Code)
	}
	success := authRequest(h, "GET", path, "", "", stateCookie)
	if success.Code != 302 || success.Header().Get("Location") != "/" || exchanges != 1 {
		t.Fatalf("callback: %d %s", success.Code, success.Body.String())
	}
	var session *http.Cookie
	for _, c := range success.Result().Cookies() {
		if c.Name == "lms_session" {
			session = c
		}
	}
	if session == nil || !session.HttpOnly || !session.Secure || session.Value != testAccountToken || session.MaxAge != 3600 {
		t.Fatal("unsafe session cookie")
	}
	if w := authRequest(h, "GET", path, "", "", stateCookie); w.Code != 401 || exchanges != 1 {
		t.Fatalf("state replay: %d", w.Code)
	}
	logout := authRequest(h, "POST", "/api/ui/auth/logout", "", "https://lms.example", session)
	if logout.Code != 200 || revocations != 1 || logout.Result().Cookies()[0].MaxAge != -1 {
		t.Fatalf("logout: %d %s", logout.Code, logout.Body.String())
	}
}

func TestAccountConfigurationFailsClosedAndDoesNotFollowRedirects(t *testing.T) {
	for _, origin := range []string{"http://account.example", "https://user:pass@account.example", "https://account.example/path"} {
		h := withAccount(http.NewServeMux(), origin, "")
		if w := authRequest(h, "GET", "/api/ui/jobs", testAccountToken, ""); w.Code != 503 {
			t.Fatalf("bad config %s: %d", origin, w.Code)
		}
	}
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("credential redirect followed") }))
	defer target.Close()
	account := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, 302) }))
	defer account.Close()
	h := withAccount(http.NewServeMux(), account.URL, "")
	if w := authRequest(h, "GET", "/api/ui/auth/config", "", ""); w.Code != 200 || strings.Contains(w.Body.String(), testAccountToken) {
		t.Fatal("public discovery failed")
	}
	if w := authRequest(h, "GET", "/api/ui/jobs", testAccountToken, ""); w.Code != 503 {
		t.Fatalf("redirect: %d", w.Code)
	}
	if w := authRequest(h, "GET", "/auth/login", "", ""); w.Code != 503 {
		t.Fatalf("missing public origin: %d", w.Code)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/ui/jobs", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
	legacy := withAccount(mux, "", "")
	if w := authRequest(legacy, "GET", "/api/ui/jobs", "", ""); w.Code != 204 {
		t.Fatal("legacy LAN mode changed")
	}
}
