package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"lms-router-control-plane/internal/domain"
)

type ProfileRepository struct {
	db *sql.DB
}

func NewProfileRepository(db *sql.DB) *ProfileRepository {
	return &ProfileRepository{db: db}
}

func (r *ProfileRepository) Create(ctx context.Context, profile domain.Profile) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO profiles (
			id, name, type, extra_args_json, output_template,
			enabled, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`,
		profile.ID,
		profile.Name,
		profile.Type,
		profile.ExtraArgsJSON,
		profile.OutputTemplate,
		boolToInt(profile.Enabled),
		profile.CreatedAt.UTC().Format(timeLayoutRFC3339()),
		profile.UpdatedAt.UTC().Format(timeLayoutRFC3339()),
	)
	if err != nil {
		return fmt.Errorf("insert profile: %w", err)
	}
	return nil
}

func (r *ProfileRepository) GetByID(ctx context.Context, id string) (domain.Profile, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT id, name, type, extra_args_json, output_template,
			enabled, created_at, updated_at
		FROM profiles
		WHERE id = ?
	`, id)

	profile, err := scanProfile(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.Profile{}, ErrNotFound
		}
		return domain.Profile{}, err
	}
	return profile, nil
}

func (r *ProfileRepository) ListEnabled(ctx context.Context) ([]domain.Profile, error) {
	return r.list(ctx, true)
}

func (r *ProfileRepository) ListAll(ctx context.Context) ([]domain.Profile, error) {
	return r.list(ctx, false)
}

func (r *ProfileRepository) Update(ctx context.Context, profile domain.Profile) error {
	res, err := r.db.ExecContext(ctx, `
		UPDATE profiles
		SET name = ?,
			type = ?,
			extra_args_json = ?,
			output_template = ?,
			enabled = ?,
			updated_at = ?
		WHERE id = ?
	`,
		profile.Name,
		profile.Type,
		profile.ExtraArgsJSON,
		profile.OutputTemplate,
		boolToInt(profile.Enabled),
		profile.UpdatedAt.UTC().Format(timeLayoutRFC3339()),
		profile.ID,
	)
	if err != nil {
		return fmt.Errorf("update profile %s: %w", profile.ID, err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected for profile %s: %w", profile.ID, err)
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *ProfileRepository) list(ctx context.Context, enabledOnly bool) ([]domain.Profile, error) {
	query := `
		SELECT id, name, type, extra_args_json, output_template,
			enabled, created_at, updated_at
		FROM profiles
	`
	if enabledOnly {
		query += " WHERE enabled = 1"
	}
	query += " ORDER BY created_at DESC"

	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list profiles: %w", err)
	}
	defer rows.Close()

	profiles := make([]domain.Profile, 0)
	for rows.Next() {
		profile, err := scanProfile(rows)
		if err != nil {
			return nil, err
		}
		profiles = append(profiles, profile)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate profiles: %w", err)
	}

	return profiles, nil
}

func scanProfile(s scanner) (domain.Profile, error) {
	var (
		profile                      domain.Profile
		enabledRaw                   int
		extraArgsRaw, outputTemplate sql.NullString
		createdAtRaw, updatedAtRaw   string
	)
	if err := s.Scan(
		&profile.ID,
		&profile.Name,
		&profile.Type,
		&extraArgsRaw,
		&outputTemplate,
		&enabledRaw,
		&createdAtRaw,
		&updatedAtRaw,
	); err != nil {
		return domain.Profile{}, fmt.Errorf("scan profile: %w", err)
	}

	createdAt, err := parseTime(createdAtRaw)
	if err != nil {
		return domain.Profile{}, fmt.Errorf("parse profile created_at: %w", err)
	}
	updatedAt, err := parseTime(updatedAtRaw)
	if err != nil {
		return domain.Profile{}, fmt.Errorf("parse profile updated_at: %w", err)
	}

	profile.Enabled = enabledRaw == 1
	profile.CreatedAt = createdAt
	profile.UpdatedAt = updatedAt
	profile.ExtraArgsJSON = stringPtrFromNull(extraArgsRaw)
	profile.OutputTemplate = stringPtrFromNull(outputTemplate)

	return profile, nil
}
