package nodes

import (
	"context"
	"encoding/json"
	"lms-router-control-plane/internal/domain"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestImpersonationAndDiagnosticsAreSignedJsonRequests(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Signature") == "" {
			t.Error("unsigned request")
		}
		var body map[string]any
		if r.Method == "POST" {
			_ = json.NewDecoder(r.Body).Decode(&body)
		}
		switch r.URL.Path {
		case "/api/media/capabilities":
			_ = json.NewEncoder(w).Encode(map[string]any{"impersonationSupported": true, "impersonationTargets": []string{"chrome"}, "diagnosticsSupported": true})
		case "/api/jobs/extract":
			if body["impersonate"] != "chrome" {
				t.Error("profile lost")
			}
			_, _ = w.Write([]byte(`{"kind":"video","url":"https://course.test"}`))
		case "/api/media/diagnose":
			if body["mode"] != "formats" || body["impersonate"] != "chrome" {
				t.Error("diagnostic lost")
			}
			_, _ = w.Write([]byte(`{"exitCode":0,"stdout":"formats"}`))
		default:
			t.Error("unexpected endpoint")
		}
	}))
	defer server.Close()
	client := NewClient(ClientConfig{MaxAttempts: 1})
	node := domain.Node{BaseURL: server.URL, ClientID: "test", Secret: "secret"}
	caps, err := client.MediaCapabilities(context.Background(), node)
	if err != nil || !caps.ImpersonationSupported {
		t.Fatal("capabilities lost", err)
	}
	if _, err := client.ExtractMediaWithOptions(context.Background(), node, "https://course.test", "chrome"); err != nil {
		t.Fatal(err)
	}
	result, err := client.DiagnoseMedia(context.Background(), node, domain.NodeDiagnosticRequest{Mode: "formats", URL: "https://course.test", Impersonate: "chrome"})
	if err != nil || result.Stdout != "formats" {
		t.Fatal("diagnostic lost", err)
	}
}
