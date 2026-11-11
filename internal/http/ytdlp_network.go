package http

import (
	"context"
	"fmt"
	"lms-router-control-plane/internal/domain"
	"net/http"
	"net/url"
	"slices"
	"time"
)

type mediaNetworkClient interface {
	MediaCapabilities(context.Context, domain.Node) (domain.NodeMediaCapabilities, error)
	DiagnoseMedia(context.Context, domain.Node, domain.NodeDiagnosticRequest) (domain.NodeDiagnosticResult, error)
}

func (h *Handler) checkMediaProfile(ctx context.Context, node domain.Node, profile string) error {
	if profile == "" {
		return nil
	}
	client, ok := h.nodeClient.(mediaNetworkClient)
	if !ok {
		return fmt.Errorf("Обновите роутер для поддержки impersonation")
	}
	caps, err := client.MediaCapabilities(ctx, node)
	if err != nil || !caps.ImpersonationSupported {
		return fmt.Errorf("Нода не сообщает поддержку impersonation; обновите lms-node")
	}
	if !slices.Contains(caps.ImpersonationTargets, profile) {
		return fmt.Errorf("Выбранный профиль impersonation недоступен на этой ноде")
	}
	return nil
}
func (h *Handler) networkNode(ctx context.Context, id *string) (domain.Node, error) {
	if h.nodeRepo == nil {
		return domain.Node{}, fmt.Errorf("не настроены ноды")
	}
	candidates, err := h.extractCandidates(ctx, id)
	if err != nil || len(candidates) == 0 {
		return domain.Node{}, fmt.Errorf("нет доступной ноды yt-dlp")
	}
	if !candidates[0].Enabled {
		return domain.Node{}, fmt.Errorf("выбранная нода отключена")
	}
	return candidates[0], nil
}
func (h *Handler) mediaCapabilities(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		h.methodNotAllowed(w)
		return
	}
	client, ok := h.nodeClient.(mediaNetworkClient)
	if !ok {
		writeJSON(w, 501, map[string]string{"error": "Обновите роутер для настроек yt-dlp"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	var id *string
	if value := r.URL.Query().Get("nodeId"); value != "" {
		id = &value
	}
	node, err := h.networkNode(ctx, id)
	if err != nil {
		writeJSON(w, 409, map[string]string{"error": err.Error()})
		return
	}
	caps, err := client.MediaCapabilities(ctx, node)
	if err != nil {
		writeJSON(w, 502, map[string]string{"error": "Нода не сообщает настройки yt-dlp; обновите lms-node"})
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, struct {
		domain.NodeMediaCapabilities
		NodeID   string `json:"nodeId"`
		NodeName string `json:"nodeName"`
	}{caps, node.ID, node.Name})
}
func (h *Handler) mediaDiagnose(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.methodNotAllowed(w)
		return
	}
	client, ok := h.nodeClient.(mediaNetworkClient)
	if !ok {
		writeJSON(w, 501, map[string]string{"error": "Обновите роутер для диагностики yt-dlp"})
		return
	}
	var req struct {
		domain.NodeDiagnosticRequest
		NodeID *string `json:"nodeId,omitempty"`
	}
	if err := decodeJSON(r, &req); err != nil {
		h.badRequest(w, err.Error())
		return
	}
	if err := domain.ValidateImpersonation(req.Impersonate); err != nil {
		h.badRequest(w, err.Error())
		return
	}
	switch req.Mode {
	case "version", "profiles":
	case "formats", "json", "extract":
		source, err := url.Parse(req.URL)
		if err != nil || source.Host == "" || source.User != nil || len(req.URL) > 16384 || (source.Scheme != "http" && source.Scheme != "https") {
			h.badRequest(w, "Нужна HTTP(S)-ссылка без логина и пароля")
			return
		}
	default:
		h.badRequest(w, "Неизвестный режим диагностики")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	node, err := h.networkNode(ctx, req.NodeID)
	if err != nil {
		writeJSON(w, 409, map[string]string{"error": err.Error()})
		return
	}
	caps, err := client.MediaCapabilities(ctx, node)
	if err != nil || !caps.DiagnosticsSupported {
		writeJSON(w, 501, map[string]string{"error": "Нода не поддерживает диагностику; обновите lms-node"})
		return
	}
	if req.Mode != "version" && req.Mode != "profiles" {
		if _, err := h.checkNetworkRoute(ctx, &node.ID, req.NetworkRouteID, domain.JobTypeYTDLP); err != nil {
			h.badRequest(w, err.Error())
			return
		}
		if err := h.checkMediaProfile(ctx, node, req.Impersonate); err != nil {
			writeJSON(w, 409, map[string]string{"error": err.Error()})
			return
		}
	}
	result, err := client.DiagnoseMedia(ctx, node, req.NodeDiagnosticRequest)
	if err != nil {
		writeJSON(w, 502, map[string]string{"error": "Не удалось выполнить диагностику на ноде"})
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, struct {
		domain.NodeDiagnosticResult
		NodeName string `json:"nodeName"`
	}{result, node.Name})
}
