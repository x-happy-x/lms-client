# Playlist stacks

`POST /api/ui/media/extract` and `/api/ui/media/info` provide the existing read-only
playlist discovery and per-entry quality/size data. The web new-download dialog
analyzes YTDLP links on the selected node and offers one whole-playlist job or
individual selected entries, together with resolution/container/audio options.

`POST /api/ui/jobs` accepts optional `playlist` metadata; all job responses include
it unchanged. This is presentation data and is not sent to the node:

```json
{
  "type": "YTDLP",
  "url": "https://course.example/series",
  "nodeId": "selected-node",
  "ytdlpOptions": {"playlist": true, "maxHeight": 1080},
  "playlist": {
    "id": "client-generated-uuid",
    "url": "https://course.example/series",
    "title": "Photography course",
    "thumbnail": "https://course.example/cover.jpg",
    "entryCount": 72,
    "entries": [{"url": "https://course.example/lesson-1", "title": "Lesson 1"}]
  },
  "startImmediately": true
}
```

For selected entries, each job uses its entry URL, `ytdlpOptions.playlist:false`,
the same playlist identity and a 1-based `playlist.index`. Entries can be omitted
from these snapshots. The web groups these jobs into one expandable stack even
when their statuses differ. Partial submission removes successfully queued entries
from the remaining selection, so retry does not duplicate them.

Metadata is stored in the nullable `jobs.playlist_json` column (migration 006).
There may be at most 300 entries and 256 KiB of metadata. Titles are limited to
1000 UTF-8 bytes, URLs to 16384 bytes and HTTP(S) without credentials, IDs to
100 ASCII letters/digits/underscore/hyphen. Entry counts and indexes are validated.
Old jobs remain valid. Old whole-playlist jobs from the extension are recognized
by `ytdlpOptions.playlist:true` and inspected lazily on expansion.

Whole-playlist progress remains the node's overall job progress; the UI does not
invent per-entry completion. Quality/size are fetched only for visible entries,
at most two concurrent metadata requests, with a bounded in-memory cache.
Entry previews use the existing LMS stream endpoint, with no download job.

No App component wiring or new dialog props are required. Playlist components
import their own `components/jobs/playlist.css`; the global redesign can refine
these styles. `JobItem` additionally accepts optional `label` and `thumbnail`.
