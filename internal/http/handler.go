package http

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"lms-router-control-plane/internal/domain"
	"lms-router-control-plane/internal/store/sqlite"
)

type JobController interface {
	CancelJob(ctx context.Context, jobID string) (domain.Job, error)
	PauseJob(ctx context.Context, jobID string) (domain.Job, error)
	ResumeJob(ctx context.Context, jobID string) (domain.Job, error)
	RetryJob(ctx context.Context, jobID string) (domain.Job, error)
	UpdateJobURL(ctx context.Context, jobID, rawURL string) (domain.Job, error)
}

type Dependencies struct {
	DB            *sql.DB
	Version       string
	JobRepo       domain.JobRepository
	NodeRepo      domain.NodeRepository
	ProfileRepo   domain.ProfileRepository
	JobController JobController
	NodeClient    domain.NodeClient
	StaticDir     string
}

type Handler struct {
	db            *sql.DB
	version       string
	jobRepo       domain.JobRepository
	nodeRepo      domain.NodeRepository
	profileRepo   domain.ProfileRepository
	jobController JobController
	nodeClient    domain.NodeClient
	httpClient    *http.Client
}

type createJobRequest struct {
	Type             string  `json:"type"`
	URL              string  `json:"url"`
	StoragePath      *string `json:"storagePath,omitempty"`
	ProfileID        *string `json:"profileId,omitempty"`
	NodeID           *string `json:"nodeId,omitempty"`
	StartImmediately *bool   `json:"startImmediately,omitempty"`
}

type jobPreflightRequest struct {
	URL string `json:"url"`
}

type jobPreflightNodeOptionResponse struct {
	Type              string `json:"type"`
	Supported         bool   `json:"supported"`
	ResumeSupported   bool   `json:"resumeSupported"`
	SegmentedPossible bool   `json:"segmentedPossible"`
	Message           string `json:"message"`
}

type jobPreflightNodeResponse struct {
	NodeID             string                           `json:"nodeId"`
	NodeName           string                           `json:"nodeName"`
	Status             string                           `json:"status"`
	StatusText         string                           `json:"statusText"`
	PingMs             *int64                           `json:"pingMs,omitempty"`
	URL                string                           `json:"url"`
	SizeBytes          *int64                           `json:"sizeBytes,omitempty"`
	SizeKnown          bool                             `json:"sizeKnown"`
	RecommendedType    string                           `json:"recommendedType,omitempty"`
	SupportedTypes     []string                         `json:"supportedTypes"`
	Options            []jobPreflightNodeOptionResponse `json:"options"`
	DefaultStoragePath string                           `json:"defaultStoragePath,omitempty"`
	Error              *string                          `json:"error,omitempty"`
}

type jobPreflightResponse struct {
	URL        string                     `json:"url"`
	BestNodeID *string                    `json:"bestNodeId,omitempty"`
	Nodes      []jobPreflightNodeResponse `json:"nodes"`
}

type createNodeRequest struct {
	Name     string  `json:"name"`
	BaseURL  string  `json:"baseUrl"`
	ClientID string  `json:"clientId"`
	Secret   string  `json:"secret"`
	Enabled  *bool   `json:"enabled,omitempty"`
	CapsJSON *string `json:"capsJson,omitempty"`
}

type updateNodeRequest struct {
	Name     string  `json:"name"`
	BaseURL  string  `json:"baseUrl"`
	ClientID string  `json:"clientId"`
	Secret   string  `json:"secret"`
	Enabled  *bool   `json:"enabled,omitempty"`
	CapsJSON *string `json:"capsJson,omitempty"`
}

type moveJobRequest struct {
	TargetNodeID *string `json:"targetNodeId,omitempty"`
	StoragePath  *string `json:"storagePath,omitempty"`
}

type updateJobURLRequest struct {
	URL string `json:"url"`
}

type estimateStorageRequest struct {
	Type string `json:"type"`
	URL  string `json:"url"`
}

type createProfileRequest struct {
	Name           string  `json:"name"`
	Type           string  `json:"type"`
	ExtraArgsJSON  *string `json:"extraArgsJson,omitempty"`
	OutputTemplate *string `json:"outputTemplate,omitempty"`
	Enabled        *bool   `json:"enabled,omitempty"`
}

type jobResponse struct {
	ID              string   `json:"id"`
	CreatedAt       string   `json:"createdAt"`
	UpdatedAt       string   `json:"updatedAt"`
	Type            string   `json:"type"`
	URL             string   `json:"url"`
	StoragePath     *string  `json:"storagePath,omitempty"`
	ProfileID       *string  `json:"profileId,omitempty"`
	NodeID          *string  `json:"nodeId,omitempty"`
	Status          string   `json:"status"`
	RemoteJobID     *string  `json:"remoteJobId,omitempty"`
	Percent         *float64 `json:"percent,omitempty"`
	TotalBytes      *int64   `json:"totalBytes,omitempty"`
	SpeedBytes      *int64   `json:"speedBytes,omitempty"`
	ETASeconds      *int64   `json:"etaSeconds,omitempty"`
	Message         *string  `json:"message,omitempty"`
	StartedAt       *string  `json:"startedAt,omitempty"`
	FinishedAt      *string  `json:"finishedAt,omitempty"`
	OutputPath      *string  `json:"outputPath,omitempty"`
	OutputSizeBytes *int64   `json:"outputSizeBytes,omitempty"`
	ErrorText       *string  `json:"errorText,omitempty"`
}

type nodeResponse struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	BaseURL        string   `json:"baseUrl"`
	ClientID       string   `json:"clientId"`
	Enabled        bool     `json:"enabled"`
	Status         string   `json:"status"`
	StatusText     string   `json:"statusText"`
	PingMs         *int64   `json:"pingMs,omitempty"`
	AvailableTypes []string `json:"availableTypes,omitempty"`
	LastSeenAt     *string  `json:"lastSeenAt,omitempty"`
	CapsJSON       *string  `json:"capsJson,omitempty"`
	CreatedAt      string   `json:"createdAt"`
	UpdatedAt      string   `json:"updatedAt"`
}

type nodeStorageTargetResponse struct {
	Path       string `json:"path"`
	FreeBytes  int64  `json:"freeBytes"`
	TotalBytes int64  `json:"totalBytes"`
	Writable   bool   `json:"writable"`
	CanFit     *bool  `json:"canFit,omitempty"`
}

type nodeStorageTargetsResponse struct {
	NodeID      string                      `json:"nodeId"`
	NodeName    string                      `json:"nodeName"`
	DefaultPath string                      `json:"defaultPath"`
	Targets     []nodeStorageTargetResponse `json:"targets"`
}

type nodeStorageEstimateResponse struct {
	NodeID    string `json:"nodeId"`
	NodeName  string `json:"nodeName"`
	SizeBytes *int64 `json:"sizeBytes,omitempty"`
	Known     bool   `json:"known"`
	Message   string `json:"message"`
}

type profileResponse struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Type           string  `json:"type"`
	ExtraArgsJSON  *string `json:"extraArgsJson,omitempty"`
	OutputTemplate *string `json:"outputTemplate,omitempty"`
	Enabled        bool    `json:"enabled"`
	CreatedAt      string  `json:"createdAt"`
	UpdatedAt      string  `json:"updatedAt"`
}

func NewHandler(deps Dependencies) http.Handler {
	h := &Handler{
		db:            deps.DB,
		version:       deps.Version,
		jobRepo:       deps.JobRepo,
		nodeRepo:      deps.NodeRepo,
		profileRepo:   deps.ProfileRepo,
		jobController: deps.JobController,
		nodeClient:    deps.NodeClient,
		httpClient:    &http.Client{Timeout: 1500 * time.Millisecond},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/ui/system/health", h.health)
	mux.HandleFunc("/api/ui/system/version", h.versionInfo)
	mux.HandleFunc("/api/ui/jobs/preflight", h.preflightJob)
	mux.HandleFunc("/api/ui/jobs", h.jobsRoot)
	mux.HandleFunc("/api/ui/jobs/", h.jobsByID)
	mux.HandleFunc("/api/ui/nodes", h.nodesRoot)
	mux.HandleFunc("/api/ui/nodes/", h.nodesByID)
	mux.HandleFunc("/api/ui/profiles", h.profilesRoot)
	if deps.StaticDir != "" {
		mux.HandleFunc("/", spaHandler(deps.StaticDir))
	}
	return mux
}

func spaHandler(staticDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		path := filepath.Join(staticDir, filepath.Clean(r.URL.Path))
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			http.ServeFile(w, r, path)
			return
		}
		http.ServeFile(w, r, filepath.Join(staticDir, "index.html"))
	}
}

func (h *Handler) preflightJob(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.methodNotAllowed(w)
		return
	}
	if h.nodeRepo == nil || h.nodeClient == nil {
		h.internalError(w, "node client is not configured")
		return
	}

	var req jobPreflightRequest
	if err := decodeJSON(r, &req); err != nil {
		h.badRequest(w, err.Error())
		return
	}
	req.URL = strings.TrimSpace(req.URL)
	if req.URL == "" {
		h.badRequest(w, "url is required")
		return
	}
	if !strings.HasPrefix(req.URL, "http://") && !strings.HasPrefix(req.URL, "https://") {
		h.badRequest(w, "url must start with http:// or https://")
		return
	}

	nodes, err := h.nodeRepo.ListEnabled(r.Context())
	if err != nil {
		h.internalError(w, err.Error())
		return
	}

	items := make([]jobPreflightNodeResponse, 0, len(nodes))
	var bestNodeID *string
	var bestPing int64

	for _, node := range nodes {
		status, statusText, pingMs := h.resolveNodeStatus(r.Context(), node)
		item := jobPreflightNodeResponse{
			NodeID:         node.ID,
			NodeName:       node.Name,
			Status:         status,
			StatusText:     statusText,
			PingMs:         pingMs,
			URL:            req.URL,
			SupportedTypes: []string{},
			Options:        []jobPreflightNodeOptionResponse{},
		}

		if status == "online" {
			started := time.Now()
			resp, preflightErr := h.nodeClient.PreflightJob(r.Context(), node, req.URL)
			if preflightErr != nil {
				msg := preflightErr.Error()
				item.Error = &msg
			} else {
				item.PingMs = ptrInt64(time.Since(started).Milliseconds())
				item.SizeBytes = resp.SizeBytes
				item.SizeKnown = resp.SizeKnown
				item.RecommendedType = resp.RecommendedType
				item.SupportedTypes = resp.SupportedTypes
				item.DefaultStoragePath = resp.DefaultStoragePath
				for _, option := range resp.Options {
					item.Options = append(item.Options, jobPreflightNodeOptionResponse{
						Type:              option.Type,
						Supported:         option.Supported,
						ResumeSupported:   option.ResumeSupported,
						SegmentedPossible: option.SegmentedPossible,
						Message:           option.Message,
					})
				}
				if len(item.SupportedTypes) > 0 && item.PingMs != nil && (bestNodeID == nil || *item.PingMs < bestPing) {
					bestPing = *item.PingMs
					bestNodeID = &item.NodeID
				}
			}
		}

		items = append(items, item)
	}

	writeJSON(w, http.StatusOK, jobPreflightResponse{
		URL:        req.URL,
		BestNodeID: bestNodeID,
		Nodes:      items,
	})
}

func (h *Handler) jobsRoot(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		h.createJob(w, r)
	case http.MethodGet:
		h.listJobs(w, r)
	default:
		h.methodNotAllowed(w)
	}
}

func (h *Handler) jobsByID(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/ui/jobs/")
	if rest == "" || strings.Contains(rest, "//") {
		h.notFound(w)
		return
	}
	if strings.HasSuffix(rest, "/cancel") {
		if r.Method != http.MethodPost {
			h.methodNotAllowed(w)
			return
		}
		jobID := strings.TrimSuffix(rest, "/cancel")
		jobID = strings.TrimSuffix(jobID, "/")
		h.cancelJob(w, r, jobID)
		return
	}
	if strings.HasSuffix(rest, "/pause") {
		if r.Method != http.MethodPost {
			h.methodNotAllowed(w)
			return
		}
		jobID := strings.TrimSuffix(rest, "/pause")
		jobID = strings.TrimSuffix(jobID, "/")
		h.pauseJob(w, r, jobID)
		return
	}
	if strings.HasSuffix(rest, "/resume") {
		if r.Method != http.MethodPost {
			h.methodNotAllowed(w)
			return
		}
		jobID := strings.TrimSuffix(rest, "/resume")
		jobID = strings.TrimSuffix(jobID, "/")
		h.resumeJob(w, r, jobID)
		return
	}
	if strings.HasSuffix(rest, "/retry") {
		if r.Method != http.MethodPost {
			h.methodNotAllowed(w)
			return
		}
		jobID := strings.TrimSuffix(rest, "/retry")
		jobID = strings.TrimSuffix(jobID, "/")
		h.retryJob(w, r, jobID)
		return
	}
	if strings.HasSuffix(rest, "/move") {
		if r.Method != http.MethodPost {
			h.methodNotAllowed(w)
			return
		}
		jobID := strings.TrimSuffix(rest, "/move")
		jobID = strings.TrimSuffix(jobID, "/")
		h.moveJob(w, r, jobID)
		return
	}
	if strings.HasSuffix(rest, "/url") {
		if r.Method != http.MethodPost {
			h.methodNotAllowed(w)
			return
		}
		jobID := strings.TrimSuffix(rest, "/url")
		jobID = strings.TrimSuffix(jobID, "/")
		h.updateJobURL(w, r, jobID)
		return
	}
	if strings.Contains(rest, "/") {
		h.notFound(w)
		return
	}
	if r.Method != http.MethodGet {
		h.methodNotAllowed(w)
		return
	}
	h.getJob(w, r, rest)
}

func (h *Handler) nodesRoot(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		h.createNode(w, r)
	case http.MethodGet:
		h.listNodes(w, r)
	default:
		h.methodNotAllowed(w)
	}
}

func (h *Handler) nodesByID(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/ui/nodes/")
	if rest == "" || strings.Contains(rest, "//") {
		h.notFound(w)
		return
	}

	if strings.HasSuffix(rest, "/storage/targets") {
		if r.Method != http.MethodGet {
			h.methodNotAllowed(w)
			return
		}
		nodeID := strings.TrimSuffix(rest, "/storage/targets")
		nodeID = strings.TrimSuffix(nodeID, "/")
		if strings.Contains(nodeID, "/") {
			h.notFound(w)
			return
		}
		h.nodeStorageTargets(w, r, nodeID)
		return
	}

	if strings.HasSuffix(rest, "/storage/estimate") {
		if r.Method != http.MethodPost {
			h.methodNotAllowed(w)
			return
		}
		nodeID := strings.TrimSuffix(rest, "/storage/estimate")
		nodeID = strings.TrimSuffix(nodeID, "/")
		if strings.Contains(nodeID, "/") {
			h.notFound(w)
			return
		}
		h.nodeStorageEstimate(w, r, nodeID)
		return
	}

	if strings.Contains(rest, "/") {
		h.notFound(w)
		return
	}

	switch r.Method {
	case http.MethodPut:
		h.updateNode(w, r, rest)
	default:
		h.methodNotAllowed(w)
	}
}

func (h *Handler) profilesRoot(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		h.createProfile(w, r)
	case http.MethodGet:
		h.listProfiles(w, r)
	default:
		h.methodNotAllowed(w)
	}
}

func (h *Handler) createJob(w http.ResponseWriter, r *http.Request) {
	if h.jobRepo == nil {
		h.internalError(w, "job repo is not configured")
		return
	}

	var req createJobRequest
	if err := decodeJSON(r, &req); err != nil {
		h.badRequest(w, err.Error())
		return
	}
	if strings.TrimSpace(req.Type) == "" {
		h.badRequest(w, "type is required")
		return
	}
	if strings.TrimSpace(req.URL) == "" {
		h.badRequest(w, "url is required")
		return
	}
	if !strings.HasPrefix(req.URL, "http://") && !strings.HasPrefix(req.URL, "https://") {
		h.badRequest(w, "url must start with http:// or https://")
		return
	}

	now := time.Now().UTC()
	status := domain.JobStatusQueued
	if req.StartImmediately != nil && !*req.StartImmediately {
		status = domain.JobStatusPaused
	}
	job := domain.Job{
		ID:          uuid.NewString(),
		CreatedAt:   now,
		UpdatedAt:   now,
		Type:        domain.JobType(strings.ToUpper(req.Type)),
		URL:         req.URL,
		StoragePath: req.StoragePath,
		ProfileID:   req.ProfileID,
		NodeID:      req.NodeID,
		Status:      status,
	}

	if err := h.jobRepo.Create(r.Context(), job); err != nil {
		h.internalError(w, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, toJobResponse(job))
}

func (h *Handler) listJobs(w http.ResponseWriter, r *http.Request) {
	if h.jobRepo == nil {
		h.internalError(w, "job repo is not configured")
		return
	}

	activeOnly := false
	if raw := r.URL.Query().Get("active"); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			h.badRequest(w, "active must be true or false")
			return
		}
		activeOnly = parsed
	}

	jobs, err := h.jobRepo.List(r.Context(), activeOnly)
	if err != nil {
		h.internalError(w, err.Error())
		return
	}

	resp := make([]jobResponse, 0, len(jobs))
	for _, j := range jobs {
		resp = append(resp, toJobResponse(j))
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) getJob(w http.ResponseWriter, r *http.Request, jobID string) {
	if h.jobRepo == nil {
		h.internalError(w, "job repo is not configured")
		return
	}

	job, err := h.jobRepo.GetByID(r.Context(), jobID)
	if err != nil {
		if errors.Is(err, sqlite.ErrNotFound) {
			h.notFound(w)
			return
		}
		h.internalError(w, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, toJobResponse(job))
}

func (h *Handler) cancelJob(w http.ResponseWriter, r *http.Request, jobID string) {
	if h.jobController == nil {
		h.internalError(w, "job controller is not configured")
		return
	}

	job, err := h.jobController.CancelJob(r.Context(), jobID)
	if err != nil {
		if errors.Is(err, sqlite.ErrNotFound) {
			h.notFound(w)
			return
		}
		if errors.Is(err, domain.ErrInvalidStatusTransition) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
			return
		}
		h.internalError(w, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, toJobResponse(job))
}

func (h *Handler) pauseJob(w http.ResponseWriter, r *http.Request, jobID string) {
	if h.jobController == nil {
		h.internalError(w, "job controller is not configured")
		return
	}

	job, err := h.jobController.PauseJob(r.Context(), jobID)
	if err != nil {
		if errors.Is(err, sqlite.ErrNotFound) {
			h.notFound(w)
			return
		}
		if errors.Is(err, domain.ErrInvalidStatusTransition) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
			return
		}
		h.internalError(w, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, toJobResponse(job))
}

func (h *Handler) resumeJob(w http.ResponseWriter, r *http.Request, jobID string) {
	if h.jobController == nil {
		h.internalError(w, "job controller is not configured")
		return
	}

	job, err := h.jobController.ResumeJob(r.Context(), jobID)
	if err != nil {
		if errors.Is(err, sqlite.ErrNotFound) {
			h.notFound(w)
			return
		}
		if errors.Is(err, domain.ErrInvalidStatusTransition) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
			return
		}
		h.internalError(w, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, toJobResponse(job))
}

func (h *Handler) retryJob(w http.ResponseWriter, r *http.Request, jobID string) {
	if h.jobController == nil {
		h.internalError(w, "job controller is not configured")
		return
	}

	job, err := h.jobController.RetryJob(r.Context(), jobID)
	if err != nil {
		if errors.Is(err, sqlite.ErrNotFound) {
			h.notFound(w)
			return
		}
		if errors.Is(err, domain.ErrInvalidStatusTransition) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
			return
		}
		h.internalError(w, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, toJobResponse(job))
}

func (h *Handler) moveJob(w http.ResponseWriter, r *http.Request, jobID string) {
	if h.nodeClient == nil || h.jobRepo == nil || h.nodeRepo == nil {
		h.internalError(w, "node client is not configured")
		return
	}

	var req moveJobRequest
	if err := decodeJSON(r, &req); err != nil {
		h.badRequest(w, err.Error())
		return
	}

	job, err := h.jobRepo.GetByID(r.Context(), jobID)
	if err != nil {
		if errors.Is(err, sqlite.ErrNotFound) {
			h.notFound(w)
			return
		}
		h.internalError(w, err.Error())
		return
	}
	if job.NodeID == nil || job.RemoteJobID == nil {
		h.badRequest(w, "job is not attached to a node")
		return
	}

	sourceNode, err := h.nodeRepo.GetByID(r.Context(), *job.NodeID)
	if err != nil {
		if errors.Is(err, sqlite.ErrNotFound) {
			h.badRequest(w, "source node not found")
			return
		}
		h.internalError(w, err.Error())
		return
	}

	targetNodeID := *job.NodeID
	if req.TargetNodeID != nil && strings.TrimSpace(*req.TargetNodeID) != "" {
		targetNodeID = strings.TrimSpace(*req.TargetNodeID)
	}
	targetNode, err := h.nodeRepo.GetByID(r.Context(), targetNodeID)
	if err != nil {
		if errors.Is(err, sqlite.ErrNotFound) {
			h.badRequest(w, "target node not found")
			return
		}
		h.internalError(w, err.Error())
		return
	}

	now := time.Now().UTC()
	if sourceNode.ID == targetNode.ID {
		remoteResp, err := h.nodeClient.MoveJobOutput(r.Context(), sourceNode, *job.RemoteJobID, req.StoragePath)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
			return
		}
		job.StoragePath = req.StoragePath
		job.OutputPath = remoteResp.OutputPath
		job.UpdatedAt = now
		if err := h.jobRepo.Update(r.Context(), job); err != nil {
			h.internalError(w, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, toJobResponse(job))
		return
	}

	if err := h.transferJobOutputBetweenNodes(r.Context(), &job, sourceNode, targetNode, req.StoragePath); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	job.NodeID = &targetNode.ID
	job.StoragePath = req.StoragePath
	job.UpdatedAt = now
	if err := h.jobRepo.Update(r.Context(), job); err != nil {
		h.internalError(w, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, toJobResponse(job))
}

func (h *Handler) updateJobURL(w http.ResponseWriter, r *http.Request, jobID string) {
	if h.jobController == nil {
		h.internalError(w, "job controller is not configured")
		return
	}

	var req updateJobURLRequest
	if err := decodeJSON(r, &req); err != nil {
		h.badRequest(w, err.Error())
		return
	}
	req.URL = strings.TrimSpace(req.URL)
	if req.URL == "" {
		h.badRequest(w, "url is required")
		return
	}
	if !strings.HasPrefix(req.URL, "http://") && !strings.HasPrefix(req.URL, "https://") {
		h.badRequest(w, "url must start with http:// or https://")
		return
	}

	job, err := h.jobController.UpdateJobURL(r.Context(), jobID, req.URL)
	if err != nil {
		if errors.Is(err, sqlite.ErrNotFound) {
			h.notFound(w)
			return
		}
		if errors.Is(err, domain.ErrInvalidStatusTransition) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, toJobResponse(job))
}

func (h *Handler) createNode(w http.ResponseWriter, r *http.Request) {
	if h.nodeRepo == nil {
		h.internalError(w, "node repo is not configured")
		return
	}

	var req createNodeRequest
	if err := decodeJSON(r, &req); err != nil {
		h.badRequest(w, err.Error())
		return
	}
	if strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.BaseURL) == "" || strings.TrimSpace(req.ClientID) == "" {
		h.badRequest(w, "name, baseUrl and clientId are required")
		return
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	now := time.Now().UTC()
	node := domain.Node{
		ID:        uuid.NewString(),
		Name:      req.Name,
		BaseURL:   req.BaseURL,
		ClientID:  req.ClientID,
		Secret:    req.Secret,
		Enabled:   enabled,
		CapsJSON:  req.CapsJSON,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := h.nodeRepo.Create(r.Context(), node); err != nil {
		h.internalError(w, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, toNodeResponse(node))
}

func (h *Handler) listNodes(w http.ResponseWriter, r *http.Request) {
	if h.nodeRepo == nil {
		h.internalError(w, "node repo is not configured")
		return
	}

	onlyEnabled := false
	if raw := r.URL.Query().Get("enabled"); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			h.badRequest(w, "enabled must be true or false")
			return
		}
		onlyEnabled = parsed
	}

	var (
		nodes []domain.Node
		err   error
	)
	if onlyEnabled {
		nodes, err = h.nodeRepo.ListEnabled(r.Context())
	} else {
		nodes, err = h.nodeRepo.ListAll(r.Context())
	}
	if err != nil {
		h.internalError(w, err.Error())
		return
	}

	resp := h.toNodeResponses(r.Context(), nodes)
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) updateNode(w http.ResponseWriter, r *http.Request, nodeID string) {
	if h.nodeRepo == nil {
		h.internalError(w, "node repo is not configured")
		return
	}

	current, err := h.nodeRepo.GetByID(r.Context(), nodeID)
	if err != nil {
		if errors.Is(err, sqlite.ErrNotFound) {
			h.notFound(w)
			return
		}
		h.internalError(w, err.Error())
		return
	}

	var req updateNodeRequest
	if err := decodeJSON(r, &req); err != nil {
		h.badRequest(w, err.Error())
		return
	}
	if strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.BaseURL) == "" || strings.TrimSpace(req.ClientID) == "" {
		h.badRequest(w, "name, baseUrl and clientId are required")
		return
	}

	enabled := current.Enabled
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	current.Name = req.Name
	current.BaseURL = req.BaseURL
	current.ClientID = req.ClientID
	if strings.TrimSpace(req.Secret) != "" {
		current.Secret = req.Secret
	}
	current.Enabled = enabled
	current.CapsJSON = req.CapsJSON
	current.UpdatedAt = time.Now().UTC()

	if err := h.nodeRepo.Update(r.Context(), current); err != nil {
		if errors.Is(err, sqlite.ErrNotFound) {
			h.notFound(w)
			return
		}
		h.internalError(w, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, toNodeResponse(current))
}

func (h *Handler) nodeStorageTargets(w http.ResponseWriter, r *http.Request, nodeID string) {
	if h.nodeClient == nil || h.nodeRepo == nil {
		h.internalError(w, "node client is not configured")
		return
	}

	node, err := h.nodeRepo.GetByID(r.Context(), nodeID)
	if err != nil {
		if errors.Is(err, sqlite.ErrNotFound) {
			h.notFound(w)
			return
		}
		h.internalError(w, err.Error())
		return
	}

	var requiredBytes *int64
	if raw := strings.TrimSpace(r.URL.Query().Get("requiredBytes")); raw != "" {
		parsed, parseErr := strconv.ParseInt(raw, 10, 64)
		if parseErr != nil || parsed < 0 {
			h.badRequest(w, "requiredBytes must be a positive integer")
			return
		}
		requiredBytes = &parsed
	}

	resp, err := h.nodeClient.GetStorageTargets(r.Context(), node, requiredBytes)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	items := make([]nodeStorageTargetResponse, 0, len(resp.Targets))
	for _, target := range resp.Targets {
		items = append(items, nodeStorageTargetResponse{
			Path:       target.Path,
			FreeBytes:  target.FreeBytes,
			TotalBytes: target.TotalBytes,
			Writable:   target.Writable,
			CanFit:     target.CanFit,
		})
	}
	writeJSON(w, http.StatusOK, nodeStorageTargetsResponse{
		NodeID:      node.ID,
		NodeName:    node.Name,
		DefaultPath: resp.DefaultPath,
		Targets:     items,
	})
}

func (h *Handler) nodeStorageEstimate(w http.ResponseWriter, r *http.Request, nodeID string) {
	if h.nodeClient == nil || h.nodeRepo == nil {
		h.internalError(w, "node client is not configured")
		return
	}

	node, err := h.nodeRepo.GetByID(r.Context(), nodeID)
	if err != nil {
		if errors.Is(err, sqlite.ErrNotFound) {
			h.notFound(w)
			return
		}
		h.internalError(w, err.Error())
		return
	}

	var req estimateStorageRequest
	if err := decodeJSON(r, &req); err != nil {
		h.badRequest(w, err.Error())
		return
	}
	if strings.TrimSpace(req.Type) == "" || strings.TrimSpace(req.URL) == "" {
		h.badRequest(w, "type and url are required")
		return
	}

	resp, err := h.nodeClient.EstimateStorage(r.Context(), node, domain.NodeStorageEstimateRequest{
		Type: strings.ToUpper(strings.TrimSpace(req.Type)),
		URL:  strings.TrimSpace(req.URL),
	})
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, nodeStorageEstimateResponse{
		NodeID:    node.ID,
		NodeName:  node.Name,
		SizeBytes: resp.SizeBytes,
		Known:     resp.Known,
		Message:   resp.Message,
	})
}

func (h *Handler) createProfile(w http.ResponseWriter, r *http.Request) {
	if h.profileRepo == nil {
		h.internalError(w, "profile repo is not configured")
		return
	}

	var req createProfileRequest
	if err := decodeJSON(r, &req); err != nil {
		h.badRequest(w, err.Error())
		return
	}
	if strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.Type) == "" {
		h.badRequest(w, "name and type are required")
		return
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	now := time.Now().UTC()
	profile := domain.Profile{
		ID:             uuid.NewString(),
		Name:           req.Name,
		Type:           req.Type,
		ExtraArgsJSON:  req.ExtraArgsJSON,
		OutputTemplate: req.OutputTemplate,
		Enabled:        enabled,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := h.profileRepo.Create(r.Context(), profile); err != nil {
		h.internalError(w, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, toProfileResponse(profile))
}

func (h *Handler) listProfiles(w http.ResponseWriter, r *http.Request) {
	if h.profileRepo == nil {
		h.internalError(w, "profile repo is not configured")
		return
	}

	onlyEnabled := false
	if raw := r.URL.Query().Get("enabled"); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			h.badRequest(w, "enabled must be true or false")
			return
		}
		onlyEnabled = parsed
	}

	var (
		profiles []domain.Profile
		err      error
	)
	if onlyEnabled {
		profiles, err = h.profileRepo.ListEnabled(r.Context())
	} else {
		profiles, err = h.profileRepo.ListAll(r.Context())
	}
	if err != nil {
		h.internalError(w, err.Error())
		return
	}

	resp := make([]profileResponse, 0, len(profiles))
	for _, p := range profiles {
		resp = append(resp, toProfileResponse(p))
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) health(w http.ResponseWriter, _ *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	status := http.StatusOK
	resp := map[string]any{
		"status": "ok",
		"db":     "ok",
	}
	if err := h.db.PingContext(ctx); err != nil {
		status = http.StatusServiceUnavailable
		resp["status"] = "degraded"
		resp["db"] = "error"
		resp["error"] = err.Error()
	}

	writeJSON(w, status, resp)
}

func (h *Handler) versionInfo(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"service": "routerd",
		"version": h.version,
		"go":      runtime.Version(),
	})
}

func toJobResponse(j domain.Job) jobResponse {
	var startedAt *string
	if j.StartedAt != nil {
		s := j.StartedAt.UTC().Format(time.RFC3339)
		startedAt = &s
	}
	var finishedAt *string
	if j.FinishedAt != nil {
		s := j.FinishedAt.UTC().Format(time.RFC3339)
		finishedAt = &s
	}
	return jobResponse{
		ID:              j.ID,
		CreatedAt:       j.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:       j.UpdatedAt.UTC().Format(time.RFC3339),
		Type:            string(j.Type),
		URL:             j.URL,
		StoragePath:     j.StoragePath,
		ProfileID:       j.ProfileID,
		NodeID:          j.NodeID,
		Status:          string(j.Status),
		RemoteJobID:     j.RemoteJobID,
		Percent:         j.Percent,
		TotalBytes:      j.TotalBytes,
		SpeedBytes:      j.SpeedBytes,
		ETASeconds:      j.ETASeconds,
		Message:         j.Message,
		StartedAt:       startedAt,
		FinishedAt:      finishedAt,
		OutputPath:      j.OutputPath,
		OutputSizeBytes: j.OutputSizeBytes,
		ErrorText:       j.ErrorText,
	}
}

func toNodeResponse(n domain.Node) nodeResponse {
	var lastSeen *string
	if n.LastSeenAt != nil {
		s := n.LastSeenAt.UTC().Format(time.RFC3339)
		lastSeen = &s
	}
	return nodeResponse{
		ID:             n.ID,
		Name:           n.Name,
		BaseURL:        n.BaseURL,
		ClientID:       n.ClientID,
		Enabled:        n.Enabled,
		Status:         "unknown",
		StatusText:     "Node status has not been checked yet.",
		AvailableTypes: parseAvailableTypes(n.CapsJSON),
		LastSeenAt:     lastSeen,
		CapsJSON:       n.CapsJSON,
		CreatedAt:      n.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:      n.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func (h *Handler) toNodeResponses(ctx context.Context, nodes []domain.Node) []nodeResponse {
	resp := make([]nodeResponse, len(nodes))

	var wg sync.WaitGroup
	for i, node := range nodes {
		wg.Add(1)
		go func(i int, node domain.Node) {
			defer wg.Done()
			item := toNodeResponse(node)
			item.Status, item.StatusText, item.PingMs = h.resolveNodeStatus(ctx, node)
			resp[i] = item
		}(i, node)
	}
	wg.Wait()

	return resp
}

func (h *Handler) resolveNodeStatus(ctx context.Context, node domain.Node) (string, string, *int64) {
	if !node.Enabled {
		return "disabled", "Node is disabled in the router and will not receive new jobs.", nil
	}

	if pingMs, ok := h.probeNode(ctx, node.BaseURL); ok {
		return "online", "Node answered the health check and is reachable now.", ptrInt64(pingMs)
	}

	if node.LastSeenAt == nil {
		return "never_seen", "Router has not yet recorded a successful contact with this node.", nil
	}

	return "offline", fmt.Sprintf(
		"Node is not responding now. Last successful contact was %s.",
		node.LastSeenAt.UTC().Format(time.RFC3339),
	), nil
}

func (h *Handler) probeNode(ctx context.Context, baseURL string) (int64, bool) {
	if h.httpClient == nil || strings.TrimSpace(baseURL) == "" {
		return 0, false
	}

	u, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return 0, false
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/actuator/health"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return 0, false
	}

	started := time.Now()
	resp, err := h.httpClient.Do(req)
	if err != nil {
		return 0, false
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return 0, false
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<10))
	if err != nil {
		return 0, false
	}

	pingMs := time.Since(started).Milliseconds()
	if len(body) == 0 {
		return pingMs, true
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return pingMs, true
	}

	status, _ := payload["status"].(string)
	return pingMs, status == "" || strings.EqualFold(status, "UP")
}

func ptrInt64(value int64) *int64 {
	return &value
}

func parseAvailableTypes(raw *string) []string {
	defaultTypes := []string{"DIRECT", "YTDLP", "ARIA2C"}
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return defaultTypes
	}

	var list []string
	if err := json.Unmarshal([]byte(*raw), &list); err == nil {
		return normalizeTypeList(list, defaultTypes)
	}

	var payload map[string]any
	if err := json.Unmarshal([]byte(*raw), &payload); err != nil {
		return defaultTypes
	}

	for _, key := range []string{"availableTypes", "types", "jobTypes", "downloadTypes", "capabilities"} {
		items, ok := payload[key]
		if !ok {
			continue
		}
		rawList, ok := items.([]any)
		if !ok {
			continue
		}
		list = make([]string, 0, len(rawList))
		for _, item := range rawList {
			if s, ok := item.(string); ok {
				list = append(list, s)
			}
		}
		if len(list) > 0 {
			return normalizeTypeList(list, defaultTypes)
		}
	}

	return defaultTypes
}

func (h *Handler) transferJobOutputBetweenNodes(ctx context.Context, job *domain.Job, sourceNode, targetNode domain.Node, targetPath *string) error {
	if job.RemoteJobID == nil {
		return fmt.Errorf("job remote id is missing")
	}
	stream, fileName, err := h.nodeClient.DownloadJobOutput(ctx, sourceNode, *job.RemoteJobID)
	if err != nil {
		return fmt.Errorf("download output from source node: %w", err)
	}
	defer stream.Close()

	uploaded, err := h.nodeClient.UploadFile(ctx, targetNode, targetPath, fileName, stream)
	if err != nil {
		return fmt.Errorf("upload output to target node: %w", err)
	}

	if _, err := h.nodeClient.DeleteJobOutput(ctx, sourceNode, *job.RemoteJobID); err != nil {
		return fmt.Errorf("delete source output after transfer: %w", err)
	}

	job.OutputPath = &uploaded.OutputPath
	msg := fmt.Sprintf("moved to node %s", targetNode.Name)
	job.Message = &msg
	return nil
}

func normalizeTypeList(list []string, fallback []string) []string {
	if len(list) == 0 {
		return fallback
	}

	seen := make(map[string]struct{}, len(list))
	out := make([]string, 0, len(list))
	for _, item := range list {
		item = strings.ToUpper(strings.TrimSpace(item))
		if item == "" {
			continue
		}
		if _, ok := seen[item]; ok {
			continue
		}
		seen[item] = struct{}{}
		out = append(out, item)
	}

	if len(out) == 0 {
		return fallback
	}
	return out
}

func toProfileResponse(p domain.Profile) profileResponse {
	return profileResponse{
		ID:             p.ID,
		Name:           p.Name,
		Type:           p.Type,
		ExtraArgsJSON:  p.ExtraArgsJSON,
		OutputTemplate: p.OutputTemplate,
		Enabled:        p.Enabled,
		CreatedAt:      p.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:      p.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func decodeJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return fmt.Errorf("invalid json: %w", err)
	}
	if dec.More() {
		return fmt.Errorf("invalid json: multiple objects are not allowed")
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func (h *Handler) badRequest(w http.ResponseWriter, msg string) {
	writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
}

func (h *Handler) notFound(w http.ResponseWriter) {
	writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
}

func (h *Handler) methodNotAllowed(w http.ResponseWriter) {
	writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
}

func (h *Handler) internalError(w http.ResponseWriter, msg string) {
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": msg})
}
