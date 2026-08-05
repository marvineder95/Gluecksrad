// Package migrations exportiert das eingebettete FS mit den goose-Migrationsdateien.
package migrations

import "embed"

// FS enthält alle *.sql-Migrationsdateien aus dem migrations/-Verzeichnis.
//
//go:embed sql/*.sql
var FS embed.FS
