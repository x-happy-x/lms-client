package nodes

import "errors"

var (
	ErrUnauthorized = errors.New("node unauthorized")
	ErrForbidden    = errors.New("node forbidden")
	ErrNotFound     = errors.New("node resource not found")
)
