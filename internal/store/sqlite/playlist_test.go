package sqlite

import (
	"context"
	"lms-router-control-plane/internal/domain"
	"testing"
	"time"
)

func TestPlaylistSnapshotSurvivesRuntimeUpdates(t *testing.T) {
	db := setupTestDB(t)
	repo := NewJobRepository(db.SQL)
	ctx := context.Background()
	title, thumbnail, count := "Учебная серия", "https://course.test/cover.jpg", 72
	job := domain.Job{ID: "playlist", CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(), Type: domain.JobTypeYTDLP,
		URL: "https://course.test/series", Status: domain.JobStatusQueued,
		Playlist: &domain.JobPlaylist{ID: "group", URL: "https://course.test/series", Title: &title, Thumbnail: &thumbnail, EntryCount: &count, Entries: []domain.NodeMediaExtractEntry{{URL: "https://course.test/lesson", Title: &title}}}}
	if err := repo.Create(ctx, job); err != nil {
		t.Fatal(err)
	}
	read, err := repo.GetByID(ctx, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	read.Status = domain.JobStatusRunning
	if err = repo.Update(ctx, read); err != nil {
		t.Fatal(err)
	}
	list, err := repo.List(ctx, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].Playlist == nil || *list[0].Playlist.Title != title || len(list[0].Playlist.Entries) != 1 || *list[0].Playlist.EntryCount != 72 {
		t.Fatalf("metadata lost after runtime update: %+v", list)
	}
}
