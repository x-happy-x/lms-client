package domain

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

type JobType string

const (
	JobTypeDirect JobType = "DIRECT"
	JobTypeYTDLP  JobType = "YTDLP"
	JobTypeAria2c JobType = "ARIA2C"
	// JobTypeTorrent downloads magnet links and .torrent files (aria2c on the node).
	JobTypeTorrent JobType = "TORRENT"
)

// IsMagnetURL reports whether raw is a BitTorrent magnet link.
func IsMagnetURL(raw string) bool {
	return len(raw) >= 8 && strings.EqualFold(raw[:8], "magnet:?")
}

// ValidateJobURL checks that url fits the job type: http(s) for every type, magnet
// links only for TORRENT. An empty type (preflight) accepts both.
func ValidateJobURL(jobType JobType, url string) error {
	lower := strings.ToLower(url)
	switch {
	case strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://"):
		return nil
	case IsMagnetURL(url):
		if jobType == "" || jobType == JobTypeTorrent {
			return nil
		}
		return fmt.Errorf("magnet links are supported only by TORRENT jobs")
	default:
		return fmt.Errorf("url must start with http://, https:// or magnet:?")
	}
}

type JobStatus string

const (
	JobStatusQueued   JobStatus = "QUEUED"
	JobStatusPaused   JobStatus = "PAUSED"
	JobStatusRunning  JobStatus = "RUNNING"
	JobStatusDone     JobStatus = "DONE"
	JobStatusError    JobStatus = "ERROR"
	JobStatusCanceled JobStatus = "CANCELED"
)

var ErrInvalidStatusTransition = errors.New("invalid job status transition")

type Job struct {
	ID          string
	CreatedAt   time.Time
	UpdatedAt   time.Time
	Type        JobType
	URL         string
	StoragePath *string
	ProfileID   *string
	NodeID      *string
	Status      JobStatus
	RemoteJobID *string

	Percent         *float64
	TotalBytes      *int64
	SpeedBytes      *int64
	ETASeconds      *int64
	Message         *string
	StartedAt       *time.Time
	FinishedAt      *time.Time
	OutputPath      *string
	OutputSizeBytes *int64
	ErrorText       *string
	// MaxSpeedBytes limits the node's download speed (bytes/s); nil = unlimited.
	MaxSpeedBytes *int64
}

func (s JobStatus) IsTerminal() bool {
	switch s {
	case JobStatusDone, JobStatusError, JobStatusCanceled:
		return true
	default:
		return false
	}
}

func (s JobStatus) CanTransitionTo(next JobStatus) bool {
	switch s {
	case JobStatusQueued:
		return next == JobStatusRunning || next == JobStatusPaused || next == JobStatusCanceled
	case JobStatusPaused:
		return next == JobStatusQueued || next == JobStatusRunning || next == JobStatusCanceled
	case JobStatusRunning:
		return next == JobStatusDone || next == JobStatusError || next == JobStatusPaused || next == JobStatusCanceled
	case JobStatusDone:
		return false
	case JobStatusError, JobStatusCanceled:
		return next == JobStatusQueued || next == JobStatusRunning
	default:
		return false
	}
}

func (j *Job) TransitionTo(next JobStatus, at time.Time) error {
	if !j.Status.CanTransitionTo(next) {
		return fmt.Errorf("%w: %s -> %s", ErrInvalidStatusTransition, j.Status, next)
	}
	j.Status = next
	j.UpdatedAt = at.UTC()
	return nil
}
