package http

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"lms-router-control-plane/internal/app/config"
	"lms-router-control-plane/internal/domain"
	"lms-router-control-plane/internal/scheduler"
	"lms-router-control-plane/internal/store/sqlite"
)

func TestUIAPIJobsNodesProfiles(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "router.db")
	db, err := sqlite.Open(ctx, config.SQLiteConfig{Path: dbPath, BusyTimeoutMS: 5000})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := sqlite.RunMigrations(ctx, db.SQL); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	jobRepo := sqlite.NewJobRepository(db.SQL)
	nodeRepo := sqlite.NewNodeRepository(db.SQL)
	profileRepo := sqlite.NewProfileRepository(db.SQL)
	nodeClient := &stubNodeClient{}
	svc := scheduler.NewService(jobRepo, nodeRepo, nodeClient, scheduler.Config{PollInterval: time.Second}, nil)

	h := NewHandler(Dependencies{
		DB:            db.SQL,
		Version:       "test",
		JobRepo:       jobRepo,
		NodeRepo:      nodeRepo,
		ProfileRepo:   profileRepo,
		JobController: svc,
		NodeClient:    nodeClient,
	})
	server := httptest.NewServer(h)
	t.Cleanup(server.Close)

	nodeID := createNodeViaAPI(t, server.URL)
	updateNodeViaAPI(t, server.URL, nodeID)
	profileID := createProfileViaAPI(t, server.URL)
	jobID := createJobViaAPI(t, server.URL, nodeID, profileID)

	pauseReq, _ := http.NewRequest(http.MethodPost, server.URL+"/api/ui/jobs/"+jobID+"/pause", bytes.NewReader([]byte("{}")))
	pauseResp, err := http.DefaultClient.Do(pauseReq)
	if err != nil {
		t.Fatalf("pause job: %v", err)
	}
	defer pauseResp.Body.Close()
	if pauseResp.StatusCode != http.StatusOK {
		t.Fatalf("expected pause 200, got %d", pauseResp.StatusCode)
	}

	resumeReq, _ := http.NewRequest(http.MethodPost, server.URL+"/api/ui/jobs/"+jobID+"/resume", bytes.NewReader([]byte("{}")))
	resumeResp, err := http.DefaultClient.Do(resumeReq)
	if err != nil {
		t.Fatalf("resume job: %v", err)
	}
	defer resumeResp.Body.Close()
	if resumeResp.StatusCode != http.StatusOK {
		t.Fatalf("expected resume 200, got %d", resumeResp.StatusCode)
	}

	updateURLReq, _ := http.NewRequest(http.MethodPost, server.URL+"/api/ui/jobs/"+jobID+"/url", bytes.NewReader([]byte(`{"url":"https://example.com/updated.bin"}`)))
	updateURLReq.Header.Set("Content-Type", "application/json")
	updateURLResp, err := http.DefaultClient.Do(updateURLReq)
	if err != nil {
		t.Fatalf("update job url: %v", err)
	}
	defer updateURLResp.Body.Close()
	if updateURLResp.StatusCode != http.StatusOK {
		t.Fatalf("expected update url 200, got %d", updateURLResp.StatusCode)
	}

	resp, err := http.Get(server.URL + "/api/ui/jobs?active=true")
	if err != nil {
		t.Fatalf("list active jobs: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	cancelReq, _ := http.NewRequest(http.MethodPost, server.URL+"/api/ui/jobs/"+jobID+"/cancel", bytes.NewReader([]byte("{}")))
	cancelResp, err := http.DefaultClient.Do(cancelReq)
	if err != nil {
		t.Fatalf("cancel job: %v", err)
	}
	defer cancelResp.Body.Close()
	if cancelResp.StatusCode != http.StatusOK {
		t.Fatalf("expected cancel 200, got %d", cancelResp.StatusCode)
	}

	getResp, err := http.Get(server.URL + "/api/ui/jobs/" + jobID)
	if err != nil {
		t.Fatalf("get job: %v", err)
	}
	defer getResp.Body.Close()
	if getResp.StatusCode != http.StatusOK {
		t.Fatalf("expected get 200, got %d", getResp.StatusCode)
	}
	var job map[string]any
	if err := json.NewDecoder(getResp.Body).Decode(&job); err != nil {
		t.Fatalf("decode job: %v", err)
	}
	if job["status"] != "CANCELED" {
		t.Fatalf("expected CANCELED, got %v", job["status"])
	}
	if job["url"] != "https://example.com/updated.bin" {
		t.Fatalf("expected updated url, got %v", job["url"])
	}
}

func TestListNodesIncludesLiveStatusAndCapabilities(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "router.db")
	db, err := sqlite.Open(ctx, config.SQLiteConfig{Path: dbPath, BusyTimeoutMS: 5000})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := sqlite.RunMigrations(ctx, db.SQL); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	healthServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/actuator/health" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`{"status":"UP"}`))
	}))
	t.Cleanup(healthServer.Close)

	nodeRepo := sqlite.NewNodeRepository(db.SQL)
	now := time.Now().UTC()
	caps := `{"downloadTypes":["DIRECT","YTDLP"]}`
	if err := nodeRepo.Create(ctx, domain.Node{
		ID:        "node-1",
		Name:      "s1",
		BaseURL:   healthServer.URL,
		ClientID:  "router-main",
		Secret:    "secret",
		Enabled:   true,
		CapsJSON:  &caps,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create node: %v", err)
	}

	server := httptest.NewServer(NewHandler(Dependencies{
		DB:       db.SQL,
		Version:  "test",
		NodeRepo: nodeRepo,
	}))
	t.Cleanup(server.Close)

	resp, err := http.Get(server.URL + "/api/ui/nodes")
	if err != nil {
		t.Fatalf("list nodes: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode nodes response: %v", err)
	}
	if len(body) != 1 {
		t.Fatalf("expected 1 node, got %d", len(body))
	}
	if body[0]["status"] != "online" {
		t.Fatalf("expected online status, got %v", body[0]["status"])
	}
	if _, ok := body[0]["pingMs"].(float64); !ok {
		t.Fatalf("expected pingMs in response, got %v", body[0]["pingMs"])
	}

	availableTypes, ok := body[0]["availableTypes"].([]any)
	if !ok || len(availableTypes) != 2 {
		t.Fatalf("expected 2 available types, got %v", body[0]["availableTypes"])
	}
	if availableTypes[0] != "DIRECT" || availableTypes[1] != "YTDLP" {
		t.Fatalf("unexpected available types: %v", availableTypes)
	}
}

func TestJobPreflightReturnsBestNodeAndCapabilities(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "router.db")
	db, err := sqlite.Open(ctx, config.SQLiteConfig{Path: dbPath, BusyTimeoutMS: 5000})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := sqlite.RunMigrations(ctx, db.SQL); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	nodeRepo := sqlite.NewNodeRepository(db.SQL)
	now := time.Now().UTC()
	for _, node := range []domain.Node{
		{ID: "node-1", Name: "s1", BaseURL: "https://node-1", ClientID: "c1", Secret: "s1", Enabled: true, CreatedAt: now, UpdatedAt: now},
		{ID: "node-2", Name: "s2", BaseURL: "https://node-2", ClientID: "c2", Secret: "s2", Enabled: true, CreatedAt: now, UpdatedAt: now},
	} {
		if err := nodeRepo.Create(ctx, node); err != nil {
			t.Fatalf("create node: %v", err)
		}
	}

	nodeClient := &preflightStubNodeClient{
		preflights: map[string]domain.NodeJobPreflightResponse{
			"node-1": {
				URL:             "https://example.com/file.bin",
				SizeKnown:       true,
				RecommendedType: "DIRECT",
				SupportedTypes:  []string{"DIRECT"},
				Options:         []domain.NodeDownloadOption{{Type: "DIRECT", Supported: true, ResumeSupported: true, SegmentedPossible: true, Message: "ok"}},
			},
			"node-2": {
				URL:             "https://example.com/file.bin",
				SizeKnown:       true,
				RecommendedType: "ARIA2C",
				SupportedTypes:  []string{"ARIA2C"},
				Options:         []domain.NodeDownloadOption{{Type: "ARIA2C", Supported: true, ResumeSupported: true, SegmentedPossible: true, Message: "ok"}},
			},
		},
	}

	server := httptest.NewServer(NewHandler(Dependencies{
		DB:         db.SQL,
		Version:    "test",
		NodeRepo:   nodeRepo,
		NodeClient: nodeClient,
	}))
	t.Cleanup(server.Close)

	resp, err := http.Post(server.URL+"/api/ui/jobs/preflight", "application/json", bytes.NewReader([]byte(`{"url":"https://example.com/file.bin"}`)))
	if err != nil {
		t.Fatalf("preflight request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode preflight response: %v", err)
	}
	if body["bestNodeId"] == "" {
		t.Fatalf("expected bestNodeId, got %v", body["bestNodeId"])
	}
	nodes, ok := body["nodes"].([]any)
	if !ok || len(nodes) != 2 {
		t.Fatalf("expected 2 nodes, got %v", body["nodes"])
	}
}

type stubNodeClient struct{}

func (s *stubNodeClient) CreateJob(context.Context, domain.Node, domain.NodeJobCreateRequest) (domain.NodeJobCreateResponse, error) {
	return domain.NodeJobCreateResponse{JobID: "stub-remote"}, nil
}
func (s *stubNodeClient) GetJob(context.Context, domain.Node, string) (domain.NodeJobStatusResponse, error) {
	return domain.NodeJobStatusResponse{Status: "RUNNING"}, nil
}
func (s *stubNodeClient) CancelJob(context.Context, domain.Node, string) (domain.NodeJobStatusResponse, error) {
	return domain.NodeJobStatusResponse{Status: "CANCELED"}, nil
}
func (s *stubNodeClient) PauseJob(context.Context, domain.Node, string) (domain.NodeJobStatusResponse, error) {
	return domain.NodeJobStatusResponse{Status: "PAUSED"}, nil
}
func (s *stubNodeClient) ResumeJob(context.Context, domain.Node, string) (domain.NodeJobStatusResponse, error) {
	return domain.NodeJobStatusResponse{Status: "RUNNING"}, nil
}
func (s *stubNodeClient) RetryJob(context.Context, domain.Node, string) (domain.NodeJobStatusResponse, error) {
	return domain.NodeJobStatusResponse{Status: "RUNNING"}, nil
}
func (s *stubNodeClient) MoveJobOutput(context.Context, domain.Node, string, *string) (domain.NodeJobStatusResponse, error) {
	path := "/tmp/moved.bin"
	return domain.NodeJobStatusResponse{Status: "DONE", OutputPath: &path}, nil
}
func (s *stubNodeClient) ExtractMedia(context.Context, domain.Node, string) (domain.NodeMediaExtractResponse, error) {
	return domain.NodeMediaExtractResponse{}, nil
}

func (s *stubNodeClient) SetSpeedLimit(context.Context, domain.Node, string, *int64) (domain.NodeJobStatusResponse, error) {
	return domain.NodeJobStatusResponse{Status: "RUNNING"}, nil
}
func (s *stubNodeClient) DeleteJobOutput(context.Context, domain.Node, string) (domain.NodeJobStatusResponse, error) {
	return domain.NodeJobStatusResponse{Status: "DONE"}, nil
}
func (s *stubNodeClient) GetStorageTargets(context.Context, domain.Node, *int64) (domain.NodeStorageTargetsResponse, error) {
	return domain.NodeStorageTargetsResponse{
		DefaultPath: "/downloads",
		Targets: []domain.NodeStorageTarget{
			{Path: "/downloads", FreeBytes: 1 << 30, TotalBytes: 2 << 30, Writable: true},
		},
	}, nil
}
func (s *stubNodeClient) EstimateStorage(context.Context, domain.Node, domain.NodeStorageEstimateRequest) (domain.NodeStorageEstimateResponse, error) {
	size := int64(512 << 20)
	return domain.NodeStorageEstimateResponse{SizeBytes: &size, Known: true, Message: "ok"}, nil
}
func (s *stubNodeClient) PreflightJob(context.Context, domain.Node, string) (domain.NodeJobPreflightResponse, error) {
	size := int64(512 << 20)
	return domain.NodeJobPreflightResponse{
		URL:                "https://example.com/file.bin",
		SizeBytes:          &size,
		SizeKnown:          true,
		RecommendedType:    "DIRECT",
		SupportedTypes:     []string{"DIRECT", "ARIA2C"},
		Options:            []domain.NodeDownloadOption{{Type: "DIRECT", Supported: true, ResumeSupported: true, SegmentedPossible: true, Message: "ok"}},
		DefaultStoragePath: "/downloads",
	}, nil
}
func (s *stubNodeClient) DownloadJobOutput(context.Context, domain.Node, string) (io.ReadCloser, string, error) {
	return io.NopCloser(bytes.NewReader([]byte("payload"))), "payload.bin", nil
}
func (s *stubNodeClient) UploadFile(context.Context, domain.Node, *string, string, io.Reader) (domain.NodeUploadResponse, error) {
	return domain.NodeUploadResponse{OutputPath: "/downloads/payload.bin", SizeBytes: 7}, nil
}

func (s *stubNodeClient) OpenJobOutput(context.Context, domain.Node, string, map[string]string) (*http.Response, error) {
	return nil, errors.New("unexpected")
}
func (s *stubNodeClient) OpenJobPreview(context.Context, domain.Node, string) (*http.Response, error) {
	return nil, errors.New("unexpected")
}

type preflightStubNodeClient struct {
	stubNodeClient
	preflights map[string]domain.NodeJobPreflightResponse
}

func (s *preflightStubNodeClient) PreflightJob(_ context.Context, node domain.Node, _ string) (domain.NodeJobPreflightResponse, error) {
	if resp, ok := s.preflights[node.ID]; ok {
		return resp, nil
	}
	return domain.NodeJobPreflightResponse{}, nil
}

func createNodeViaAPI(t *testing.T, base string) string {
	t.Helper()
	payload := []byte(`{"name":"n1","baseUrl":"https://node","clientId":"router-main","secret":"secret"}`)
	resp, err := http.Post(base+"/api/ui/nodes", "application/json", bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("create node: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201, got %d", resp.StatusCode)
	}
	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode node response: %v", err)
	}
	id, _ := body["id"].(string)
	if id == "" {
		t.Fatalf("node id is empty")
	}
	return id
}

func createProfileViaAPI(t *testing.T, base string) string {
	t.Helper()
	payload := []byte(`{"name":"p1","type":"DIRECT"}`)
	resp, err := http.Post(base+"/api/ui/profiles", "application/json", bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("create profile: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201, got %d", resp.StatusCode)
	}
	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode profile response: %v", err)
	}
	id, _ := body["id"].(string)
	if id == "" {
		t.Fatalf("profile id is empty")
	}
	return id
}

func updateNodeViaAPI(t *testing.T, base, nodeID string) {
	t.Helper()
	payload := []byte(`{"name":"s1","baseUrl":"https://node-updated","clientId":"router-main","secret":"secret-2","enabled":false}`)
	req, err := http.NewRequest(http.MethodPut, base+"/api/ui/nodes/"+nodeID, bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("build update node request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("update node: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 from update node, got %d", resp.StatusCode)
	}
	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode updated node response: %v", err)
	}
	if body["name"] != "s1" {
		t.Fatalf("expected updated node name, got %v", body["name"])
	}
	if body["enabled"] != false {
		t.Fatalf("expected updated node enabled=false, got %v", body["enabled"])
	}
}

func createJobViaAPI(t *testing.T, base, nodeID, profileID string) string {
	t.Helper()
	payload := []byte(`{"type":"DIRECT","url":"https://example.com/file.bin","storagePath":"movies/2026","nodeId":"` + nodeID + `","profileId":"` + profileID + `"}`)
	resp, err := http.Post(base+"/api/ui/jobs", "application/json", bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("create job: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201, got %d", resp.StatusCode)
	}
	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode job response: %v", err)
	}
	id, _ := body["id"].(string)
	if id == "" {
		t.Fatalf("job id is empty")
	}
	return id
}
