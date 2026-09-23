package sqlite

import (
	"context"
	"testing"
	"time"

	"lms-router-control-plane/internal/domain"
)

func TestNodeRepositoryCRUD(t *testing.T) {
	t.Parallel()

	db := setupTestDB(t)
	repo := NewNodeRepository(db.SQL)
	ctx := context.Background()
	now := time.Date(2026, 3, 8, 20, 0, 0, 0, time.UTC)
	caps := `{"types":["DIRECT"]}`

	node := domain.Node{
		ID:        "node-1",
		Name:      "home-node",
		BaseURL:   "https://node.lan",
		ClientID:  "router-main",
		Secret:    "s3cr3t",
		Enabled:   true,
		CapsJSON:  &caps,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := repo.Create(ctx, node); err != nil {
		t.Fatalf("create node: %v", err)
	}

	list, err := repo.ListEnabled(ctx)
	if err != nil {
		t.Fatalf("list enabled nodes: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 enabled node, got %d", len(list))
	}

	stored, err := repo.GetByID(ctx, node.ID)
	if err != nil {
		t.Fatalf("get node: %v", err)
	}
	stored.Enabled = false
	stored.UpdatedAt = now.Add(time.Second)
	if err := repo.Update(ctx, stored); err != nil {
		t.Fatalf("update node: %v", err)
	}

	enabled, err := repo.ListEnabled(ctx)
	if err != nil {
		t.Fatalf("list enabled nodes after disable: %v", err)
	}
	if len(enabled) != 0 {
		t.Fatalf("expected 0 enabled nodes, got %d", len(enabled))
	}
}

func TestProfileRepositoryCRUD(t *testing.T) {
	t.Parallel()

	db := setupTestDB(t)
	repo := NewProfileRepository(db.SQL)
	ctx := context.Background()
	now := time.Date(2026, 3, 8, 20, 0, 0, 0, time.UTC)
	extra := `{"cookie":"on"}`

	profile := domain.Profile{
		ID:            "profile-1",
		Name:          "youtube-default",
		Type:          "YTDLP",
		ExtraArgsJSON: &extra,
		Enabled:       true,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	if err := repo.Create(ctx, profile); err != nil {
		t.Fatalf("create profile: %v", err)
	}

	list, err := repo.ListEnabled(ctx)
	if err != nil {
		t.Fatalf("list enabled profiles: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 enabled profile, got %d", len(list))
	}

	stored, err := repo.GetByID(ctx, profile.ID)
	if err != nil {
		t.Fatalf("get profile: %v", err)
	}
	stored.Enabled = false
	stored.UpdatedAt = now.Add(time.Second)
	if err := repo.Update(ctx, stored); err != nil {
		t.Fatalf("update profile: %v", err)
	}

	enabled, err := repo.ListEnabled(ctx)
	if err != nil {
		t.Fatalf("list enabled profiles after disable: %v", err)
	}
	if len(enabled) != 0 {
		t.Fatalf("expected 0 enabled profiles, got %d", len(enabled))
	}
}
