package http

import (
	"context"
	"encoding/json"
	"io"
	"lms-router-control-plane/internal/domain"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type previewStub struct {
	stubNodeClient
	opened             int
	height, fps, start int
}

func (s *previewStub) MediaInfo(context.Context, domain.Node, domain.NodeMediaRequest) (domain.MediaInfo, error) {
	return domain.MediaInfo{Height: 720}, nil
}
func (s *previewStub) PrepareMedia(context.Context, domain.Node, domain.NodeMediaRequest) (domain.NodeMediaPreview, error) {
	return domain.NodeMediaPreview{SessionID: "remote-session", ExpiresAt: time.Now().Add(time.Hour).UnixMilli(), Info: domain.MediaInfo{Height: 720}}, nil
}
func (s *previewStub) OpenMedia(_ context.Context, _ domain.Node, _ string, height, fps, start int) (*http.Response, error) {
	s.opened++
	s.height = height
	s.fps = fps
	s.start = start
	return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("fragmented-mp4-bytes"))}, nil
}

func TestPreviewGrantRevalidatesOwnerAndNeverReturnsAccountToken(t *testing.T) {
	status := 200
	account := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+testAccountToken {
			t.Error("owner token not forwarded to Account")
		}
		if status != 200 {
			w.WriteHeader(status)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"user": accountUser{Login: "tester", Role: "viewer"}, "app": "lms_node"})
	}))
	defer account.Close()
	client := &previewStub{}
	grants := newMediaGrants()
	id, err := grants.put(mediaGrant{Node: domain.Node{ID: "node"}, RemoteID: "session", Token: testAccountToken, Until: time.Now().Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	if len(id) != 43 || strings.Contains(id, testAccountToken) {
		t.Fatal("unsafe grant")
	}
	handler := &Handler{nodeClient: client, mediaGrants: grants}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/ui/media/stream/", handler.mediaStream)
	protected := withAccountStreams(mux, account.URL, "https://lms.example", "", grants.token)
	path := "/api/ui/media/stream/" + id
	w := authRequest(protected, "GET", path+"?height=720&fps=30&start=42", "", "")
	if w.Code != 200 || w.Body.String() != "fragmented-mp4-bytes" || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("stream: %d %s", w.Code, w.Body.String())
	}
	if client.height != 720 || client.fps != 30 || client.start != 42 {
		t.Fatal("seek or quality lost")
	}
	if w := authRequest(protected, "GET", path+"?start=-1", "", ""); w.Code != 400 {
		t.Fatalf("invalid seek accepted: %d", w.Code)
	}
	status = 401
	if w := authRequest(protected, "GET", path, "", ""); w.Code != 401 {
		t.Fatalf("revoked owner accepted: %d", w.Code)
	}
	if client.opened != 1 {
		t.Fatal("revoked request reached node")
	}
	if w := authRequest(protected, "GET", path+"extra", "", ""); w.Code != 401 {
		t.Fatal("grant prefix accepted")
	}
	expired, _ := grants.put(mediaGrant{Token: testAccountToken, Until: time.Now().Add(-time.Second)})
	if w := authRequest(protected, "GET", "/api/ui/media/stream/"+expired, "", ""); w.Code != 401 {
		t.Fatal("expired grant accepted")
	}
}

func TestViewerCanInspectAndPrepareButCannotCreateJobs(t *testing.T) {
	account := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"user": accountUser{Login: "viewer", Role: "viewer"}, "app": "lms_node"})
	}))
	defer account.Close()
	mux := http.NewServeMux()
	for _, path := range []string{"/api/ui/media/info", "/api/ui/media/preview", "/api/ui/jobs"} {
		mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
	}
	h := withAccount(mux, account.URL, "https://lms.example", "")
	for _, path := range []string{"/api/ui/media/info", "/api/ui/media/preview"} {
		if w := authRequest(h, "POST", path, testAccountToken, ""); w.Code != 204 {
			t.Fatalf("viewer read rejected %s: %d", path, w.Code)
		}
	}
	if w := authRequest(h, "POST", "/api/ui/jobs", testAccountToken, ""); w.Code != 403 {
		t.Fatal("viewer could create job")
	}
}
