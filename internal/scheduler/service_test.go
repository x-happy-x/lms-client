package scheduler

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"path/filepath"
	"testing"
	"time"

	"lms-router-control-plane/internal/app/config"
	"lms-router-control-plane/internal/domain"
	"lms-router-control-plane/internal/store/sqlite"
)

type fakeNodeClient struct {
	createFn func(ctx context.Context, node domain.Node, req domain.NodeJobCreateRequest) (domain.NodeJobCreateResponse, error)
	getFn    func(ctx context.Context, node domain.Node, remoteJobID string) (domain.NodeJobStatusResponse, error)
	cancelFn func(ctx context.Context, node domain.Node, remoteJobID string) (domain.NodeJobStatusResponse, error)
	pauseFn  func(ctx context.Context, node domain.Node, remoteJobID string) (domain.NodeJobStatusResponse, error)
	resumeFn func(ctx context.Context, node domain.Node, remoteJobID string) (domain.NodeJobStatusResponse, error)
	retryFn  func(ctx context.Context, node domain.Node, remoteJobID string) (domain.NodeJobStatusResponse, error)
}

func (f fakeNodeClient) CreateJob(ctx context.Context, node domain.Node, req domain.NodeJobCreateRequest) (domain.NodeJobCreateResponse, error) {
	return f.createFn(ctx, node, req)
}
func (f fakeNodeClient) GetJob(ctx context.Context, node domain.Node, remoteJobID string) (domain.NodeJobStatusResponse, error) {
	return f.getFn(ctx, node, remoteJobID)
}
func (f fakeNodeClient) CancelJob(ctx context.Context, node domain.Node, remoteJobID string) (domain.NodeJobStatusResponse, error) {
	return f.cancelFn(ctx, node, remoteJobID)
}
func (f fakeNodeClient) PauseJob(ctx context.Context, node domain.Node, remoteJobID string) (domain.NodeJobStatusResponse, error) {
	return f.pauseFn(ctx, node, remoteJobID)
}
func (f fakeNodeClient) ResumeJob(ctx context.Context, node domain.Node, remoteJobID string) (domain.NodeJobStatusResponse, error) {
	return f.resumeFn(ctx, node, remoteJobID)
}
func (f fakeNodeClient) RetryJob(ctx context.Context, node domain.Node, remoteJobID string) (domain.NodeJobStatusResponse, error) {
	return f.retryFn(ctx, node, remoteJobID)
}
func (f fakeNodeClient) MoveJobOutput(context.Context, domain.Node, string, *string) (domain.NodeJobStatusResponse, error) {
	return domain.NodeJobStatusResponse{}, errors.New("unexpected")
}
func (f fakeNodeClient) ExtractMedia(context.Context, domain.Node, string) (domain.NodeMediaExtractResponse, error) {
	return domain.NodeMediaExtractResponse{}, nil
}

func (f fakeNodeClient) SetSpeedLimit(context.Context, domain.Node, string, *int64) (domain.NodeJobStatusResponse, error) {
	return domain.NodeJobStatusResponse{}, errors.New("unexpected")
}
func (f fakeNodeClient) DeleteJobOutput(context.Context, domain.Node, string) (domain.NodeJobStatusResponse, error) {
	return domain.NodeJobStatusResponse{}, errors.New("unexpected")
}
func (f fakeNodeClient) GetStorageTargets(context.Context, domain.Node, *int64) (domain.NodeStorageTargetsResponse, error) {
	return domain.NodeStorageTargetsResponse{}, errors.New("unexpected")
}
func (f fakeNodeClient) EstimateStorage(context.Context, domain.Node, domain.NodeStorageEstimateRequest) (domain.NodeStorageEstimateResponse, error) {
	return domain.NodeStorageEstimateResponse{}, errors.New("unexpected")
}
func (f fakeNodeClient) PreflightJob(context.Context, domain.Node, string) (domain.NodeJobPreflightResponse, error) {
	return domain.NodeJobPreflightResponse{}, errors.New("unexpected")
}
func (f fakeNodeClient) DownloadJobOutput(context.Context, domain.Node, string) (io.ReadCloser, string, error) {
	return nil, "", errors.New("unexpected")
}
func (f fakeNodeClient) OpenJobOutput(context.Context, domain.Node, string, map[string]string) (*http.Response, error) {
	return nil, errors.New("unexpected")
}
func (f fakeNodeClient) OpenJobPreview(context.Context, domain.Node, string) (*http.Response, error) {
	return nil, errors.New("unexpected")
}
func (f fakeNodeClient) UploadFile(context.Context, domain.Node, *string, string, io.Reader) (domain.NodeUploadResponse, error) {
	return domain.NodeUploadResponse{}, errors.New("unexpected")
}

func TestDispatchQueuedJobAndPollToDone(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db := setupDB(t)

	jobRepo := sqlite.NewJobRepository(db.SQL)
	nodeRepo := sqlite.NewNodeRepository(db.SQL)

	now := time.Date(2026, 3, 8, 12, 0, 0, 0, time.UTC)
	node := domain.Node{
		ID:        "node-1",
		Name:      "n1",
		BaseURL:   "https://node",
		ClientID:  "router-main",
		Secret:    "secret",
		Enabled:   true,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := nodeRepo.Create(ctx, node); err != nil {
		t.Fatalf("create node: %v", err)
	}

	job := domain.Job{
		ID:        "job-1",
		CreatedAt: now,
		UpdatedAt: now,
		Type:      domain.JobTypeDirect,
		URL:       "https://example.com/file.bin",
		Status:    domain.JobStatusQueued,
	}
	if err := jobRepo.Create(ctx, job); err != nil {
		t.Fatalf("create job: %v", err)
	}

	client := fakeNodeClient{
		createFn: func(_ context.Context, _ domain.Node, _ domain.NodeJobCreateRequest) (domain.NodeJobCreateResponse, error) {
			return domain.NodeJobCreateResponse{JobID: "remote-1"}, nil
		},
		getFn: func(_ context.Context, _ domain.Node, _ string) (domain.NodeJobStatusResponse, error) {
			pct := 100.0
			msg := "done"
			path := "/downloads/out.bin"
			return domain.NodeJobStatusResponse{
				JobID:      "remote-1",
				Status:     "DONE",
				Percent:    &pct,
				Message:    &msg,
				OutputPath: &path,
			}, nil
		},
		cancelFn: func(_ context.Context, _ domain.Node, _ string) (domain.NodeJobStatusResponse, error) {
			return domain.NodeJobStatusResponse{}, nil
		},
		pauseFn: func(_ context.Context, _ domain.Node, _ string) (domain.NodeJobStatusResponse, error) {
			return domain.NodeJobStatusResponse{}, nil
		},
		resumeFn: func(_ context.Context, _ domain.Node, _ string) (domain.NodeJobStatusResponse, error) {
			return domain.NodeJobStatusResponse{}, nil
		},
		retryFn: func(_ context.Context, _ domain.Node, _ string) (domain.NodeJobStatusResponse, error) {
			return domain.NodeJobStatusResponse{}, nil
		},
	}

	s := NewService(jobRepo, nodeRepo, client, Config{PollInterval: 50 * time.Millisecond}, slog.Default())
	s.now = func() time.Time { return now.Add(10 * time.Second) }

	if err := s.tick(ctx); err != nil {
		t.Fatalf("scheduler tick: %v", err)
	}

	stored, err := jobRepo.GetByID(ctx, "job-1")
	if err != nil {
		t.Fatalf("get job: %v", err)
	}
	if stored.Status != domain.JobStatusDone {
		t.Fatalf("expected DONE after dispatch+poll, got %s", stored.Status)
	}
	if stored.RemoteJobID == nil || *stored.RemoteJobID != "remote-1" {
		t.Fatalf("unexpected remote job id: %v", stored.RemoteJobID)
	}
}

func TestCancelPropagatesToNode(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db := setupDB(t)
	jobRepo := sqlite.NewJobRepository(db.SQL)
	nodeRepo := sqlite.NewNodeRepository(db.SQL)

	now := time.Date(2026, 3, 8, 12, 0, 0, 0, time.UTC)
	node := domain.Node{ID: "node-1", Name: "n1", BaseURL: "https://node", ClientID: "c", Secret: "s", Enabled: true, CreatedAt: now, UpdatedAt: now}
	if err := nodeRepo.Create(ctx, node); err != nil {
		t.Fatalf("create node: %v", err)
	}

	remoteID := "remote-1"
	nodeID := node.ID
	job := domain.Job{
		ID:          "job-1",
		CreatedAt:   now,
		UpdatedAt:   now,
		Type:        domain.JobTypeDirect,
		URL:         "https://example.com/file.bin",
		Status:      domain.JobStatusRunning,
		NodeID:      &nodeID,
		RemoteJobID: &remoteID,
	}
	if err := jobRepo.Create(ctx, job); err != nil {
		t.Fatalf("create job: %v", err)
	}

	called := false
	client := fakeNodeClient{
		createFn: func(_ context.Context, _ domain.Node, _ domain.NodeJobCreateRequest) (domain.NodeJobCreateResponse, error) {
			return domain.NodeJobCreateResponse{}, errors.New("unexpected")
		},
		getFn: func(_ context.Context, _ domain.Node, _ string) (domain.NodeJobStatusResponse, error) {
			return domain.NodeJobStatusResponse{}, errors.New("unexpected")
		},
		cancelFn: func(_ context.Context, _ domain.Node, jobID string) (domain.NodeJobStatusResponse, error) {
			called = true
			if jobID != "remote-1" {
				t.Fatalf("unexpected remote job id: %s", jobID)
			}
			return domain.NodeJobStatusResponse{Status: "CANCELED"}, nil
		},
		pauseFn: func(_ context.Context, _ domain.Node, _ string) (domain.NodeJobStatusResponse, error) {
			return domain.NodeJobStatusResponse{}, errors.New("unexpected")
		},
		resumeFn: func(_ context.Context, _ domain.Node, _ string) (domain.NodeJobStatusResponse, error) {
			return domain.NodeJobStatusResponse{}, errors.New("unexpected")
		},
		retryFn: func(_ context.Context, _ domain.Node, _ string) (domain.NodeJobStatusResponse, error) {
			return domain.NodeJobStatusResponse{}, errors.New("unexpected")
		},
	}

	s := NewService(jobRepo, nodeRepo, client, Config{PollInterval: time.Second}, slog.Default())
	s.now = func() time.Time { return now.Add(time.Minute) }

	updated, err := s.CancelJob(ctx, "job-1")
	if err != nil {
		t.Fatalf("cancel job: %v", err)
	}
	if !called {
		t.Fatalf("expected remote cancel to be called")
	}
	if updated.Status != domain.JobStatusCanceled {
		t.Fatalf("expected canceled status, got %s", updated.Status)
	}
}

func TestUpdateJobURLCancelsRemoteAndRequeuesRunningJob(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db := setupDB(t)
	jobRepo := sqlite.NewJobRepository(db.SQL)
	nodeRepo := sqlite.NewNodeRepository(db.SQL)

	now := time.Date(2026, 3, 8, 12, 0, 0, 0, time.UTC)
	node := domain.Node{ID: "node-1", Name: "n1", BaseURL: "https://node", ClientID: "c", Secret: "s", Enabled: true, CreatedAt: now, UpdatedAt: now}
	if err := nodeRepo.Create(ctx, node); err != nil {
		t.Fatalf("create node: %v", err)
	}

	remoteID := "remote-1"
	nodeID := node.ID
	percent := 42.0
	msg := "running"
	job := domain.Job{
		ID:          "job-1",
		CreatedAt:   now,
		UpdatedAt:   now,
		Type:        domain.JobTypeDirect,
		URL:         "https://example.com/old.bin",
		Status:      domain.JobStatusRunning,
		NodeID:      &nodeID,
		RemoteJobID: &remoteID,
		Percent:     &percent,
		Message:     &msg,
	}
	if err := jobRepo.Create(ctx, job); err != nil {
		t.Fatalf("create job: %v", err)
	}

	canceled := false
	client := fakeNodeClient{
		createFn: func(_ context.Context, _ domain.Node, _ domain.NodeJobCreateRequest) (domain.NodeJobCreateResponse, error) {
			return domain.NodeJobCreateResponse{}, errors.New("unexpected")
		},
		getFn: func(_ context.Context, _ domain.Node, _ string) (domain.NodeJobStatusResponse, error) {
			return domain.NodeJobStatusResponse{}, errors.New("unexpected")
		},
		cancelFn: func(_ context.Context, _ domain.Node, jobID string) (domain.NodeJobStatusResponse, error) {
			canceled = true
			if jobID != remoteID {
				t.Fatalf("unexpected remote job id: %s", jobID)
			}
			return domain.NodeJobStatusResponse{Status: "CANCELED"}, nil
		},
		pauseFn: func(_ context.Context, _ domain.Node, _ string) (domain.NodeJobStatusResponse, error) {
			return domain.NodeJobStatusResponse{}, errors.New("unexpected")
		},
		resumeFn: func(_ context.Context, _ domain.Node, _ string) (domain.NodeJobStatusResponse, error) {
			return domain.NodeJobStatusResponse{}, errors.New("unexpected")
		},
		retryFn: func(_ context.Context, _ domain.Node, _ string) (domain.NodeJobStatusResponse, error) {
			return domain.NodeJobStatusResponse{}, errors.New("unexpected")
		},
	}

	s := NewService(jobRepo, nodeRepo, client, Config{PollInterval: time.Second}, slog.Default())
	s.now = func() time.Time { return now.Add(time.Minute) }

	updated, err := s.UpdateJobURL(ctx, "job-1", "https://example.com/new.bin")
	if err != nil {
		t.Fatalf("update job url: %v", err)
	}
	if !canceled {
		t.Fatalf("expected remote cancel to be called")
	}
	if updated.Status != domain.JobStatusQueued {
		t.Fatalf("expected queued status, got %s", updated.Status)
	}
	if updated.URL != "https://example.com/new.bin" {
		t.Fatalf("unexpected updated url: %s", updated.URL)
	}
	if updated.RemoteJobID != nil || updated.Percent != nil || updated.Message != nil {
		t.Fatalf("expected remote state to be cleared, got %+v", updated)
	}
}

func setupDB(t *testing.T) *sqlite.DB {
	t.Helper()

	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "router.db")
	db, err := sqlite.Open(ctx, config.SQLiteConfig{Path: dbPath, BusyTimeoutMS: 5000})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := sqlite.RunMigrations(ctx, db.SQL); err != nil {
		t.Fatalf("migrate sqlite: %v", err)
	}
	return db
}
