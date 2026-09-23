package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"lms-router-control-plane/internal/domain"
)

type NodeRepository struct {
	db *sql.DB
}

func NewNodeRepository(db *sql.DB) *NodeRepository {
	return &NodeRepository{db: db}
}

func (r *NodeRepository) Create(ctx context.Context, node domain.Node) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO nodes (
			id, name, base_url, client_id, secret, enabled,
			last_seen_at, caps_json, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		node.ID,
		node.Name,
		node.BaseURL,
		node.ClientID,
		node.Secret,
		boolToInt(node.Enabled),
		timeToNullableString(node.LastSeenAt),
		node.CapsJSON,
		node.CreatedAt.UTC().Format(timeLayoutRFC3339()),
		node.UpdatedAt.UTC().Format(timeLayoutRFC3339()),
	)
	if err != nil {
		return fmt.Errorf("insert node: %w", err)
	}
	return nil
}

func (r *NodeRepository) GetByID(ctx context.Context, id string) (domain.Node, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT id, name, base_url, client_id, secret, enabled,
			last_seen_at, caps_json, created_at, updated_at
		FROM nodes
		WHERE id = ?
	`, id)

	node, err := scanNode(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.Node{}, ErrNotFound
		}
		return domain.Node{}, err
	}
	return node, nil
}

func (r *NodeRepository) ListEnabled(ctx context.Context) ([]domain.Node, error) {
	return r.list(ctx, true)
}

func (r *NodeRepository) ListAll(ctx context.Context) ([]domain.Node, error) {
	return r.list(ctx, false)
}

func (r *NodeRepository) Update(ctx context.Context, node domain.Node) error {
	res, err := r.db.ExecContext(ctx, `
		UPDATE nodes
		SET name = ?,
			base_url = ?,
			client_id = ?,
			secret = ?,
			enabled = ?,
			last_seen_at = ?,
			caps_json = ?,
			updated_at = ?
		WHERE id = ?
	`,
		node.Name,
		node.BaseURL,
		node.ClientID,
		node.Secret,
		boolToInt(node.Enabled),
		timeToNullableString(node.LastSeenAt),
		node.CapsJSON,
		node.UpdatedAt.UTC().Format(timeLayoutRFC3339()),
		node.ID,
	)
	if err != nil {
		return fmt.Errorf("update node %s: %w", node.ID, err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected for node %s: %w", node.ID, err)
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *NodeRepository) list(ctx context.Context, enabledOnly bool) ([]domain.Node, error) {
	query := `
		SELECT id, name, base_url, client_id, secret, enabled,
			last_seen_at, caps_json, created_at, updated_at
		FROM nodes
	`
	if enabledOnly {
		query += " WHERE enabled = 1"
	}
	query += " ORDER BY created_at DESC"

	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list nodes: %w", err)
	}
	defer rows.Close()

	nodes := make([]domain.Node, 0)
	for rows.Next() {
		node, err := scanNode(rows)
		if err != nil {
			return nil, err
		}
		nodes = append(nodes, node)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate nodes: %w", err)
	}
	return nodes, nil
}

func scanNode(s scanner) (domain.Node, error) {
	var (
		node                       domain.Node
		enabledRaw                 int
		lastSeenRaw, capsJSONRaw   sql.NullString
		createdAtRaw, updatedAtRaw string
	)

	if err := s.Scan(
		&node.ID,
		&node.Name,
		&node.BaseURL,
		&node.ClientID,
		&node.Secret,
		&enabledRaw,
		&lastSeenRaw,
		&capsJSONRaw,
		&createdAtRaw,
		&updatedAtRaw,
	); err != nil {
		return domain.Node{}, fmt.Errorf("scan node: %w", err)
	}

	createdAt, err := parseTime(createdAtRaw)
	if err != nil {
		return domain.Node{}, fmt.Errorf("parse node created_at: %w", err)
	}
	updatedAt, err := parseTime(updatedAtRaw)
	if err != nil {
		return domain.Node{}, fmt.Errorf("parse node updated_at: %w", err)
	}

	node.Enabled = enabledRaw == 1
	node.CreatedAt = createdAt
	node.UpdatedAt = updatedAt
	node.CapsJSON = stringPtrFromNull(capsJSONRaw)

	if lastSeenRaw.Valid {
		lastSeen, err := parseTime(lastSeenRaw.String)
		if err != nil {
			return domain.Node{}, fmt.Errorf("parse node last_seen_at: %w", err)
		}
		node.LastSeenAt = &lastSeen
	}

	return node, nil
}
