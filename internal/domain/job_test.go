package domain

import (
	"errors"
	"testing"
	"time"
)

func TestJobStatusTransitions(t *testing.T) {
	t.Parallel()

	job := Job{Status: JobStatusQueued}
	now := time.Now().UTC()

	if err := job.TransitionTo(JobStatusRunning, now); err != nil {
		t.Fatalf("queued->running failed: %v", err)
	}
	if err := job.TransitionTo(JobStatusPaused, now.Add(time.Second)); err != nil {
		t.Fatalf("running->paused failed: %v", err)
	}
	if err := job.TransitionTo(JobStatusRunning, now.Add(2*time.Second)); err != nil {
		t.Fatalf("paused->running failed: %v", err)
	}
	if err := job.TransitionTo(JobStatusDone, now.Add(3*time.Second)); err != nil {
		t.Fatalf("running->done failed: %v", err)
	}
	if err := job.TransitionTo(JobStatusRunning, now.Add(4*time.Second)); !errors.Is(err, ErrInvalidStatusTransition) {
		t.Fatalf("expected invalid transition error, got: %v", err)
	}
}

func TestJobStatusIsTerminal(t *testing.T) {
	t.Parallel()

	if !JobStatusDone.IsTerminal() || !JobStatusError.IsTerminal() || !JobStatusCanceled.IsTerminal() {
		t.Fatalf("terminal statuses are not recognized")
	}
	if JobStatusQueued.IsTerminal() || JobStatusPaused.IsTerminal() || JobStatusRunning.IsTerminal() {
		t.Fatalf("non-terminal statuses are marked as terminal")
	}
}
