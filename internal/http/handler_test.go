package http

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"lms-router-control-plane/internal/app/config"
	"lms-router-control-plane/internal/store/sqlite"
)

func TestSystemEndpoints(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "router.db")
	db, err := sqlite.Open(ctx, config.SQLiteConfig{
		Path:          dbPath,
		BusyTimeoutMS: 5000,
	})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	if err := sqlite.RunMigrations(ctx, db.SQL); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	server := httptest.NewServer(NewHandler(Dependencies{
		DB:      db.SQL,
		Version: "test-version",
	}))
	t.Cleanup(server.Close)

	t.Run("health", func(t *testing.T) {
		resp, err := http.Get(server.URL + "/api/ui/system/health")
		if err != nil {
			t.Fatalf("health request: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.StatusCode)
		}

		var body map[string]any
		if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
			t.Fatalf("decode health body: %v", err)
		}

		if body["status"] != "ok" {
			t.Fatalf("unexpected status: %v", body["status"])
		}
	})

	t.Run("version", func(t *testing.T) {
		resp, err := http.Get(server.URL + "/api/ui/system/version")
		if err != nil {
			t.Fatalf("version request: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.StatusCode)
		}

		var body map[string]string
		if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
			t.Fatalf("decode version body: %v", err)
		}

		if body["service"] != "routerd" {
			t.Fatalf("unexpected service: %s", body["service"])
		}
		if body["version"] != "test-version" {
			t.Fatalf("unexpected version: %s", body["version"])
		}
	})
}
