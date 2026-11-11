package http

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
	"lms-router-control-plane/internal/domain"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

type mediaStreamClient interface {
	MediaInfo(context.Context, domain.Node, domain.NodeMediaRequest) (domain.MediaInfo, error)
	PrepareMedia(context.Context, domain.Node, domain.NodeMediaRequest) (domain.NodeMediaPreview, error)
	OpenMedia(context.Context, domain.Node, string, int, int, int) (*http.Response, error)
}
type mediaGrant struct {
	Node            domain.Node
	RemoteID, Token string
	Until           time.Time
}
type mediaGrants struct {
	mu      sync.Mutex
	entries map[string]mediaGrant
}

func newMediaGrants() *mediaGrants { return &mediaGrants{entries: make(map[string]mediaGrant)} }
func (g *mediaGrants) put(value mediaGrant) (string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	for k, v := range g.entries {
		if time.Now().After(v.Until) {
			delete(g.entries, k)
		}
	}
	if len(g.entries) >= 64 {
		return "", fmt.Errorf("слишком много открытых просмотров")
	}
	data := make([]byte, 32)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	id := base64.RawURLEncoding.EncodeToString(data)
	g.entries[id] = value
	return id, nil
}
func (g *mediaGrants) get(r *http.Request) (mediaGrant, bool) {
	id := strings.TrimPrefix(r.URL.Path, "/api/ui/media/stream/")
	g.mu.Lock()
	defer g.mu.Unlock()
	v, ok := g.entries[id]
	if ok && time.Now().After(v.Until) {
		delete(g.entries, id)
		ok = false
	}
	return v, ok
}
func (g *mediaGrants) token(r *http.Request) string {
	v, ok := g.get(r)
	if !ok {
		return ""
	}
	return v.Token
}

type mediaInfoRequest struct {
	domain.NodeMediaRequest
	NodeID *string `json:"nodeId,omitempty"`
}

func (h *Handler) mediaInspect(w http.ResponseWriter, r *http.Request) { h.mediaStart(w, r, false) }
func (h *Handler) mediaPrepare(w http.ResponseWriter, r *http.Request) { h.mediaStart(w, r, true) }
func (h *Handler) mediaStart(w http.ResponseWriter, r *http.Request, preview bool) {
	if r.Method != http.MethodPost {
		h.methodNotAllowed(w)
		return
	}
	if h.nodeRepo == nil {
		h.internalError(w, "node repository unavailable")
		return
	}
	client, ok := h.nodeClient.(mediaStreamClient)
	if !ok {
		writeJSON(w, 501, map[string]string{"error": "Нужна новая версия клиента и ноды LMS"})
		return
	}
	var req mediaInfoRequest
	if err := decodeJSON(r, &req); err != nil {
		h.badRequest(w, err.Error())
		return
	}
	u, err := url.Parse(req.URL)
	if err != nil || u.Host == "" || u.User != nil || (u.Scheme != "http" && u.Scheme != "https") || len(req.URL) > 16384 {
		h.badRequest(w, "Нужна HTTP(S)-ссылка без логина и пароля")
		return
	}
	if req.MaxHeight != nil && (*req.MaxHeight < 144 || *req.MaxHeight > 4320) || req.MaxFps != nil && (*req.MaxFps < 1 || *req.MaxFps > 240) {
		h.badRequest(w, "Недопустимое качество")
		return
	}
	if err := domain.ValidateNetworkRouteID(req.NetworkRouteID); err != nil {
		h.badRequest(w, err.Error())
		return
	}
	if err := domain.ValidateImpersonation(req.Impersonate); err != nil {
		h.badRequest(w, err.Error())
		return
	}
	token := tokenOf(r)
	if preview && h.accountProtected && !accountTokenPattern.MatchString(token) {
		writeJSON(w, 403, map[string]string{"error": "Для просмотра войдите через Account в расширении или веб-интерфейсе"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	candidates, err := h.extractCandidates(ctx, req.NodeID)
	if err != nil || len(candidates) == 0 {
		writeJSON(w, 409, map[string]string{"error": "Нет доступной ноды для просмотра"})
		return
	}
	node := candidates[0]
	if !node.Enabled {
		writeJSON(w, 409, map[string]string{"error": "Выбранная нода отключена"})
		return
	}
	if _, err := h.checkNetworkRoute(ctx, &node.ID, req.NetworkRouteID, domain.JobTypeYTDLP); err != nil {
		h.badRequest(w, err.Error())
		return
	}
	if err := h.checkMediaProfile(ctx, node, req.Impersonate); err != nil {
		writeJSON(w, 409, map[string]string{"error": err.Error()})
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	if !preview {
		info, err := client.MediaInfo(ctx, node, req.NodeMediaRequest)
		if err != nil {
			writeJSON(w, 502, map[string]string{"error": "Не удалось получить качество и размер видео на ноде"})
			return
		}
		writeJSON(w, 200, info)
		return
	}
	session, err := client.PrepareMedia(ctx, node, req.NodeMediaRequest)
	if err != nil {
		writeJSON(w, 502, map[string]string{"error": "Нода не смогла открыть поток. Проверьте доступ к источнику и обновление lms-node."})
		return
	}
	if len(session.SessionID) > 100 || session.SessionID == "" || strings.ContainsAny(session.SessionID, "/?#\\") {
		h.internalError(w, "Invalid node preview session")
		return
	}
	until := time.UnixMilli(session.ExpiresAt)
	if until.Before(time.Now()) || until.After(time.Now().Add(2*time.Hour+time.Minute)) {
		h.internalError(w, "Invalid preview expiry")
		return
	}
	id, err := h.mediaGrants.put(mediaGrant{Node: node, RemoteID: session.SessionID, Token: token, Until: until})
	if err != nil {
		writeJSON(w, 429, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"streamUrl": "/api/ui/media/stream/" + id, "expiresAt": session.ExpiresAt, "info": session.Info, "nodeName": node.Name})
}

func (h *Handler) mediaStream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		h.methodNotAllowed(w)
		return
	}
	grant, ok := h.mediaGrants.get(r)
	if !ok {
		writeJSON(w, 410, map[string]string{"error": "Сеанс просмотра завершён"})
		return
	}
	parse := func(key string, max int) (int, error) {
		v := r.URL.Query().Get(key)
		if v == "" {
			return 0, nil
		}
		n, e := strconv.Atoi(v)
		if e != nil || n < 0 || n > max {
			return 0, fmt.Errorf("invalid %s", key)
		}
		return n, nil
	}
	height, err := parse("height", 4320)
	if err != nil {
		h.badRequest(w, err.Error())
		return
	}
	start, err := parse("start", 604800)
	if err != nil {
		h.badRequest(w, err.Error())
		return
	}
	client, ok := h.nodeClient.(mediaStreamClient)
	if !ok {
		h.internalError(w, "preview client unavailable")
		return
	}
	ctx, cancel := context.WithDeadline(r.Context(), grant.Until)
	defer cancel()
	fps, err := parse("fps", 240)
	if err != nil {
		h.badRequest(w, err.Error())
		return
	}
	response, err := client.OpenMedia(ctx, grant.Node, grant.RemoteID, height, fps, start)
	if err != nil {
		writeJSON(w, 502, map[string]string{"error": "Поток недоступен на ноде"})
		return
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		writeJSON(w, response.StatusCode, map[string]string{"error": "Не удалось открыть поток на ноде"})
		return
	}
	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Accept-Ranges", "none")
	w.WriteHeader(200)
	_, _ = io.Copy(w, response.Body)
}
