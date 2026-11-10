package domain

import "fmt"

// YtDlpOptions is persisted with the job and sent unchanged to the worker.
type YtDlpOptions struct {
	MaxHeight *int   `json:"maxHeight,omitempty"`
	AudioOnly bool   `json:"audioOnly,omitempty"`
	Container string `json:"container,omitempty"`
	Playlist  *bool  `json:"playlist,omitempty"`
}

func (o *YtDlpOptions) Validate(jobType JobType) error {
	if o == nil {
		return nil
	}
	if jobType != JobTypeYTDLP {
		return fmt.Errorf("ytdlpOptions require YTDLP job type")
	}
	if o.MaxHeight != nil && (*o.MaxHeight < 144 || *o.MaxHeight > 4320) {
		return fmt.Errorf("maxHeight must be between 144 and 4320")
	}
	if o.Container != "" && o.Container != "auto" && o.Container != "mp4" && o.Container != "mkv" {
		return fmt.Errorf("container must be auto, mp4 or mkv")
	}
	return nil
}
