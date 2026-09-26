package http

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	"lms-router-control-plane/internal/domain"
	"lms-router-control-plane/internal/nodes"
)

type mediaExtractRequest struct {
	URL    string  `json:"url"`
	NodeID *string `json:"nodeId,omitempty"`
}

type mediaExtractResponse struct {
	domain.NodeMediaExtractResponse
	NodeID   string `json:"nodeId"`
	NodeName string `json:"nodeName"`
}

// extractTimeout bounds the whole request: yt-dlp on the node may take a while on big playlists.
const extractTimeout = 2 * time.Minute

// extractMedia asks a node's yt-dlp which videos / playlist entries a page contains
// (POST /api/ui/media/extract). The node is the one given, or the fastest online node that
// can run yt-dlp; nodes that do not know the endpoint yet (older lms-node) are skipped.
func (h *Handler) extractMedia(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.methodNotAllowed(w)
		return
	}
	if h.nodeRepo == nil || h.nodeClient == nil {
		h.internalError(w, "node client is not configured")
		return
	}
	var req mediaExtractRequest
	if err := decodeJSON(r, &req); err != nil {
		h.badRequest(w, err.Error())
		return
	}
	req.URL = strings.TrimSpace(req.URL)
	if !strings.HasPrefix(strings.ToLower(req.URL), "http://") && !strings.HasPrefix(strings.ToLower(req.URL), "https://") {
		h.badRequest(w, "url must start with http:// or https://")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), extractTimeout)
	defer cancel()

	candidates, err := h.extractCandidates(ctx, req.NodeID)
	if err != nil {
		h.internalError(w, err.Error())
		return
	}
	if len(candidates) == 0 {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "нет нод в сети, которые умеют yt-dlp"})
		return
	}

	outdated := false
	for _, node := range candidates {
		result, err := h.nodeClient.ExtractMedia(ctx, node, req.URL)
		if err == nil {
			writeJSON(w, http.StatusOK, mediaExtractResponse{NodeMediaExtractResponse: result, NodeID: node.ID, NodeName: node.Name})
			return
		}
		var nodeErr *nodes.NodeError
		switch {
		case errors.As(err, &nodeErr):
			// yt-dlp itself failed on this URL: another node will not do better.
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": nodeErr.Message})
			return
		case errors.Is(err, nodes.ErrNotFound):
			outdated = true
			continue
		case ctx.Err() != nil:
			writeJSON(w, http.StatusGatewayTimeout, map[string]string{"error": "нода не ответила вовремя"})
			return
		default:
			continue
		}
	}
	if outdated {
		writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "ноды не умеют искать видео — обновите lms-node"})
		return
	}
	writeJSON(w, http.StatusBadGateway, map[string]string{"error": "ни одна нода не смогла разобрать ссылку"})
}

// extractCandidates returns the requested node, or online nodes that list YTDLP, fastest first.
func (h *Handler) extractCandidates(ctx context.Context, nodeID *string) ([]domain.Node, error) {
	if nodeID != nil && strings.TrimSpace(*nodeID) != "" {
		node, err := h.nodeRepo.GetByID(ctx, strings.TrimSpace(*nodeID))
		if err != nil {
			return nil, err
		}
		return []domain.Node{node}, nil
	}
	enabled, err := h.nodeRepo.ListEnabled(ctx)
	if err != nil {
		return nil, err
	}
	type candidate struct {
		node domain.Node
		ping int64
	}
	var online []candidate
	for _, node := range enabled {
		if !slices.Contains(parseAvailableTypes(node.CapsJSON), string(domain.JobTypeYTDLP)) {
			continue
		}
		status, _, ping := h.resolveNodeStatus(ctx, node)
		if status != "online" {
			continue
		}
		c := candidate{node: node}
		if ping != nil {
			c.ping = *ping
		}
		online = append(online, c)
	}
	slices.SortStableFunc(online, func(a, b candidate) int { return int(a.ping - b.ping) })
	out := make([]domain.Node, 0, len(online))
	for _, c := range online {
		out = append(out, c.node)
	}
	return out, nil
}
