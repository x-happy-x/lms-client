package sqlite

import (
	"context"
	"lms-router-control-plane/internal/domain"
	"testing"
	"time"
)

func TestNetworkRoutePersistsWithoutChangingOldJobs(t *testing.T) {
	db := setupTestDB(t)
	repo := NewJobRepository(db.SQL)
	ctx := context.Background()
	now := time.Now().UTC()
	job := domain.Job{ID: "route-test", CreatedAt: now, UpdatedAt: now, Type: domain.JobTypeDirect, URL: "https://course.test/file", Status: domain.JobStatusPaused, NetworkRouteID: "eu", NetworkRouteLabel: "Europe"}
	if err := repo.Create(ctx, job); err != nil {
		t.Fatal(err)
	}
	stored, err := repo.GetByID(ctx, job.ID)
	if err != nil || stored.NetworkRouteID != "eu" || stored.NetworkRouteLabel != "Europe" {
		t.Fatalf("route not persisted: %+v %v", stored, err)
	}
	stored.NetworkRouteID = ""
	stored.NetworkRouteLabel = ""
	if err := repo.Update(ctx, stored); err != nil {
		t.Fatal(err)
	}
	all, err := repo.List(ctx, false)
	if err != nil || len(all) != 1 || all[0].NetworkRouteID != "" {
		t.Fatal("default route not restored")
	}
}
