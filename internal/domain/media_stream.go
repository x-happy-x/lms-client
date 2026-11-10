package domain

type NodeMediaRequest struct {
	URL       string `json:"url"`
	MaxHeight *int   `json:"maxHeight,omitempty"`
	MaxFps    *int   `json:"maxFps,omitempty"`
	Direct    bool   `json:"direct,omitempty"`
}
type MediaVariant struct {
	Height        int    `json:"height"`
	FPS           int    `json:"fps"`
	SizeBytes     *int64 `json:"sizeBytes"`
	SizeEstimated bool   `json:"sizeEstimated"`
	Quality       string `json:"quality"`
}
type MediaInfo struct {
	Title           string         `json:"title"`
	DurationSeconds *float64       `json:"durationSeconds"`
	Height          int            `json:"height"`
	FPS             int            `json:"fps"`
	SizeBytes       *int64         `json:"sizeBytes"`
	SizeEstimated   bool           `json:"sizeEstimated"`
	Quality         string         `json:"quality"`
	Variants        []MediaVariant `json:"variants"`
}
type NodeMediaPreview struct {
	SessionID string    `json:"sessionId"`
	ExpiresAt int64     `json:"expiresAt"`
	Info      MediaInfo `json:"info"`
}
