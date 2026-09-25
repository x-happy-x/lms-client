package nodes

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"os"
	"path"
	"strconv"
	"strings"
	"time"

	"lms-router-control-plane/internal/domain"
)

type ClientConfig struct {
	DefaultTimeout time.Duration
	MaxAttempts    int
	BackoffBase    time.Duration
	Now            func() time.Time
	Rand           *rand.Rand
}

type Client struct {
	httpClient *http.Client
	// streamClient has no overall timeout: file bodies can take hours to transfer.
	streamClient *http.Client
	cfg          ClientConfig
}

func NewClient(cfg ClientConfig) *Client {
	if cfg.DefaultTimeout <= 0 {
		cfg.DefaultTimeout = 5 * time.Second
	}
	if cfg.MaxAttempts <= 0 {
		cfg.MaxAttempts = 3
	}
	if cfg.BackoffBase <= 0 {
		cfg.BackoffBase = 200 * time.Millisecond
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.Rand == nil {
		cfg.Rand = rand.New(rand.NewSource(time.Now().UnixNano()))
	}

	return &Client{
		httpClient:   &http.Client{Timeout: cfg.DefaultTimeout},
		streamClient: newStreamClient(cfg.DefaultTimeout),
		cfg:          cfg,
	}
}

func (c *Client) CreateJob(ctx context.Context, node domain.Node, req domain.NodeJobCreateRequest) (domain.NodeJobCreateResponse, error) {
	var result domain.NodeJobCreateResponse
	err := c.callJSON(ctx, node, http.MethodPost, "/api/jobs", req, &result)
	if err != nil {
		return domain.NodeJobCreateResponse{}, err
	}
	return result, nil
}

func (c *Client) GetJob(ctx context.Context, node domain.Node, remoteJobID string) (domain.NodeJobStatusResponse, error) {
	var result domain.NodeJobStatusResponse
	err := c.callJSON(ctx, node, http.MethodGet, "/api/jobs/"+remoteJobID, nil, &result)
	if err != nil {
		return domain.NodeJobStatusResponse{}, err
	}
	return result, nil
}

func (c *Client) CancelJob(ctx context.Context, node domain.Node, remoteJobID string) (domain.NodeJobStatusResponse, error) {
	var result domain.NodeJobStatusResponse
	err := c.callJSON(ctx, node, http.MethodPost, "/api/jobs/"+remoteJobID+"/cancel", map[string]any{}, &result)
	if err != nil {
		return domain.NodeJobStatusResponse{}, err
	}
	return result, nil
}

func (c *Client) PauseJob(ctx context.Context, node domain.Node, remoteJobID string) (domain.NodeJobStatusResponse, error) {
	var result domain.NodeJobStatusResponse
	err := c.callJSON(ctx, node, http.MethodPost, "/api/jobs/"+remoteJobID+"/pause", map[string]any{}, &result)
	if err != nil {
		return domain.NodeJobStatusResponse{}, err
	}
	return result, nil
}

func (c *Client) ResumeJob(ctx context.Context, node domain.Node, remoteJobID string) (domain.NodeJobStatusResponse, error) {
	var result domain.NodeJobStatusResponse
	err := c.callJSON(ctx, node, http.MethodPost, "/api/jobs/"+remoteJobID+"/resume", map[string]any{}, &result)
	if err != nil {
		return domain.NodeJobStatusResponse{}, err
	}
	return result, nil
}

func (c *Client) RetryJob(ctx context.Context, node domain.Node, remoteJobID string) (domain.NodeJobStatusResponse, error) {
	var result domain.NodeJobStatusResponse
	err := c.callJSON(ctx, node, http.MethodPost, "/api/jobs/"+remoteJobID+"/retry", map[string]any{}, &result)
	if err != nil {
		return domain.NodeJobStatusResponse{}, err
	}
	return result, nil
}

func (c *Client) MoveJobOutput(ctx context.Context, node domain.Node, remoteJobID string, storagePath *string) (domain.NodeJobStatusResponse, error) {
	var result domain.NodeJobStatusResponse
	req := map[string]any{"storagePath": storagePath}
	err := c.callJSON(ctx, node, http.MethodPost, "/api/jobs/"+remoteJobID+"/move", req, &result)
	if err != nil {
		return domain.NodeJobStatusResponse{}, err
	}
	return result, nil
}

func (c *Client) DeleteJobOutput(ctx context.Context, node domain.Node, remoteJobID string) (domain.NodeJobStatusResponse, error) {
	var result domain.NodeJobStatusResponse
	err := c.callJSON(ctx, node, http.MethodPost, "/api/jobs/"+remoteJobID+"/file/delete", map[string]any{}, &result)
	if err != nil {
		return domain.NodeJobStatusResponse{}, err
	}
	return result, nil
}

func (c *Client) GetStorageTargets(ctx context.Context, node domain.Node, requiredBytes *int64) (domain.NodeStorageTargetsResponse, error) {
	query := ""
	if requiredBytes != nil && *requiredBytes > 0 {
		query = "?requiredBytes=" + strconv.FormatInt(*requiredBytes, 10)
	}
	var result domain.NodeStorageTargetsResponse
	err := c.callJSON(ctx, node, http.MethodGet, "/api/storage/targets"+query, nil, &result)
	if err != nil {
		return domain.NodeStorageTargetsResponse{}, err
	}
	return result, nil
}

func (c *Client) EstimateStorage(ctx context.Context, node domain.Node, req domain.NodeStorageEstimateRequest) (domain.NodeStorageEstimateResponse, error) {
	var result domain.NodeStorageEstimateResponse
	err := c.callJSON(ctx, node, http.MethodPost, "/api/storage/estimate", req, &result)
	if err != nil {
		return domain.NodeStorageEstimateResponse{}, err
	}
	return result, nil
}

func (c *Client) PreflightJob(ctx context.Context, node domain.Node, url string) (domain.NodeJobPreflightResponse, error) {
	var result domain.NodeJobPreflightResponse
	req := map[string]string{"url": url}
	err := c.callJSON(ctx, node, http.MethodPost, "/api/jobs/preflight", req, &result)
	if err != nil {
		return domain.NodeJobPreflightResponse{}, err
	}
	return result, nil
}

// OpenJobOutput streams a job's output file from the node. Range/If-Range headers are
// forwarded, and 206/416 responses are returned as-is so callers can proxy them.
func (c *Client) OpenJobOutput(ctx context.Context, node domain.Node, remoteJobID string, headers map[string]string) (*http.Response, error) {
	return c.do(ctx, c.streamClient, node, http.MethodGet, "/api/jobs/"+remoteJobID+"/file", nil, headers, true)
}

// OpenJobPreview fetches a small JPEG thumbnail of a media output (404 when unavailable).
func (c *Client) OpenJobPreview(ctx context.Context, node domain.Node, remoteJobID string) (*http.Response, error) {
	return c.do(ctx, c.streamClient, node, http.MethodGet, "/api/jobs/"+remoteJobID+"/preview", nil, nil, true)
}

func (c *Client) DownloadJobOutput(ctx context.Context, node domain.Node, remoteJobID string) (io.ReadCloser, string, error) {
	resp, err := c.do(ctx, c.streamClient, node, http.MethodGet, "/api/jobs/"+remoteJobID+"/file", nil, nil, false)
	if err != nil {
		return nil, "", err
	}
	fileName := DecodeFileName(resp.Header.Get("X-File-Name"))
	if strings.TrimSpace(fileName) == "" {
		fileName = remoteJobID + ".bin"
	}
	return resp.Body, fileName, nil
}

func (c *Client) UploadFile(ctx context.Context, node domain.Node, storagePath *string, fileName string, body io.Reader) (domain.NodeUploadResponse, error) {
	apiPath := "/api/storage/upload"
	if storagePath != nil && strings.TrimSpace(*storagePath) != "" {
		apiPath += "?storagePath=" + url.QueryEscape(strings.TrimSpace(*storagePath))
	}

	headers := map[string]string{}
	if strings.TrimSpace(fileName) != "" {
		headers["X-File-Name"] = fileName
	}
	headers["Content-Type"] = "application/octet-stream"

	resp, err := c.call(ctx, node, http.MethodPost, apiPath, body, headers)
	if err != nil {
		return domain.NodeUploadResponse{}, err
	}
	defer resp.Body.Close()

	bodyBytes, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		return domain.NodeUploadResponse{}, fmt.Errorf("read node response: %w", readErr)
	}

	var out domain.NodeUploadResponse
	if err := json.Unmarshal(bodyBytes, &out); err != nil {
		return domain.NodeUploadResponse{}, fmt.Errorf("decode node response: %w", err)
	}
	return out, nil
}

func (c *Client) callJSON(ctx context.Context, node domain.Node, method, apiPath string, body any, out any) error {
	fullURL, cleanPath, err := buildURL(node.BaseURL, apiPath)
	if err != nil {
		return err
	}

	bodyBytes := []byte{}
	if body != nil {
		bodyBytes, err = json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal request body: %w", err)
		}
	}

	for attempt := 1; attempt <= c.cfg.MaxAttempts; attempt++ {
		nonce := c.makeNonce()
		signed, err := Sign(SignInput{
			Method:   method,
			Path:     cleanPath,
			Body:     bodyBytes,
			ClientID: node.ClientID,
			Secret:   node.Secret,
			Now:      c.cfg.Now(),
			Nonce:    nonce,
		})
		if err != nil {
			return fmt.Errorf("sign request: %w", err)
		}

		req, err := http.NewRequestWithContext(ctx, method, fullURL, bytes.NewReader(bodyBytes))
		if err != nil {
			return fmt.Errorf("build request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Client-Id", signed.ClientID)
		req.Header.Set("X-Timestamp", signed.Timestamp)
		req.Header.Set("X-Nonce", signed.Nonce)
		req.Header.Set("X-Body-Sha256", signed.BodySHA256)
		req.Header.Set("X-Signature", signed.Signature)

		resp, err := c.httpClient.Do(req)
		if err != nil {
			if attempt < c.cfg.MaxAttempts {
				c.sleepBackoff(attempt)
				continue
			}
			return fmt.Errorf("node request failed: %w", err)
		}

		respBody, readErr := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if readErr != nil {
			return fmt.Errorf("read node response: %w", readErr)
		}

		switch resp.StatusCode {
		case http.StatusUnauthorized:
			return ErrUnauthorized
		case http.StatusForbidden:
			return ErrForbidden
		case http.StatusNotFound:
			return ErrNotFound
		}

		if resp.StatusCode >= 500 {
			if attempt < c.cfg.MaxAttempts {
				c.sleepBackoff(attempt)
				continue
			}
			return fmt.Errorf("node server error status=%d body=%s", resp.StatusCode, string(respBody))
		}

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return fmt.Errorf("node request unexpected status=%d body=%s", resp.StatusCode, string(respBody))
		}

		if err := json.Unmarshal(respBody, out); err != nil {
			return fmt.Errorf("decode node response: %w", err)
		}
		return nil
	}

	return fmt.Errorf("node request exhausted retries")
}

func (c *Client) call(ctx context.Context, node domain.Node, method, apiPath string, body io.Reader, extraHeaders map[string]string) (*http.Response, error) {
	return c.do(ctx, c.httpClient, node, method, apiPath, body, extraHeaders, false)
}

// do sends a signed request. With passThroughClientErrors, 4xx responses other than
// auth/not-found are returned to the caller instead of being turned into errors.
func (c *Client) do(ctx context.Context, client *http.Client, node domain.Node, method, apiPath string, body io.Reader, extraHeaders map[string]string, passThroughClientErrors bool) (*http.Response, error) {
	fullURL, cleanPath, err := buildURL(node.BaseURL, apiPath)
	if err != nil {
		return nil, err
	}

	var (
		bodyBytes []byte
		bodyHash  string
		bodyPath  string
	)
	if body == nil {
		bodyBytes = []byte{}
		bodyHash = sha256Hex(nil)
	} else {
		tmpFile, createErr := os.CreateTemp("", "lms-node-upload-*")
		if createErr != nil {
			return nil, fmt.Errorf("create temp body file: %w", createErr)
		}
		hasher := sha256.New()
		written, copyErr := io.Copy(io.MultiWriter(tmpFile, hasher), body)
		closeErr := tmpFile.Close()
		if copyErr != nil {
			_ = os.Remove(tmpFile.Name())
			return nil, fmt.Errorf("read request body: %w", copyErr)
		}
		if closeErr != nil {
			_ = os.Remove(tmpFile.Name())
			return nil, fmt.Errorf("close temp body file: %w", closeErr)
		}
		if written < 0 {
			_ = os.Remove(tmpFile.Name())
			return nil, fmt.Errorf("invalid body size")
		}
		bodyPath = tmpFile.Name()
		bodyHash = hex.EncodeToString(hasher.Sum(nil))
		defer os.Remove(bodyPath)
	}

	for attempt := 1; attempt <= c.cfg.MaxAttempts; attempt++ {
		nonce := c.makeNonce()
		signed, err := SignWithBodyHash(SignHashInput{
			Method:     method,
			Path:       cleanPath,
			BodySHA256: bodyHash,
			ClientID:   node.ClientID,
			Secret:     node.Secret,
			Now:        c.cfg.Now(),
			Nonce:      nonce,
		})
		if err != nil {
			return nil, fmt.Errorf("sign request: %w", err)
		}

		var bodyReader io.Reader
		if bodyPath != "" {
			fileBody, openErr := os.Open(bodyPath)
			if openErr != nil {
				return nil, fmt.Errorf("open temp body file: %w", openErr)
			}
			bodyReader = fileBody
		} else if len(bodyBytes) > 0 {
			bodyReader = bytes.NewReader(bodyBytes)
		}

		req, err := http.NewRequestWithContext(ctx, method, fullURL, bodyReader)
		if err != nil {
			return nil, fmt.Errorf("build request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Client-Id", signed.ClientID)
		req.Header.Set("X-Timestamp", signed.Timestamp)
		req.Header.Set("X-Nonce", signed.Nonce)
		req.Header.Set("X-Body-Sha256", signed.BodySHA256)
		req.Header.Set("X-Signature", signed.Signature)
		for key, value := range extraHeaders {
			req.Header.Set(key, value)
		}

		resp, err := client.Do(req)
		if err != nil {
			if attempt < c.cfg.MaxAttempts {
				c.sleepBackoff(attempt)
				continue
			}
			return nil, fmt.Errorf("node request failed: %w", err)
		}

		switch resp.StatusCode {
		case http.StatusUnauthorized:
			resp.Body.Close()
			return nil, ErrUnauthorized
		case http.StatusForbidden:
			resp.Body.Close()
			return nil, ErrForbidden
		case http.StatusNotFound:
			resp.Body.Close()
			return nil, ErrNotFound
		}

		if resp.StatusCode >= 500 {
			resp.Body.Close()
			if attempt < c.cfg.MaxAttempts {
				c.sleepBackoff(attempt)
				continue
			}
			return nil, fmt.Errorf("node server error status=%d", resp.StatusCode)
		}

		if passThroughClientErrors && resp.StatusCode >= 400 {
			return resp, nil
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			payload, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			return nil, fmt.Errorf("node request unexpected status=%d body=%s", resp.StatusCode, string(payload))
		}

		return resp, nil
	}

	return nil, fmt.Errorf("node request exhausted retries")
}

func buildURL(baseURL, apiPath string) (fullURL, cleanPath string, err error) {
	if strings.TrimSpace(baseURL) == "" {
		return "", "", fmt.Errorf("node base url is required")
	}
	u, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return "", "", fmt.Errorf("parse node base url: %w", err)
	}
	apiURL, err := url.Parse(strings.TrimSpace(apiPath))
	if err != nil {
		return "", "", fmt.Errorf("parse node api path: %w", err)
	}
	p := path.Clean("/" + strings.TrimSpace(apiURL.Path))
	u.Path = strings.TrimRight(u.Path, "/") + p
	u.RawQuery = apiURL.RawQuery
	return u.String(), p, nil
}

func (c *Client) sleepBackoff(attempt int) {
	maxJitter := int64(c.cfg.BackoffBase / 2)
	if maxJitter < 1 {
		maxJitter = 1
	}
	jitter := time.Duration(c.cfg.Rand.Int63n(maxJitter))
	time.Sleep(time.Duration(attempt)*c.cfg.BackoffBase + jitter)
}

func (c *Client) makeNonce() string {
	const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, 24)
	for i := range b {
		b[i] = letters[c.cfg.Rand.Intn(len(letters))]
	}
	return string(b)
}

func newStreamClient(headerTimeout time.Duration) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if headerTimeout < 30*time.Second {
		headerTimeout = 30 * time.Second
	}
	transport.ResponseHeaderTimeout = headerTimeout
	return &http.Client{Transport: transport}
}

// DecodeFileName reads the node's X-File-Name header: percent-encoded UTF-8 in current
// nodes, a raw name in older ones.
func DecodeFileName(value string) string {
	if decoded, err := url.PathUnescape(value); err == nil {
		return decoded
	}
	return value
}
