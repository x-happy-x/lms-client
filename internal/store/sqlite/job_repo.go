package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"lms-router-control-plane/internal/domain"
)

type JobRepository struct {
	db *sql.DB
}

func NewJobRepository(db *sql.DB) *JobRepository {
	return &JobRepository{db: db}
}

func (r *JobRepository) Create(ctx context.Context, job domain.Job) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO jobs (
			id, created_at, updated_at, type, url, profile_id, node_id,
			storage_path, status, remote_job_id, percent, total_bytes, speed_bytes, eta_seconds,
			message, started_at, finished_at, output_path, output_size_bytes, error_text, max_speed_bytes
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		job.ID,
		job.CreatedAt.UTC().Format(timeLayoutRFC3339()),
		job.UpdatedAt.UTC().Format(timeLayoutRFC3339()),
		string(job.Type),
		job.URL,
		job.ProfileID,
		job.NodeID,
		job.StoragePath,
		string(job.Status),
		job.RemoteJobID,
		job.Percent,
		job.TotalBytes,
		job.SpeedBytes,
		job.ETASeconds,
		job.Message,
		timeToNullableString(job.StartedAt),
		timeToNullableString(job.FinishedAt),
		job.OutputPath,
		job.OutputSizeBytes,
		job.ErrorText,
		job.MaxSpeedBytes,
	)
	if err != nil {
		return fmt.Errorf("insert job: %w", err)
	}
	return nil
}

func (r *JobRepository) GetByID(ctx context.Context, id string) (domain.Job, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT id, created_at, updated_at, type, url, profile_id, node_id,
			storage_path, status, remote_job_id, percent, total_bytes, speed_bytes, eta_seconds,
			message, started_at, finished_at, output_path, output_size_bytes, error_text, max_speed_bytes
		FROM jobs
		WHERE id = ?
	`, id)

	job, err := scanJob(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.Job{}, ErrNotFound
		}
		return domain.Job{}, err
	}
	return job, nil
}

func (r *JobRepository) List(ctx context.Context, activeOnly bool) ([]domain.Job, error) {
	query := `
		SELECT id, created_at, updated_at, type, url, profile_id, node_id,
			storage_path, status, remote_job_id, percent, total_bytes, speed_bytes, eta_seconds,
			message, started_at, finished_at, output_path, output_size_bytes, error_text, max_speed_bytes
		FROM jobs
	`
	args := make([]any, 0)
	if activeOnly {
		query += " WHERE status IN ('QUEUED', 'PAUSED', 'RUNNING')"
	}
	query += " ORDER BY created_at DESC"

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list jobs: %w", err)
	}
	defer rows.Close()

	jobs := make([]domain.Job, 0)
	for rows.Next() {
		job, err := scanJob(rows)
		if err != nil {
			return nil, err
		}
		jobs = append(jobs, job)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate jobs: %w", err)
	}
	return jobs, nil
}

func (r *JobRepository) Update(ctx context.Context, job domain.Job) error {
	res, err := r.db.ExecContext(ctx, `
		UPDATE jobs
		SET updated_at = ?,
			type = ?,
			url = ?,
			profile_id = ?,
			node_id = ?,
			storage_path = ?,
			status = ?,
			remote_job_id = ?,
			percent = ?,
			total_bytes = ?,
			speed_bytes = ?,
			eta_seconds = ?,
			message = ?,
			started_at = ?,
			finished_at = ?,
			output_path = ?,
			output_size_bytes = ?,
			error_text = ?,
			max_speed_bytes = ?
		WHERE id = ?
	`,
		job.UpdatedAt.UTC().Format(timeLayoutRFC3339()),
		string(job.Type),
		job.URL,
		job.ProfileID,
		job.NodeID,
		job.StoragePath,
		string(job.Status),
		job.RemoteJobID,
		job.Percent,
		job.TotalBytes,
		job.SpeedBytes,
		job.ETASeconds,
		job.Message,
		timeToNullableString(job.StartedAt),
		timeToNullableString(job.FinishedAt),
		job.OutputPath,
		job.OutputSizeBytes,
		job.ErrorText,
		job.MaxSpeedBytes,
		job.ID,
	)
	if err != nil {
		return fmt.Errorf("update job %s: %w", job.ID, err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected for job %s: %w", job.ID, err)
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

type scanner interface {
	Scan(dest ...any) error
}

func scanJob(s scanner) (domain.Job, error) {
	var (
		job                          domain.Job
		createdAtRaw, updatedAtRaw   string
		typeRaw, statusRaw           string
		profileIDRaw, nodeIDRaw      sql.NullString
		storagePathRaw               sql.NullString
		remoteJobIDRaw               sql.NullString
		percentRaw                   sql.NullFloat64
		totalBytesRaw                sql.NullInt64
		speedBytesRaw, etaSecondsRaw sql.NullInt64
		messageRaw                   sql.NullString
		startedAtRaw                 sql.NullString
		finishedAtRaw                sql.NullString
		outputPathRaw                sql.NullString
		outputSizeBytesRaw           sql.NullInt64
		errorTextRaw                 sql.NullString
		maxSpeedBytesRaw             sql.NullInt64
	)
	if err := s.Scan(
		&job.ID,
		&createdAtRaw,
		&updatedAtRaw,
		&typeRaw,
		&job.URL,
		&profileIDRaw,
		&nodeIDRaw,
		&storagePathRaw,
		&statusRaw,
		&remoteJobIDRaw,
		&percentRaw,
		&totalBytesRaw,
		&speedBytesRaw,
		&etaSecondsRaw,
		&messageRaw,
		&startedAtRaw,
		&finishedAtRaw,
		&outputPathRaw,
		&outputSizeBytesRaw,
		&errorTextRaw,
		&maxSpeedBytesRaw,
	); err != nil {
		return domain.Job{}, fmt.Errorf("scan job: %w", err)
	}

	createdAt, err := parseTime(createdAtRaw)
	if err != nil {
		return domain.Job{}, fmt.Errorf("parse created_at: %w", err)
	}
	updatedAt, err := parseTime(updatedAtRaw)
	if err != nil {
		return domain.Job{}, fmt.Errorf("parse updated_at: %w", err)
	}

	job.CreatedAt = createdAt
	job.UpdatedAt = updatedAt
	job.Type = domain.JobType(typeRaw)
	job.Status = domain.JobStatus(statusRaw)
	job.ProfileID = stringPtrFromNull(profileIDRaw)
	job.NodeID = stringPtrFromNull(nodeIDRaw)
	job.StoragePath = stringPtrFromNull(storagePathRaw)
	job.RemoteJobID = stringPtrFromNull(remoteJobIDRaw)
	job.Percent = float64PtrFromNull(percentRaw)
	job.TotalBytes = int64PtrFromNull(totalBytesRaw)
	job.SpeedBytes = int64PtrFromNull(speedBytesRaw)
	job.ETASeconds = int64PtrFromNull(etaSecondsRaw)
	job.Message = stringPtrFromNull(messageRaw)
	if startedAtRaw.Valid {
		startedAt, err := parseTime(startedAtRaw.String)
		if err != nil {
			return domain.Job{}, fmt.Errorf("parse started_at: %w", err)
		}
		job.StartedAt = &startedAt
	}
	if finishedAtRaw.Valid {
		finishedAt, err := parseTime(finishedAtRaw.String)
		if err != nil {
			return domain.Job{}, fmt.Errorf("parse finished_at: %w", err)
		}
		job.FinishedAt = &finishedAt
	}
	job.OutputPath = stringPtrFromNull(outputPathRaw)
	job.OutputSizeBytes = int64PtrFromNull(outputSizeBytesRaw)
	job.ErrorText = stringPtrFromNull(errorTextRaw)
	job.MaxSpeedBytes = int64PtrFromNull(maxSpeedBytesRaw)

	return job, nil
}

func timeLayoutRFC3339() string {
	return "2006-01-02T15:04:05Z07:00"
}
