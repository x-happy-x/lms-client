package domain

import "time"

type StorageFileEntry struct {
	Name       string    `json:"name"`
	Path       string    `json:"path"`
	Directory  bool      `json:"directory"`
	SizeBytes  *int64    `json:"sizeBytes,omitempty"`
	ModifiedAt time.Time `json:"modifiedAt"`
	MimeType   string    `json:"mimeType,omitempty"`
}

type StorageFileListing struct {
	Root       string             `json:"root"`
	Path       string             `json:"path"`
	ParentPath *string            `json:"parentPath,omitempty"`
	Entries    []StorageFileEntry `json:"entries"`
	Truncated  bool               `json:"truncated"`
}

type StorageFileMutation struct {
	Root string `json:"root"`
	Path string `json:"path"`
	Name string `json:"name,omitempty"`
}
type StorageFileMutationResult struct {
	Path string `json:"path"`
}
