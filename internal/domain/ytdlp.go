package domain

import "fmt"

// YtDlpOptions is persisted with the job and sent unchanged to the worker.
type YtDlpOptions struct {
	Impersonate    string `json:"impersonate,omitempty"`
	MaxHeight      *int   `json:"maxHeight,omitempty"`
	AudioOnly      bool   `json:"audioOnly,omitempty"`
	Container      string `json:"container,omitempty"`
	Playlist       *bool  `json:"playlist,omitempty"`
	AudioFormat    string `json:"audioFormat,omitempty"`
	MaxFPS         *int   `json:"maxFps,omitempty"`
	StartSeconds   *int   `json:"startSeconds,omitempty"`
	EndSeconds     *int   `json:"endSeconds,omitempty"`
	ForceKeyframes bool   `json:"forceKeyframes,omitempty"`
	EmbedMetadata  bool   `json:"embedMetadata,omitempty"`
}

func (o *YtDlpOptions) Validate(jobType JobType) error {
	if o == nil {
		return nil
	}
	if err := ValidateImpersonation(o.Impersonate); err != nil {
		return err
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
	if o.AudioFormat != "" && o.AudioFormat != "m4a" && o.AudioFormat != "mp3" && o.AudioFormat != "opus" && o.AudioFormat != "flac" && o.AudioFormat != "wav" {
		return fmt.Errorf("invalid audio format")
	}
	if o.MaxFPS != nil && (*o.MaxFPS < 1 || *o.MaxFPS > 240) {
		return fmt.Errorf("invalid FPS")
	}
	if o.StartSeconds != nil && (*o.StartSeconds < 0 || *o.StartSeconds > 604800) {
		return fmt.Errorf("invalid fragment start")
	}
	start := 0
	if o.StartSeconds != nil {
		start = *o.StartSeconds
	}
	if o.EndSeconds != nil && (*o.EndSeconds <= start || *o.EndSeconds > 604800) {
		return fmt.Errorf("fragment end must follow start")
	}
	if o.ForceKeyframes && o.StartSeconds == nil && o.EndSeconds == nil {
		return fmt.Errorf("accurate cuts require a fragment")
	}
	return nil
}
