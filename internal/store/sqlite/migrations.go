package sqlite

import "embed"

//go:embed migration/*.sql
var migrationFiles embed.FS
