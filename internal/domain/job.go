package domain

import (
	"errors"
	"fmt"
	"time"
)

type JobType string

const (
	JobTypeDirect JobType = "DIRECT"
	JobTypeYTDLP  JobType = "YTDLP"
	JobTypeAria2c JobType = "ARIA2C"
)

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
