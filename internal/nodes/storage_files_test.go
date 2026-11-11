package nodes

import (
	"context"
	"encoding/json"
	"io"
	"lms-router-control-plane/internal/domain"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestStorageFilesUseSignedEncodedRequestsAndRanges(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Signature") == "" {
			t.Error("unsigned storage request")
		}
		if r.Method == "POST" {
			var body domain.StorageFileMutation
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body.Name != "Новое имя" {
				t.Error("mutation lost")
			}
			_, _ = w.Write([]byte(`{"path":"folder/new"}`))
			return
		}
		if r.URL.Query().Get("root") != "/mnt/disk 8tb" || r.URL.Query().Get("path") != "Уроки/a&b.mp4" {
			t.Error("path query corrupted")
		}
		if r.URL.Path == "/api/storage/browse" {
			_, _ = w.Write([]byte(`{"root":"/mnt/disk 8tb","path":"","entries":[]}`))
			return
		}
		if r.Header.Get("Range") != "bytes=0-3" {
			t.Error("range lost")
		}
		w.WriteHeader(206)
		_, _ = w.Write([]byte("data"))
	}))
	defer server.Close()
	client := NewClient(ClientConfig{MaxAttempts: 1})
	node := domain.Node{BaseURL: server.URL, ClientID: "test", Secret: "fixture"}
	if _, err := client.BrowseStorage(context.Background(), node, "/mnt/disk 8tb", "Уроки/a&b.mp4"); err != nil {
		t.Fatal(err)
	}
	resp, err := client.OpenStorageFile(context.Background(), node, "/mnt/disk 8tb", "Уроки/a&b.mp4", "GET", true, map[string]string{"Range": "bytes=0-3"})
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if string(body) != "data" || resp.StatusCode != 206 {
		t.Fatal("stream lost")
	}
	if _, err := client.MutateStorage(context.Background(), node, "rename", domain.StorageFileMutation{Name: "Новое имя"}); err != nil {
		t.Fatal(err)
	}
}
