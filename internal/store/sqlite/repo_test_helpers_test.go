package sqlite

import (
	"context"
	"path/filepath"
	"testing"

	"lms-router-control-plane/internal/app/config"
)

func setupTestDB(t *testing.T) *DB {
	t.Helper()

	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "router.db")
	db, err := Open(ctx, config.SQLiteConfig{Path: dbPath, BusyTimeoutMS: 5000})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	if err := RunMigrations(ctx, db.SQL); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	return db
}
