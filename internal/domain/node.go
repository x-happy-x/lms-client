package domain

import "time"

type Node struct {
	ID         string
	Name       string
	BaseURL    string
	ClientID   string
	Secret     string
	Enabled    bool
	LastSeenAt *time.Time
	CapsJSON   *string
	CreatedAt  time.Time
	UpdatedAt  time.Time
}
