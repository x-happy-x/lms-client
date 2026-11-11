package domain

import (
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
)

// JobPlaylist is a bounded presentation snapshot, not instructions for the worker.
// Jobs sent individually from a selection share ID; Index is the original 1-based position.
type JobPlaylist struct {
	ID         string                  `json:"id"`
	URL        string                  `json:"url"`
	Title      *string                 `json:"title,omitempty"`
	Thumbnail  *string                 `json:"thumbnail,omitempty"`
	EntryCount *int                    `json:"entryCount,omitempty"`
	Index      *int                    `json:"index,omitempty"`
	Entries    []NodeMediaExtractEntry `json:"entries,omitempty"`
}

var playlistID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,100}$`)

func (p *JobPlaylist) Validate(jobType JobType) error {
	if p == nil {
		return nil
	}
	if jobType != JobTypeYTDLP {
		return fmt.Errorf("playlist metadata requires YTDLP job type")
	}
	if !playlistID.MatchString(p.ID) || !playlistURL(p.URL) {
		return fmt.Errorf("invalid playlist identity or URL")
	}
	if len(p.Entries) > 300 {
		return fmt.Errorf("playlist snapshot is limited to 300 entries")
	}
	if p.Title != nil && len(*p.Title) > 1000 {
		return fmt.Errorf("playlist title is too long")
	}
	if p.Thumbnail != nil && !playlistURL(*p.Thumbnail) {
		return fmt.Errorf("invalid playlist thumbnail")
	}
	if p.EntryCount != nil && (*p.EntryCount < 0 || *p.EntryCount > 1_000_000) {
		return fmt.Errorf("invalid playlist count")
	}
	if p.Index != nil && (*p.Index < 1 || (p.EntryCount != nil && *p.EntryCount > 0 && *p.Index > *p.EntryCount)) {
		return fmt.Errorf("invalid playlist index")
	}
	for _, entry := range p.Entries {
		if !playlistURL(entry.URL) || (entry.Thumbnail != nil && !playlistURL(*entry.Thumbnail)) {
			return fmt.Errorf("invalid playlist entry URL")
		}
		if entry.Title != nil && len(*entry.Title) > 1000 {
			return fmt.Errorf("playlist entry title is too long")
		}
		if entry.DurationSeconds != nil && *entry.DurationSeconds < 0 {
			return fmt.Errorf("invalid playlist duration")
		}
	}
	data, _ := json.Marshal(p)
	if len(data) > 256*1024 {
		return fmt.Errorf("playlist snapshot exceeds 256 KiB")
	}
	return nil
}

func playlistURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && len(raw) <= 16384 && u.Host != "" && u.User == nil && (u.Scheme == "http" || u.Scheme == "https")
}
