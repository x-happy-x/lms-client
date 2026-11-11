package http

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"lms-router-control-plane/internal/domain"
	"net"
	"net/http"
	"net/url"
	"slices"
	"time"
)

type networkClient interface {
	NetworkRoutes(context.Context, domain.Node) (domain.NodeNetworkRoutes, error)
}

func (h *Handler) checkNetworkRoute(ctx context.Context, nodeID *string, routeID string, jobType domain.JobType) (string, error) {
	if err := domain.ValidateNetworkRouteID(routeID); err != nil {
		return "", err
	}
	if routeID == "" {
		return "", nil
	}
	if jobType == domain.JobTypeTorrent {
		return "", fmt.Errorf("Выбранный маршрут не поддерживает торренты")
	}
	if nodeID == nil || *nodeID == "" || h.nodeRepo == nil {
		return "", fmt.Errorf("Выберите ноду для маршрута")
	}
	client, ok := h.nodeClient.(networkClient)
	if !ok {
		return "", fmt.Errorf("Обновите роутер для выбора маршрута")
	}
	node, err := h.nodeRepo.GetByID(ctx, *nodeID)
	if err != nil || !node.Enabled {
		return "", fmt.Errorf("Нода недоступна")
	}
	routes, err := client.NetworkRoutes(ctx, node)
	if err != nil || !routes.NetworkRoutesSupported {
		return "", fmt.Errorf("Нода не сообщает маршруты; обновите lms-node")
	}
	for _, route := range routes.Routes {
		if route.ID == routeID && route.Available && (jobType == "" || slices.Contains(route.SupportedTypes, string(jobType))) {
			return route.Label, nil
		}
	}
	return "", fmt.Errorf("Выбранный маршрут недоступен на этой ноде")
}

func (h *Handler) networkRoutes(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		h.methodNotAllowed(w)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	var id *string
	if v := r.URL.Query().Get("nodeId"); v != "" {
		id = &v
	}
	node, err := h.networkNode(ctx, id)
	if err != nil {
		writeJSON(w, 409, map[string]string{"error": err.Error()})
		return
	}
	routeID := r.URL.Query().Get("networkRouteId")
	if err := domain.ValidateNetworkRouteID(routeID); err != nil {
		h.badRequest(w, err.Error())
		return
	}
	host := ""
	if raw := r.URL.Query().Get("url"); raw != "" {
		u, e := url.Parse(raw)
		if e != nil || u.User != nil || u.Hostname() == "" || (u.Scheme != "https" && u.Scheme != "http") {
			h.badRequest(w, "Нужна HTTP(S)-ссылка без логина и пароля")
			return
		}
		host = u.Hostname()
	}
	out := domain.NetworkRoutesResponse{NodeID: node.ID, Routes: []domain.NetworkRoute{}, Observed: []domain.NetworkObservation{}, CheckedAt: time.Now().UTC().Format(time.RFC3339), Planned: domain.NetworkPlan{State: "unknown", Label: "Маршрут не подтверждён", Scope: "download"}}
	client, ok := h.nodeClient.(networkClient)
	if ok {
		caps, e := client.NetworkRoutes(ctx, node)
		if e == nil && caps.NetworkRoutesSupported {
			out.Routes = caps.Routes
			out.CanSelect = caps.Enabled && len(caps.Routes) > 0
			out.Enabled = caps.Enabled
		} else {
			out.Message = "Нода не сообщает доступные маршруты"
		}
	} else {
		out.Message = "Обновите роутер для просмотра маршрутов"
	}
	if routeID != "" {
		label, e := h.checkNetworkRoute(ctx, &node.ID, routeID, "")
		if e != nil {
			writeJSON(w, 409, map[string]string{"error": e.Error()})
			return
		}
		out.Planned = domain.NetworkPlan{State: "configured", RouteID: routeID, Label: label, Scope: "download"}
	}
	if h.homeNetOrigin != "" && h.homeNetToken != "" {
		observed, e := h.homeNetEgress(ctx, node.ID, host)
		if e == nil {
			out.Enabled = true
			out.Observed = observed.Observed
			if routeID == "" {
				out.Planned = domain.NetworkPlan{State: "automatic", Label: "По правилам HomeNet", Scope: "download"}
			}
		} else {
			out.Message = "HomeNet не подтвердил текущие соединения. Выбранный маршрут применяется нодой."
		}
	} else if out.Message == "" {
		out.Message = "Наблюдение HomeNet не настроено. Показаны выделенные маршруты ноды."
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, out)
}
func (h *Handler) homeNetEgress(ctx context.Context, node, host string) (domain.NetworkRoutesResponse, error) {
	var out domain.NetworkRoutesResponse
	origin, err := url.Parse(h.homeNetOrigin)
	if err != nil || origin.User != nil || origin.Host == "" || (origin.Scheme != "http" && origin.Scheme != "https") || origin.Path != "" && origin.Path != "/" {
		return out, fmt.Errorf("invalid HomeNet configuration")
	}
	if origin.Fragment != "" {
		return out, fmt.Errorf("invalid HomeNet configuration")
	}
	if origin.Scheme == "http" {
		ip := net.ParseIP(origin.Hostname())
		if origin.Hostname() != "localhost" && (ip == nil || !ip.IsPrivate() && !ip.IsLoopback()) {
			return out, fmt.Errorf("HomeNet HTTP requires a private address")
		}
	}
	origin.Path = "/api/lms/egress"
	origin.RawQuery = url.Values{"node": {node}, "host": {host}}.Encode()
	req, err := http.NewRequestWithContext(ctx, "GET", origin.String(), nil)
	if err != nil {
		return out, err
	}
	req.Header.Set("Authorization", "Bearer "+h.homeNetToken)
	client := &http.Client{Timeout: 6 * time.Second, Transport: &http.Transport{Proxy: nil, ResponseHeaderTimeout: 6 * time.Second}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	defer client.CloseIdleConnections()
	res, err := client.Do(req)
	if err != nil {
		return out, fmt.Errorf("HomeNet unavailable")
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return out, fmt.Errorf("HomeNet unavailable")
	}
	err = json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&out)
	return out, err
}
