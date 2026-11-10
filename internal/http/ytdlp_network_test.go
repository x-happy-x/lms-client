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

type networkRepo struct{ domain.NodeRepository }

func (networkRepo) GetByID(context.Context, string) (domain.Node, error) {
	return domain.Node{ID: "test", Name: "Test", Enabled: true}, nil
}

type networkStub struct {
	previewStub
	profile    string
	diagnostic domain.NodeDiagnosticRequest
}

func (s *networkStub) MediaCapabilities(context.Context, domain.Node) (domain.NodeMediaCapabilities, error) {
	return domain.NodeMediaCapabilities{ImpersonationSupported: true, ImpersonationTargets: []string{"auto", "chrome", "chrome-152:windows-10"}, DiagnosticsSupported: true}, nil
}
func (s *networkStub) DiagnoseMedia(_ context.Context, _ domain.Node, request domain.NodeDiagnosticRequest) (domain.NodeDiagnosticResult, error) {
	s.diagnostic = request
	return domain.NodeDiagnosticResult{Command: []string{"yt-dlp", "--version"}, Stdout: "nightly", ExitCode: 0}, nil
}
func (s *networkStub) MediaInfo(_ context.Context, _ domain.Node, request domain.NodeMediaRequest) (domain.MediaInfo, error) {
	s.profile = request.Impersonate
	return domain.MediaInfo{Height: 720}, nil
}
func TestMediaProfileAndReadOnlyDiagnosticTransport(t *testing.T) {
	client := &networkStub{}
	handler := NewHandler(Dependencies{NodeRepo: networkRepo{}, NodeClient: client})
	request := func(method, path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	if w := request("GET", "/api/ui/media/capabilities?nodeId=test", ""); w.Code != 200 || !strings.Contains(w.Body.String(), "chrome-152:windows-10") {
		t.Fatalf("capabilities %d %s", w.Code, w.Body.String())
	}
	if w := request("POST", "/api/ui/media/info", `{"nodeId":"test","url":"https://course.test/lesson","impersonate":"chrome"}`); w.Code != 200 || client.profile != "chrome" {
		t.Fatalf("profile %d %s", w.Code, w.Body.String())
	}
	if w := request("POST", "/api/ui/media/info", `{"nodeId":"test","url":"https://course.test/lesson","impersonate":"firefox"}`); w.Code != 409 {
		t.Fatal("unavailable profile silently accepted")
	}
	if w := request("POST", "/api/ui/media/info", `{"nodeId":"test","url":"https://course.test/lesson","impersonate":"chrome --exec=evil"}`); w.Code != 400 {
		t.Fatal("invalid profile accepted")
	}
	if w := request("POST", "/api/ui/media/diagnose", `{"nodeId":"test","mode":"version"}`); w.Code != 200 || client.diagnostic.Mode != "version" || !strings.Contains(w.Body.String(), "nightly") {
		t.Fatalf("diagnostic %d %s", w.Code, w.Body.String())
	}
	for _, body := range []string{`{"nodeId":"test","mode":"download"}`, `{"nodeId":"test","mode":"formats","url":"file:///etc/passwd"}`} {
		if w := request("POST", "/api/ui/media/diagnose", body); w.Code != 400 {
			t.Fatal("unsafe diagnostic accepted")
		}
	}
}
func TestManualDiagnosticsRequireAppAdmin(t *testing.T) {
	role := "viewer"
	account := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"user": accountUser{Login: "tester", Role: role}, "app": "lms_node"})
	}))
	defer account.Close()
	mux := http.NewServeMux()
	mux.HandleFunc("/api/ui/media/diagnose", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
	mux.HandleFunc("/api/ui/media/capabilities", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
	h := withAccount(mux, account.URL, "https://lms.example", "")
	for _, value := range []string{"viewer", "editor"} {
		role = value
		if w := authRequest(h, "POST", "/api/ui/media/diagnose", testAccountToken, ""); w.Code != 403 {
			t.Fatal("non-admin diagnostic accepted")
		}
	}
	role = "viewer"
	if w := authRequest(h, "GET", "/api/ui/media/capabilities", testAccountToken, ""); w.Code != 204 {
		t.Fatal("viewer capabilities blocked")
	}
	role = "admin"
	if w := authRequest(h, "POST", "/api/ui/media/diagnose", testAccountToken, ""); w.Code != 204 {
		t.Fatal("admin diagnostic blocked")
	}
}
