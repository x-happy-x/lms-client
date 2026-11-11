package domain

import (
	"strings"
	"testing"
)

func TestPlaylistMetadataValidation(t *testing.T) {
	count, index := 72, 2
	valid := JobPlaylist{ID: "selection-uuid", URL: "https://course.test/series", EntryCount: &count, Index: &index,
		Entries: []NodeMediaExtractEntry{{URL: "https://course.test/lesson-2"}}}
	if err := valid.Validate(JobTypeYTDLP); err != nil {
		t.Fatal(err)
	}
	if err := valid.Validate(JobTypeDirect); err == nil {
		t.Fatal("HTTP jobs must not accept playlist instructions")
	}
	for _, badURL := range []string{"file:///etc/passwd", "https://user:secret@course.test/series", "javascript:alert(1)", "https://"} {
		bad := valid
		bad.URL = badURL
		if bad.Validate(JobTypeYTDLP) == nil {
			t.Fatalf("accepted %q", badURL)
		}
	}
	bad := valid
	bad.Entries = make([]NodeMediaExtractEntry, 301)
	if bad.Validate(JobTypeYTDLP) == nil {
		t.Fatal("accepted unbounded entries")
	}
	longTitle := strings.Repeat("t", 1001)
	bad = valid
	bad.Title = &longTitle
	if bad.Validate(JobTypeYTDLP) == nil {
		t.Fatal("accepted unbounded title")
	}
	bad = valid
	zero := 0
	bad.Index = &zero
	if bad.Validate(JobTypeYTDLP) == nil {
		t.Fatal("accepted zero-based index")
	}
}
