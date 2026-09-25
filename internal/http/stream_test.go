package http

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"lms-router-control-plane/internal/app/config"
	"lms-router-control-plane/internal/domain"
	"lms-router-control-plane/internal/nodes"
	"lms-router-control-plane/internal/store/sqlite"
)

const streamPayload = "0123456789abcdefghij"

// fileStubNodeClient serves a fixed file with real Range handling (http.ServeContent).
type fileStubNodeClient struct {
	stubNodeClient
	lastHeaders    map[string]string
	previewMissing bool
	speedCalls     []*int64
}

func (s *fileStubNodeClient) SetSpeedLimit(_ context.Context, _ domain.Node, _ string, limit *int64) (domain.NodeJobStatusResponse, error) {
	s.speedCalls = append(s.speedCalls, limit)
	return domain.NodeJobStatusResponse{}, nil
}

func (s *fileStubNodeClient) OpenJobOutput(_ context.Context, _ domain.Node, _ string, headers map[string]string) (*http.Response, error) {
	s.lastHeaders = headers
	req := httptest.NewRequest(http.MethodGet, "/file", nil)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	rec.Header().Set("Content-Type", "application/octet-stream")
	rec.Header().Set("X-File-Name", "%D0%BE%D1%82%D0%BF%D1%83%D1%81%D0%BA%202026.jpg")
	http.ServeContent(rec, req, "", time.Unix(1700000000, 0), strings.NewReader(streamPayload))
	return rec.Result(), nil
}

func (s *fileStubNodeClient) OpenJobPreview(context.Context, domain.Node, string) (*http.Response, error) {
	if s.previewMissing {
		return nil, nodes.ErrNotFound
	}
	rec := httptest.NewRecorder()
	rec.Header().Set("Content-Type", "image/jpeg")
	_, _ = rec.WriteString("jpeg-bytes")
	return rec.Result(), nil
}

type streamFixture struct {
	server  *httptest.Server
	jobRepo *sqlite.JobRepository
	client  *fileStubNodeClient
	nodeID  string
}

func newStreamFixture(t *testing.T) streamFixture {
	t.Helper()
	ctx := context.Background()
	db, err := sqlite.Open(ctx, config.SQLiteConfig{Path: filepath.Join(t.TempDir(), "router.db"), BusyTimeoutMS: 5000})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := sqlite.RunMigrations(ctx, db.SQL); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	jobRepo := sqlite.NewJobRepository(db.SQL)
	nodeRepo := sqlite.NewNodeRepository(db.SQL)
	client := &fileStubNodeClient{}
	server := httptest.NewServer(NewHandler(Dependencies{
		DB:          db.SQL,
		Version:     "test",
		JobRepo:     jobRepo,
		NodeRepo:    nodeRepo,
		ProfileRepo: sqlite.NewProfileRepository(db.SQL),
		NodeClient:  client,
	}))
	t.Cleanup(server.Close)
	return streamFixture{server: server, jobRepo: jobRepo, client: client, nodeID: createNodeViaAPI(t, server.URL)}
}

func (f streamFixture) doneJob(t *testing.T) string {
	t.Helper()
	jobID := createJobViaAPI(t, f.server.URL, f.nodeID, "")
	job, err := f.jobRepo.GetByID(context.Background(), jobID)
	if err != nil {
		t.Fatalf("get job: %v", err)
	}
	remote := "remote-1"
	output := "/downloads/отпуск 2026.jpg"
	job.RemoteJobID = &remote
	job.OutputPath = &output
	job.Status = domain.JobStatusDone
	if err := f.jobRepo.Update(context.Background(), job); err != nil {
		t.Fatalf("update job: %v", err)
	}
	return jobID
}

func TestStreamJobFileForwardsRangeAndNamesFile(t *testing.T) {
	t.Parallel()
	f := newStreamFixture(t)
	jobID := f.doneJob(t)

	req, _ := http.NewRequest(http.MethodGet, f.server.URL+"/api/ui/jobs/"+jobID+"/file", nil)
	req.Header.Set("Range", "bytes=10-")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("get file: %v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusPartialContent {
		t.Fatalf("expected 206, got %d: %s", resp.StatusCode, body)
	}
	if string(body) != streamPayload[10:] {
		t.Fatalf("unexpected body %q", body)
	}
	if got := resp.Header.Get("Content-Range"); got != "bytes 10-19/20" {
		t.Fatalf("unexpected Content-Range %q", got)
	}
	if got := resp.Header.Get("Content-Type"); got != "image/jpeg" {
		t.Fatalf("expected type from extension, got %q", got)
	}
	disposition := resp.Header.Get("Content-Disposition")
	if !strings.HasPrefix(disposition, "attachment;") || !strings.Contains(disposition, "filename*=UTF-8''%D0%BE") {
		t.Fatalf("unexpected Content-Disposition %q", disposition)
	}
	if resp.Header.Get("X-Accel-Buffering") != "no" {
		t.Fatalf("nginx buffering must be disabled")
	}
	if f.client.lastHeaders["Range"] != "bytes=10-" {
		t.Fatalf("Range was not forwarded: %v", f.client.lastHeaders)
	}
}

func TestStreamJobFileInlineAndHead(t *testing.T) {
	t.Parallel()
	f := newStreamFixture(t)
	jobID := f.doneJob(t)

	resp, err := http.Head(f.server.URL + "/api/ui/jobs/" + jobID + "/file?inline=1")
	if err != nil {
		t.Fatalf("head file: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || resp.ContentLength != int64(len(streamPayload)) {
		t.Fatalf("unexpected HEAD: %d len=%d", resp.StatusCode, resp.ContentLength)
	}
	if !strings.HasPrefix(resp.Header.Get("Content-Disposition"), "inline;") {
		t.Fatalf("expected inline disposition, got %q", resp.Header.Get("Content-Disposition"))
	}
}

func TestStreamJobFileRequiresNodeOutput(t *testing.T) {
	t.Parallel()
	f := newStreamFixture(t)
	jobID := createJobViaAPI(t, f.server.URL, f.nodeID, "")

	resp, err := http.Get(f.server.URL + "/api/ui/jobs/" + jobID + "/file")
	if err != nil {
		t.Fatalf("get file: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("expected 409 for job without remote output, got %d", resp.StatusCode)
	}

	missing, err := http.Get(f.server.URL + "/api/ui/jobs/missing/file")
	if err != nil {
		t.Fatalf("get missing: %v", err)
	}
	missing.Body.Close()
	if missing.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", missing.StatusCode)
	}
}

func TestStreamJobPreview(t *testing.T) {
	t.Parallel()
	f := newStreamFixture(t)
	jobID := f.doneJob(t)

	resp, err := http.Get(f.server.URL + "/api/ui/jobs/" + jobID + "/preview")
	if err != nil {
		t.Fatalf("get preview: %v", err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || string(body) != "jpeg-bytes" || resp.Header.Get("Content-Type") != "image/jpeg" {
		t.Fatalf("unexpected preview: %d %q %q", resp.StatusCode, body, resp.Header.Get("Content-Type"))
	}

	f.client.previewMissing = true
	resp, err = http.Get(f.server.URL + "/api/ui/jobs/" + jobID + "/preview")
	if err != nil {
		t.Fatalf("get preview: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 when node has no preview, got %d", resp.StatusCode)
	}
}

func TestMagnetLinksOnlyForTorrentJobs(t *testing.T) {
	t.Parallel()
	f := newStreamFixture(t)
	magnet := "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Show"

	post := func(payload string) (int, map[string]any) {
		resp, err := http.Post(f.server.URL+"/api/ui/jobs", "application/json", bytes.NewReader([]byte(payload)))
		if err != nil {
			t.Fatalf("create job: %v", err)
		}
		defer resp.Body.Close()
		var body map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&body)
		return resp.StatusCode, body
	}

	status, body := post(`{"type":"torrent","url":"` + magnet + `","nodeId":"` + f.nodeID + `"}`)
	if status != http.StatusCreated || body["type"] != "TORRENT" {
		t.Fatalf("expected TORRENT job, got %d %v", status, body)
	}
	status, body = post(`{"type":"DIRECT","url":"` + magnet + `"}`)
	if status != http.StatusBadRequest || !strings.Contains(body["error"].(string), "TORRENT") {
		t.Fatalf("expected 400 for magnet DIRECT job, got %d %v", status, body)
	}
	status, _ = post(`{"type":"TORRENT","url":"ftp://example.com/x"}`)
	if status != http.StatusBadRequest {
		t.Fatalf("expected 400 for ftp url, got %d", status)
	}

	resp, err := http.Post(f.server.URL+"/api/ui/jobs/preflight", "application/json", bytes.NewReader([]byte(`{"url":"`+magnet+`"}`)))
	if err != nil {
		t.Fatalf("preflight: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected preflight 200 for magnet, got %d", resp.StatusCode)
	}
}

func TestSpeedLimitIsStoredAndForwardedToNode(t *testing.T) {
	t.Parallel()
	f := newStreamFixture(t)

	resp, err := http.Post(f.server.URL+"/api/ui/jobs", "application/json",
		bytes.NewReader([]byte(`{"type":"DIRECT","url":"https://example.com/a.bin","nodeId":"`+f.nodeID+`","maxSpeedBytes":1048576}`)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	var created map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&created)
	resp.Body.Close()
	if created["maxSpeedBytes"] != float64(1048576) {
		t.Fatalf("limit not stored on create: %v", created)
	}
	jobID := created["id"].(string)

	speed := func(body string) (int, map[string]any) {
		resp, err := http.Post(f.server.URL+"/api/ui/jobs/"+jobID+"/speed", "application/json", bytes.NewReader([]byte(body)))
		if err != nil {
			t.Fatalf("speed: %v", err)
		}
		defer resp.Body.Close()
		var out map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&out)
		return resp.StatusCode, out
	}

	// Not dispatched yet: stored only, the node is not called.
	if code, out := speed(`{"maxSpeedBytes":500000}`); code != http.StatusOK || out["maxSpeedBytes"] != float64(500000) {
		t.Fatalf("unexpected %d %v", code, out)
	}
	if len(f.client.speedCalls) != 0 {
		t.Fatalf("node must not be called before dispatch")
	}

	// Running on a node: forwarded.
	job, _ := f.jobRepo.GetByID(context.Background(), jobID)
	remote := "remote-9"
	job.RemoteJobID = &remote
	job.Status = domain.JobStatusRunning
	_ = f.jobRepo.Update(context.Background(), job)
	if code, out := speed(`{"maxSpeedBytes":0}`); code != http.StatusOK || out["maxSpeedBytes"] != nil {
		t.Fatalf("0 must remove the limit: %d %v", code, out)
	}
	if len(f.client.speedCalls) != 1 || f.client.speedCalls[0] != nil {
		t.Fatalf("expected one node call with nil limit, got %v", f.client.speedCalls)
	}
	if code, _ := speed(`{"maxSpeedBytes":-1}`); code != http.StatusBadRequest {
		t.Fatalf("negative limit must be rejected, got %d", code)
	}
}
