package domain

import "time"

type Profile struct {
	ID             string
	Name           string
	Type           string
	ExtraArgsJSON  *string
	OutputTemplate *string
	Enabled        bool
	CreatedAt      time.Time
	UpdatedAt      time.Time
}
