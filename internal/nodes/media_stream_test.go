package nodes

import (
	"context"
	"io"
	"lms-router-control-plane/internal/domain"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestMediaStreamSignsPathAndForwardsSeekWithoutBuffering(t *testing.T) {
	now := time.Unix(1700000000, 0)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !verifyRequest(t, r, "secret", now.Unix()) {
			t.Error("signature invalid")
		}
		if r.URL.Path != "/api/media/preview/session" || r.URL.Query().Get("start") != "42" || r.URL.Query().Get("fps") != "30" {
			t.Error("wrong stream request")
		}
		w.Header().Set("Content-Type", "video/mp4")
		_, _ = w.Write([]byte("mp4"))
	}))
	defer server.Close()
	client := NewClient(ClientConfig{DefaultTimeout: time.Second, MaxAttempts: 1, Now: func() time.Time { return now }})
	response, err := client.OpenMedia(context.Background(), domain.Node{BaseURL: server.URL, ClientID: "router", Secret: "secret"}, "session", 720, 30, 42)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(response.Body)
	if string(data) != "mp4" {
		t.Fatal("stream lost")
	}
}
