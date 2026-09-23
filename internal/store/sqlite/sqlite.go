package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	"lms-router-control-plane/internal/app/config"

	_ "modernc.org/sqlite"
)

type DB struct {
	SQL *sql.DB
}

func Open(ctx context.Context, cfg config.SQLiteConfig) (*DB, error) {
	if err := ensureParentDir(cfg.Path); err != nil {
		return nil, err
	}

	db, err := sql.Open("sqlite", cfg.Path)
	if err != nil {
		return nil, err
	}

	if _, err := db.ExecContext(ctx, "PRAGMA journal_mode=WAL;"); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("set journal mode: %w", err)
	}

	if _, err := db.ExecContext(ctx, fmt.Sprintf("PRAGMA busy_timeout = %d;", cfg.BusyTimeoutMS)); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("set busy timeout: %w", err)
	}

	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}

	return &DB{SQL: db}, nil
}

func (db *DB) Close() error {
	return db.SQL.Close()
}

func ensureParentDir(dbPath string) error {
	parent := filepath.Dir(dbPath)
	if parent == "." || parent == "" {
		return nil
	}
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return fmt.Errorf("create sqlite directory %q: %w", parent, err)
	}
	return nil
}
