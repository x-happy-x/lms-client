package domain

import (
	"context"
	"io"
	"net/http"
)

type NodeJobCreateRequest struct {
	Type             string  `json:"type"`
	URL              string  `json:"url"`
	StoragePath      *string `json:"storagePath,omitempty"`
	StartImmediately *bool   `json:"startImmediately,omitempty"`
	MaxSpeedBytes    *int64  `json:"maxSpeedBytes,omitempty"`
}

type NodeJobCreateResponse struct {
	JobID string `json:"jobId"`
}

type NodeJobStatusResponse struct {
	JobID           string   `json:"jobId"`
	Type            string   `json:"type"`
	URL             string   `json:"url"`
	Status          string   `json:"status"`
	Percent         *float64 `json:"percent"`
	TotalBytes      *int64   `json:"totalBytes"`
	SpeedBytes      *int64   `json:"speedBytes"`
	ETASeconds      *int64   `json:"etaSeconds"`
	Message         *string  `json:"message"`
	StartedAt       *string  `json:"startedAt"`
	FinishedAt      *string  `json:"finishedAt"`
	OutputPath      *string  `json:"outputPath"`
	OutputSizeBytes *int64   `json:"outputSizeBytes"`
}

type NodeStorageTarget struct {
	Path       string `json:"path"`
	FreeBytes  int64  `json:"freeBytes"`
	TotalBytes int64  `json:"totalBytes"`
	Writable   bool   `json:"writable"`
	CanFit     *bool  `json:"canFit"`
}

type NodeStorageTargetsResponse struct {
	DefaultPath string              `json:"defaultPath"`
	Targets     []NodeStorageTarget `json:"targets"`
}

type NodeStorageEstimateRequest struct {
	Type string `json:"type"`
	URL  string `json:"url"`
}

type NodeStorageEstimateResponse struct {
	SizeBytes *int64 `json:"sizeBytes"`
	Known     bool   `json:"known"`
	Message   string `json:"message"`
}

type NodeDownloadOption struct {
	Type              string `json:"type"`
	Supported         bool   `json:"supported"`
	ResumeSupported   bool   `json:"resumeSupported"`
	SegmentedPossible bool   `json:"segmentedPossible"`
	Message           string `json:"message"`
}

type NodeJobPreflightResponse struct {
	URL                string               `json:"url"`
	SizeBytes          *int64               `json:"sizeBytes"`
	SizeKnown          bool                 `json:"sizeKnown"`
	RecommendedType    string               `json:"recommendedType"`
	SupportedTypes     []string             `json:"supportedTypes"`
	Options            []NodeDownloadOption `json:"options"`
	DefaultStoragePath string               `json:"defaultStoragePath"`
}

// NodeMediaExtractResponse is what yt-dlp found at a URL on the node (POST /api/jobs/extract):
// one video (Kind "video") or a playlist / page with several videos (Kind "playlist", Entries).
type NodeMediaExtractResponse struct {
	URL             string                  `json:"url"`
	Kind            string                  `json:"kind"`
	Title           *string                 `json:"title,omitempty"`
	Extractor       *string                 `json:"extractor,omitempty"`
	DurationSeconds *int64                  `json:"durationSeconds,omitempty"`
	Thumbnail       *string                 `json:"thumbnail,omitempty"`
	SizeBytes       *int64                  `json:"sizeBytes,omitempty"`
	Entries         []NodeMediaExtractEntry `json:"entries"`
	EntryCount      *int                    `json:"entryCount,omitempty"`
	Truncated       bool                    `json:"truncated"`
}

type NodeMediaExtractEntry struct {
	URL             string  `json:"url"`
	Title           *string `json:"title,omitempty"`
	DurationSeconds *int64  `json:"durationSeconds,omitempty"`
	Thumbnail       *string `json:"thumbnail,omitempty"`
}

type NodeUploadResponse struct {
	OutputPath string `json:"outputPath"`
	SizeBytes  int64  `json:"sizeBytes"`
}

type NodeClient interface {
	CreateJob(ctx context.Context, node Node, req NodeJobCreateRequest) (NodeJobCreateResponse, error)
	GetJob(ctx context.Context, node Node, remoteJobID string) (NodeJobStatusResponse, error)
	CancelJob(ctx context.Context, node Node, remoteJobID string) (NodeJobStatusResponse, error)
	PauseJob(ctx context.Context, node Node, remoteJobID string) (NodeJobStatusResponse, error)
	ResumeJob(ctx context.Context, node Node, remoteJobID string) (NodeJobStatusResponse, error)
	RetryJob(ctx context.Context, node Node, remoteJobID string) (NodeJobStatusResponse, error)
	MoveJobOutput(ctx context.Context, node Node, remoteJobID string, storagePath *string) (NodeJobStatusResponse, error)
	// SetSpeedLimit changes a job's download limit on the node (nil = unlimited).
	SetSpeedLimit(ctx context.Context, node Node, remoteJobID string, maxSpeedBytes *int64) (NodeJobStatusResponse, error)
	DeleteJobOutput(ctx context.Context, node Node, remoteJobID string) (NodeJobStatusResponse, error)
	GetStorageTargets(ctx context.Context, node Node, requiredBytes *int64) (NodeStorageTargetsResponse, error)
	EstimateStorage(ctx context.Context, node Node, req NodeStorageEstimateRequest) (NodeStorageEstimateResponse, error)
	PreflightJob(ctx context.Context, node Node, url string) (NodeJobPreflightResponse, error)
	// ExtractMedia lists the videos yt-dlp finds at url without downloading them.
	ExtractMedia(ctx context.Context, node Node, url string) (NodeMediaExtractResponse, error)
	DownloadJobOutput(ctx context.Context, node Node, remoteJobID string) (io.ReadCloser, string, error)
	// OpenJobOutput/OpenJobPreview return the node's raw response (including 206/4xx) for proxying.
	OpenJobOutput(ctx context.Context, node Node, remoteJobID string, headers map[string]string) (*http.Response, error)
	OpenJobPreview(ctx context.Context, node Node, remoteJobID string) (*http.Response, error)
	UploadFile(ctx context.Context, node Node, storagePath *string, fileName string, body io.Reader) (NodeUploadResponse, error)
}
