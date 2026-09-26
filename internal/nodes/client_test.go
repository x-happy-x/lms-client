package nodes

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"lms-router-control-plane/internal/domain"
)

func TestClientCreateGetCancel(t *testing.T) {
	t.Parallel()

	secret := "change-me"
	clientID := "router-main"
	fixedNow := time.Unix(1_700_000_000, 0).UTC()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !verifyRequest(t, r, secret, fixedNow.Unix()) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/jobs":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"jobId":"remote-1"}`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/jobs/preflight":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"url":"https://example.com/file.bin","sizeBytes":1048576,"sizeKnown":true,"recommendedType":"DIRECT","supportedTypes":["DIRECT","ARIA2C"],"options":[{"type":"DIRECT","supported":true,"resumeSupported":true,"segmentedPossible":true,"message":"ok"}],"defaultStoragePath":"/downloads"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/api/jobs/remote-1":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"jobId":"remote-1","type":"DIRECT","url":"https://example.com/file.bin","status":"RUNNING","percent":12.5}`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/jobs/remote-1/cancel":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"jobId":"remote-1","type":"DIRECT","url":"https://example.com/file.bin","status":"CANCELED"}`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/jobs/remote-1/pause":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"jobId":"remote-1","type":"DIRECT","url":"https://example.com/file.bin","status":"PAUSED"}`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/jobs/remote-1/resume":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"jobId":"remote-1","type":"DIRECT","url":"https://example.com/file.bin","status":"RUNNING"}`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/jobs/remote-1/retry":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"jobId":"remote-1","type":"DIRECT","url":"https://example.com/file.bin","status":"RUNNING"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c := NewClient(ClientConfig{
		DefaultTimeout: 2 * time.Second,
		MaxAttempts:    2,
		BackoffBase:    5 * time.Millisecond,
		Now: func() time.Time {
			return fixedNow
		},
	})

	node := domain.Node{
		BaseURL:  srv.URL,
		ClientID: clientID,
		Secret:   secret,
	}

	created, err := c.CreateJob(context.Background(), node, domain.NodeJobCreateRequest{
		Type: "DIRECT",
		URL:  "https://example.com/file.bin",
	})
	if err != nil {
		t.Fatalf("create job failed: %v", err)
	}
	if created.JobID != "remote-1" {
		t.Fatalf("unexpected create response: %+v", created)
	}

	status, err := c.GetJob(context.Background(), node, "remote-1")
	if err != nil {
		t.Fatalf("get job failed: %v", err)
	}
	if status.Status != "RUNNING" {
		t.Fatalf("unexpected get status: %s", status.Status)
	}

	canceled, err := c.CancelJob(context.Background(), node, "remote-1")
	if err != nil {
		t.Fatalf("cancel job failed: %v", err)
	}
	if canceled.Status != "CANCELED" {
		t.Fatalf("unexpected cancel status: %s", canceled.Status)
	}

	paused, err := c.PauseJob(context.Background(), node, "remote-1")
	if err != nil {
		t.Fatalf("pause job failed: %v", err)
	}
	if paused.Status != "PAUSED" {
		t.Fatalf("unexpected pause status: %s", paused.Status)
	}

	resumed, err := c.ResumeJob(context.Background(), node, "remote-1")
	if err != nil {
		t.Fatalf("resume job failed: %v", err)
	}
	if resumed.Status != "RUNNING" {
		t.Fatalf("unexpected resume status: %s", resumed.Status)
	}

	retried, err := c.RetryJob(context.Background(), node, "remote-1")
	if err != nil {
		t.Fatalf("retry job failed: %v", err)
	}
	if retried.Status != "RUNNING" {
		t.Fatalf("unexpected retry status: %s", retried.Status)
	}

	preflight, err := c.PreflightJob(context.Background(), node, "https://example.com/file.bin")
	if err != nil {
		t.Fatalf("preflight failed: %v", err)
	}
	if preflight.RecommendedType != "DIRECT" {
		t.Fatalf("unexpected preflight type: %s", preflight.RecommendedType)
	}
}

func TestClientRetriesOnServerError(t *testing.T) {
	t.Parallel()

	var attempts atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if attempts.Add(1) == 1 {
			http.Error(w, "boom", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"jobId":"remote-1"}`))
	}))
	defer srv.Close()

	c := NewClient(ClientConfig{
		DefaultTimeout: 2 * time.Second,
		MaxAttempts:    2,
		BackoffBase:    1 * time.Millisecond,
	})

	node := domain.Node{BaseURL: srv.URL, ClientID: "c", Secret: "s"}
	_, err := c.CreateJob(context.Background(), node, domain.NodeJobCreateRequest{Type: "DIRECT", URL: "https://example.com"})
	if err != nil {
		t.Fatalf("expected success after retry, got error: %v", err)
	}
	if attempts.Load() != 2 {
		t.Fatalf("expected 2 attempts, got %d", attempts.Load())
	}
}

func verifyRequest(t *testing.T, r *http.Request, secret string, expectedTimestamp int64) bool {
	t.Helper()

	clientID := r.Header.Get("X-Client-Id")
	timestamp := r.Header.Get("X-Timestamp")
	nonce := r.Header.Get("X-Nonce")
	bodyHash := strings.ToLower(r.Header.Get("X-Body-Sha256"))
	signature := strings.ToLower(r.Header.Get("X-Signature"))

	if clientID == "" || timestamp == "" || nonce == "" || bodyHash == "" || signature == "" {
		return false
	}
	parsedTs, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil || parsedTs != expectedTimestamp {
		return false
	}

	defer r.Body.Close()
	var bodyAny any
	if err := json.NewDecoder(r.Body).Decode(&bodyAny); err != nil && r.Method != http.MethodGet {
		return false
	}

	var raw []byte
	if bodyAny == nil {
		raw = []byte{}
	} else {
		raw, _ = json.Marshal(bodyAny)
	}

	h := sha256.Sum256(raw)
	computedBody := hex.EncodeToString(h[:])
	if computedBody != bodyHash {
		return false
	}

	payload := r.Method + "\n" + r.URL.Path + "\n" + timestamp + "\n" + nonce + "\n" + bodyHash
	m := hmac.New(sha256.New, []byte(secret))
	_, _ = m.Write([]byte(payload))
	expectedSig := hex.EncodeToString(m.Sum(nil))
	return hmac.Equal([]byte(expectedSig), []byte(signature))
}

func TestOpenJobOutputPassesThroughRangeResponses(t *testing.T) {
	t.Parallel()

	payload := "0123456789"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Signature") == "" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		w.Header().Set("X-File-Name", "a.bin")
		http.ServeContent(w, r, "a.bin", time.Unix(1, 0), strings.NewReader(payload))
	}))
	defer server.Close()

	c := NewClient(ClientConfig{DefaultTimeout: 50 * time.Millisecond, MaxAttempts: 1})
	node := domain.Node{BaseURL: server.URL, ClientID: "router-main", Secret: "s"}

	resp, err := c.OpenJobOutput(context.Background(), node, "remote-1", map[string]string{"Range": "bytes=4-"})
	if err != nil {
		t.Fatalf("open output: %v", err)
	}
	body := make([]byte, 16)
	n, _ := resp.Body.Read(body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusPartialContent || string(body[:n]) != "456789" {
		t.Fatalf("expected 206 with tail, got %d %q", resp.StatusCode, body[:n])
	}

	resp, err = c.OpenJobOutput(context.Background(), node, "remote-1", map[string]string{"Range": "bytes=99-"})
	if err != nil {
		t.Fatalf("416 must be passed through, got error %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusRequestedRangeNotSatisfiable {
		t.Fatalf("expected 416, got %d", resp.StatusCode)
	}
}

func TestStreamClientHasNoWholeResponseTimeout(t *testing.T) {
	t.Parallel()
	c := NewClient(ClientConfig{DefaultTimeout: time.Second})
	if c.streamClient.Timeout != 0 {
		t.Fatalf("stream client must not limit total transfer time, got %v", c.streamClient.Timeout)
	}
	if c.streamClient.Transport.(*http.Transport).ResponseHeaderTimeout < 30*time.Second {
		t.Fatalf("header timeout should be at least 30s")
	}
}

func TestExtractMediaOutlivesDefaultTimeoutAndMapsErrors(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/jobs/extract" || r.Header.Get("X-Signature") == "" {
			http.Error(w, "unexpected", http.StatusBadRequest)
			return
		}
		var req map[string]string
		_ = json.NewDecoder(r.Body).Decode(&req)
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(req["url"], "bad") {
			w.WriteHeader(http.StatusUnprocessableEntity)
			_, _ = w.Write([]byte(`{"error":"Unsupported URL: ` + req["url"] + `"}`))
			return
		}
		time.Sleep(120 * time.Millisecond) // longer than DefaultTimeout: yt-dlp takes time
		_, _ = w.Write([]byte(`{"url":"` + req["url"] + `","kind":"playlist","title":"Mix","entries":[{"url":"https://e/a","title":"A","durationSeconds":5}],"entryCount":1,"truncated":false}`))
	}))
	defer server.Close()

	c := NewClient(ClientConfig{DefaultTimeout: 50 * time.Millisecond, MaxAttempts: 1})
	node := domain.Node{BaseURL: server.URL, ClientID: "router-main", Secret: "s"}

	result, err := c.ExtractMedia(context.Background(), node, "https://e/list")
	if err != nil {
		t.Fatalf("extract: %v", err)
	}
	if result.Kind != "playlist" || len(result.Entries) != 1 || result.Entries[0].URL != "https://e/a" {
		t.Fatalf("unexpected result: %+v", result)
	}

	_, err = c.ExtractMedia(context.Background(), node, "https://e/bad")
	var nodeErr *NodeError
	if !errors.As(err, &nodeErr) || nodeErr.Status != http.StatusUnprocessableEntity || nodeErr.Message != "Unsupported URL: https://e/bad" {
		t.Fatalf("expected NodeError 422, got %v", err)
	}
}
