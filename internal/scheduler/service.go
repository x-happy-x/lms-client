package scheduler

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"lms-router-control-plane/internal/domain"
	"lms-router-control-plane/internal/nodes"
	"lms-router-control-plane/internal/store/sqlite"
)

type Service struct {
	jobRepo    domain.JobRepository
	nodeRepo   domain.NodeRepository
	nodeClient domain.NodeClient

	pollInterval time.Duration
	logger       *slog.Logger
	now          func() time.Time
}

type Config struct {
	PollInterval time.Duration
}

func NewService(jobRepo domain.JobRepository, nodeRepo domain.NodeRepository, nodeClient domain.NodeClient, cfg Config, logger *slog.Logger) *Service {
	if cfg.PollInterval <= 0 {
		cfg.PollInterval = 10 * time.Second
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{
		jobRepo:      jobRepo,
		nodeRepo:     nodeRepo,
		nodeClient:   nodeClient,
		pollInterval: cfg.PollInterval,
		logger:       logger,
		now:          time.Now,
	}
}

func (s *Service) Run(ctx context.Context) error {
	if err := s.tick(ctx); err != nil {
		return err
	}

	ticker := time.NewTicker(s.pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if err := s.tick(ctx); err != nil {
				s.logger.Error("scheduler tick failed", "error", err)
			}
		}
	}
}

func (s *Service) tick(ctx context.Context) error {
	if err := s.dispatchQueued(ctx); err != nil {
		return fmt.Errorf("dispatch queued: %w", err)
	}
	if err := s.pollRunning(ctx); err != nil {
		return fmt.Errorf("poll running: %w", err)
	}
	return nil
}

func (s *Service) dispatchQueued(ctx context.Context) error {
	jobs, err := s.jobRepo.List(ctx, true)
	if err != nil {
		return err
	}
	nodes, err := s.nodeRepo.ListEnabled(ctx)
	if err != nil {
		return err
	}
	if len(nodes) == 0 {
		return nil
	}
	nodeByID := make(map[string]domain.Node, len(nodes))
	for _, n := range nodes {
		nodeByID[n.ID] = n
	}

	for _, job := range jobs {
		if job.Status != domain.JobStatusQueued {
			continue
		}

		node, ok := selectNodeForJob(job, nodes, nodeByID)
		if !ok {
			continue
		}

		resp, err := s.nodeClient.CreateJob(ctx, node, domain.NodeJobCreateRequest{
			Type:        string(job.Type),
			URL:         job.URL,
			StoragePath: job.StoragePath,
		})
		if err != nil {
			s.logger.Warn("dispatch failed", "job_id", job.ID, "node_id", node.ID, "error", err)
			msg := err.Error()
			job.Message = &msg
			job.UpdatedAt = s.now().UTC()
			if updateErr := s.jobRepo.Update(ctx, job); updateErr != nil {
				s.logger.Warn("failed to update job after dispatch error", "job_id", job.ID, "error", updateErr)
			}
			continue
		}

		job.NodeID = &node.ID
		job.RemoteJobID = &resp.JobID
		if err := job.TransitionTo(domain.JobStatusRunning, s.now()); err != nil {
			return err
		}
		if err := s.jobRepo.Update(ctx, job); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) pollRunning(ctx context.Context) error {
	jobs, err := s.jobRepo.List(ctx, true)
	if err != nil {
		return err
	}

	for _, job := range jobs {
		if job.Status != domain.JobStatusRunning || job.NodeID == nil || job.RemoteJobID == nil {
			continue
		}

		node, err := s.nodeRepo.GetByID(ctx, *job.NodeID)
		if err != nil {
			if errors.Is(err, sqlite.ErrNotFound) {
				continue
			}
			return err
		}
		if !node.Enabled {
			continue
		}

		statusResp, err := s.nodeClient.GetJob(ctx, node, *job.RemoteJobID)
		if err != nil {
			s.logger.Warn("poll failed", "job_id", job.ID, "remote_job_id", *job.RemoteJobID, "error", err)
			continue
		}

		job.Percent = statusResp.Percent
		job.TotalBytes = statusResp.TotalBytes
		job.SpeedBytes = statusResp.SpeedBytes
		job.ETASeconds = statusResp.ETASeconds
		job.Message = statusResp.Message
		job.OutputPath = statusResp.OutputPath
		job.OutputSizeBytes = statusResp.OutputSizeBytes
		job.StartedAt = parseRemoteTime(statusResp.StartedAt)
		job.FinishedAt = parseRemoteTime(statusResp.FinishedAt)
		job.UpdatedAt = s.now().UTC()

		switch domain.JobStatus(statusResp.Status) {
		case domain.JobStatusQueued, domain.JobStatusPaused, domain.JobStatusRunning:
			// Keep local job active while remote is queued/running.
		case domain.JobStatusDone, domain.JobStatusError, domain.JobStatusCanceled:
			if err := job.TransitionTo(domain.JobStatus(statusResp.Status), s.now()); err != nil {
				return err
			}
		}

		if err := s.jobRepo.Update(ctx, job); err != nil {
			return err
		}
	}

	return nil
}

func parseRemoteTime(value *string) *time.Time {
	if value == nil || *value == "" {
		return nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, *value)
	if err != nil {
		return nil
	}
	return &parsed
}

func (s *Service) CancelJob(ctx context.Context, jobID string) (domain.Job, error) {
	job, err := s.jobRepo.GetByID(ctx, jobID)
	if err != nil {
		return domain.Job{}, err
	}
	if job.Status.IsTerminal() {
		return job, nil
	}

	if (job.Status == domain.JobStatusRunning || job.Status == domain.JobStatusPaused) && job.NodeID != nil && job.RemoteJobID != nil {
		node, err := s.nodeRepo.GetByID(ctx, *job.NodeID)
		if err != nil {
			return domain.Job{}, err
		}
		if _, err := s.nodeClient.CancelJob(ctx, node, *job.RemoteJobID); err != nil {
			return domain.Job{}, err
		}
	}

	if err := job.TransitionTo(domain.JobStatusCanceled, s.now()); err != nil {
		return domain.Job{}, err
	}
	if err := s.jobRepo.Update(ctx, job); err != nil {
		return domain.Job{}, err
	}

	return job, nil
}

func (s *Service) PauseJob(ctx context.Context, jobID string) (domain.Job, error) {
	job, err := s.jobRepo.GetByID(ctx, jobID)
	if err != nil {
		return domain.Job{}, err
	}
	if job.Status.IsTerminal() || job.Status == domain.JobStatusPaused {
		return job, nil
	}

	if job.Status == domain.JobStatusRunning && job.NodeID != nil && job.RemoteJobID != nil {
		node, err := s.nodeRepo.GetByID(ctx, *job.NodeID)
		if err != nil {
			return domain.Job{}, err
		}
		if _, err := s.nodeClient.PauseJob(ctx, node, *job.RemoteJobID); err != nil {
			return domain.Job{}, err
		}
	}

	if err := job.TransitionTo(domain.JobStatusPaused, s.now()); err != nil {
		return domain.Job{}, err
	}
	if err := s.jobRepo.Update(ctx, job); err != nil {
		return domain.Job{}, err
	}
	return job, nil
}

func (s *Service) ResumeJob(ctx context.Context, jobID string) (domain.Job, error) {
	job, err := s.jobRepo.GetByID(ctx, jobID)
	if err != nil {
		return domain.Job{}, err
	}
	if job.Status.IsTerminal() || job.Status != domain.JobStatusPaused {
		return job, nil
	}

	nextStatus := domain.JobStatusQueued
	if job.NodeID != nil && job.RemoteJobID != nil {
		node, err := s.nodeRepo.GetByID(ctx, *job.NodeID)
		if err != nil {
			return domain.Job{}, err
		}
		if _, err := s.nodeClient.ResumeJob(ctx, node, *job.RemoteJobID); err != nil {
			return domain.Job{}, err
		}
		nextStatus = domain.JobStatusRunning
	}

	if err := job.TransitionTo(nextStatus, s.now()); err != nil {
		return domain.Job{}, err
	}
	if err := s.jobRepo.Update(ctx, job); err != nil {
		return domain.Job{}, err
	}
	return job, nil
}

func (s *Service) RetryJob(ctx context.Context, jobID string) (domain.Job, error) {
	job, err := s.jobRepo.GetByID(ctx, jobID)
	if err != nil {
		return domain.Job{}, err
	}
	if job.Status != domain.JobStatusError && job.Status != domain.JobStatusCanceled {
		return job, nil
	}

	nextStatus := domain.JobStatusQueued
	if job.NodeID != nil && job.RemoteJobID != nil {
		node, err := s.nodeRepo.GetByID(ctx, *job.NodeID)
		if err != nil {
			return domain.Job{}, err
		}
		resp, err := s.nodeClient.RetryJob(ctx, node, *job.RemoteJobID)
		if err != nil {
			if errors.Is(err, nodes.ErrNotFound) {
				job.RemoteJobID = nil
			} else {
				return domain.Job{}, err
			}
		}
		if err == nil {
			switch domain.JobStatus(resp.Status) {
			case domain.JobStatusRunning:
				nextStatus = domain.JobStatusRunning
			default:
				nextStatus = domain.JobStatusQueued
			}
		} else {
			nextStatus = domain.JobStatusQueued
		}
	}

	if err := job.TransitionTo(nextStatus, s.now()); err != nil {
		return domain.Job{}, err
	}
	if err := s.jobRepo.Update(ctx, job); err != nil {
		return domain.Job{}, err
	}
	return job, nil
}

func (s *Service) UpdateJobURL(ctx context.Context, jobID, rawURL string) (domain.Job, error) {
	job, err := s.jobRepo.GetByID(ctx, jobID)
	if err != nil {
		return domain.Job{}, err
	}
	if job.Status == domain.JobStatusDone {
		return domain.Job{}, fmt.Errorf("cannot change URL for completed job")
	}

	if job.NodeID != nil && job.RemoteJobID != nil && (job.Status == domain.JobStatusRunning || job.Status == domain.JobStatusPaused) {
		node, err := s.nodeRepo.GetByID(ctx, *job.NodeID)
		if err != nil {
			return domain.Job{}, err
		}
		if _, err := s.nodeClient.CancelJob(ctx, node, *job.RemoteJobID); err != nil && !errors.Is(err, nodes.ErrNotFound) {
			return domain.Job{}, err
		}
	}

	job.URL = rawURL
	job.RemoteJobID = nil
	job.Percent = nil
	job.TotalBytes = nil
	job.SpeedBytes = nil
	job.ETASeconds = nil
	job.Message = nil
	job.StartedAt = nil
	job.FinishedAt = nil
	job.OutputPath = nil
	job.OutputSizeBytes = nil
	job.ErrorText = nil
	job.UpdatedAt = s.now().UTC()

	if job.Status == domain.JobStatusPaused {
		// Keep the paused state so the user can review the updated link before resuming.
	} else {
		job.Status = domain.JobStatusQueued
	}

	if err := s.jobRepo.Update(ctx, job); err != nil {
		return domain.Job{}, err
	}
	return job, nil
}

func selectNodeForJob(job domain.Job, nodes []domain.Node, nodeByID map[string]domain.Node) (domain.Node, bool) {
	if job.NodeID != nil {
		node, ok := nodeByID[*job.NodeID]
		if !ok {
			return domain.Node{}, false
		}
		return node, true
	}
	return nodes[0], true
}
