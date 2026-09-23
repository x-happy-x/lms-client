package sqlite

import (
	"context"
	"testing"
	"time"

	"lms-router-control-plane/internal/domain"
)

func TestJobRepositoryCreateGetUpdateList(t *testing.T) {
	t.Parallel()

	db := setupTestDB(t)
	repo := NewJobRepository(db.SQL)
	ctx := context.Background()
	now := time.Date(2026, 3, 8, 20, 0, 0, 0, time.UTC)
	profileID := "profile-1"
	nodeID := "node-1"
	msg := "queued"
	storagePath := "movies/2026"

	job := domain.Job{
		ID:          "job-1",
		CreatedAt:   now,
		UpdatedAt:   now,
		Type:        domain.JobTypeDirect,
		URL:         "https://example.com/file.bin",
		StoragePath: &storagePath,
		ProfileID:   &profileID,
		NodeID:      &nodeID,
		Status:      domain.JobStatusQueued,
		Message:     &msg,
	}
	if err := repo.Create(ctx, job); err != nil {
		t.Fatalf("create job: %v", err)
	}

	stored, err := repo.GetByID(ctx, "job-1")
	if err != nil {
		t.Fatalf("get job: %v", err)
	}
	if stored.Status != domain.JobStatusQueued {
		t.Fatalf("unexpected status: %s", stored.Status)
	}
	if stored.StoragePath == nil || *stored.StoragePath != storagePath {
		t.Fatalf("unexpected storage path: %v", stored.StoragePath)
	}

	remoteID := "remote-11"
	percent := 44.5
	totalBytes := int64(4096)
	speed := int64(1500)
	eta := int64(33)
	startedAt := now.Add(2 * time.Second)
	finishedAt := now.Add(9 * time.Second)
	outputSizeBytes := int64(2048)
	stored.RemoteJobID = &remoteID
	stored.Percent = &percent
	stored.TotalBytes = &totalBytes
	stored.SpeedBytes = &speed
	stored.ETASeconds = &eta
	stored.StartedAt = &startedAt
	stored.FinishedAt = &finishedAt
	outputPath := "/downloads/file.bin"
	stored.OutputPath = &outputPath
	stored.OutputSizeBytes = &outputSizeBytes
	stored.Status = domain.JobStatusRunning
	stored.UpdatedAt = now.Add(3 * time.Second)
	if err := repo.Update(ctx, stored); err != nil {
		t.Fatalf("update job: %v", err)
	}

	updated, err := repo.GetByID(ctx, "job-1")
	if err != nil {
		t.Fatalf("get updated job: %v", err)
	}
	if updated.RemoteJobID == nil || *updated.RemoteJobID != remoteID {
		t.Fatalf("remote job id mismatch")
	}
	if updated.Percent == nil || *updated.Percent != percent {
		t.Fatalf("percent mismatch")
	}
	if updated.TotalBytes == nil || *updated.TotalBytes != totalBytes {
		t.Fatalf("total bytes mismatch")
	}
	if updated.StartedAt == nil || !updated.StartedAt.Equal(startedAt) {
		t.Fatalf("startedAt mismatch")
	}
	if updated.FinishedAt == nil || !updated.FinishedAt.Equal(finishedAt) {
		t.Fatalf("finishedAt mismatch")
	}
	if updated.OutputSizeBytes == nil || *updated.OutputSizeBytes != outputSizeBytes {
		t.Fatalf("output size bytes mismatch")
	}

	jobs, err := repo.List(ctx, true)
	if err != nil {
		t.Fatalf("list active jobs: %v", err)
	}
	if len(jobs) != 1 {
		t.Fatalf("expected 1 active job, got %d", len(jobs))
	}

	updated.Status = domain.JobStatusPaused
	updated.UpdatedAt = now.Add(6 * time.Second)
	if err := repo.Update(ctx, updated); err != nil {
		t.Fatalf("update to paused: %v", err)
	}
	jobs, err = repo.List(ctx, true)
	if err != nil {
		t.Fatalf("list active after paused: %v", err)
	}
	if len(jobs) != 1 {
		t.Fatalf("expected 1 active paused job, got %d", len(jobs))
	}

	updated.Status = domain.JobStatusDone
	updated.UpdatedAt = now.Add(6 * time.Second)
	if err := repo.Update(ctx, updated); err != nil {
		t.Fatalf("update to done: %v", err)
	}
	jobs, err = repo.List(ctx, true)
	if err != nil {
		t.Fatalf("list active after done: %v", err)
	}
	if len(jobs) != 0 {
		t.Fatalf("expected 0 active jobs, got %d", len(jobs))
	}
}
