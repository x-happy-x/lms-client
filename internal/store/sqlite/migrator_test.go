package sqlite

import (
	"context"
	"path/filepath"
	"testing"

	"lms-router-control-plane/internal/app/config"
)

func TestRunMigrationsIsIdempotent(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "router.db")

	db, err := Open(ctx, config.SQLiteConfig{
		Path:          dbPath,
		BusyTimeoutMS: 5000,
	})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	if err := RunMigrations(ctx, db.SQL); err != nil {
		t.Fatalf("first migration run failed: %v", err)
	}
	if err := RunMigrations(ctx, db.SQL); err != nil {
		t.Fatalf("second migration run failed: %v", err)
	}

	var count int
	if err := db.SQL.QueryRowContext(ctx, "SELECT COUNT(1) FROM schema_migrations").Scan(&count); err != nil {
		t.Fatalf("count schema_migrations: %v", err)
	}
	if count != 3 {
		t.Fatalf("expected 3 migration rows, got %d", count)
	}

	if _, err := db.SQL.ExecContext(ctx, "INSERT INTO jobs (id, created_at, updated_at, type, url, status) VALUES ('j1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'DIRECT', 'https://example.com/file.bin', 'QUEUED')"); err != nil {
		t.Fatalf("jobs table is missing or invalid: %v", err)
	}
}
