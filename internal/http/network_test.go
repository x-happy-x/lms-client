package http

import (
	"context"
	"encoding/json"
	"lms-router-control-plane/internal/domain"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type routeStub struct {
	networkStub
	selected string
}

func (s *routeStub) NetworkRoutes(context.Context, domain.Node) (domain.NodeNetworkRoutes, error) {
	return domain.NodeNetworkRoutes{Enabled: true, NetworkRoutesSupported: true, Routes: []domain.NetworkRoute{{ID: "eu", Label: "Europe", Available: true, SupportedTypes: []string{"DIRECT", "YTDLP", "ARIA2C"}, Scope: "download"}}}, nil
}
func (s *routeStub) MediaInfo(_ context.Context, _ domain.Node, request domain.NodeMediaRequest) (domain.MediaInfo, error) {
	s.selected = request.NetworkRouteID
	return domain.MediaInfo{Height: 720}, nil
}
func TestNetworkRoutesSeparateConfiguredPlanFromObservedPath(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/lms/egress" || r.URL.Query().Get("node") != "test" || r.URL.Query().Get("host") != "course.test" || r.Header.Get("Authorization") != "Bearer fixture-private-token" || r.Header.Get("Origin") != "" {
			t.Error("scoped HomeNet request was changed")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"enabled":true,"observed":[{"host":"course.test","chains":["Actual exit","Europe"],"rule":"Domain","observedAt":"2026-11-11T10:00:00Z"}]}`))
	}))
	defer upstream.Close()
	client := &routeStub{}
	handler := NewHandler(Dependencies{NodeRepo: networkRepo{}, NodeClient: client, HomeNetOrigin: upstream.URL, HomeNetToken: "fixture-private-token"})
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/ui/network/routes?nodeId=test&url=https%3A%2F%2Fcourse.test%2Flesson&networkRouteId=eu", nil))
	var out domain.NetworkRoutesResponse
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &out) != nil {
		t.Fatalf("routes %d %s", w.Code, w.Body.String())
	}
	if !out.CanSelect || out.Planned.State != "configured" || out.Planned.Label != "Europe" || len(out.Observed) != 1 || out.Observed[0].Chains[0] != "Actual exit" {
		t.Fatalf("plan and observation lost: %+v", out)
	}
	if strings.Contains(w.Body.String(), "fixture-private-token") || strings.Contains(w.Body.String(), "proxyUrl") {
		t.Fatal("credential exposed")
	}
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("POST", "/api/ui/media/info", strings.NewReader(`{"nodeId":"test","url":"https://course.test/lesson","networkRouteId":"eu"}`)))
	if w.Code != 200 || client.selected != "eu" {
		t.Fatalf("metadata route not forwarded: %d", w.Code)
	}
	for _, id := range []string{"unknown", "http://foreign-proxy:1"} {
		if _, err := (&Handler{nodeRepo: networkRepo{}, nodeClient: client}).checkNetworkRoute(context.Background(), ptr("test"), id, domain.JobTypeDirect); err == nil {
			t.Fatal("unknown arbitrary route accepted")
		}
	}
	if _, err := (&Handler{nodeRepo: networkRepo{}, nodeClient: client}).checkNetworkRoute(context.Background(), ptr("test"), "eu", domain.JobTypeTorrent); err == nil {
		t.Fatal("torrent route accepted")
	}
}
func ptr(value string) *string { return &value }
func TestHomeNetDoesNotFollowCredentialRedirect(t *testing.T) {
	leaked := false
	foreign := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { leaked = true; w.Write([]byte(`{}`)) }))
	defer foreign.Close()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, foreign.URL, 302) }))
	defer upstream.Close()
	h := &Handler{homeNetOrigin: upstream.URL, homeNetToken: "fixture-token"}
	if _, err := h.homeNetEgress(context.Background(), "test", ""); err == nil {
		t.Fatal("redirect accepted")
	}
	if leaked {
		t.Fatal("HomeNet credential sent to redirect")
	}
}
