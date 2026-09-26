# Router UI API

Base path `/api/ui`, JSON unless noted. Errors: `{"error": "..."}`.

## Jobs

- `POST /api/ui/jobs/preflight` — `{url}`; per-node supported types, size, default path.
  Magnet links skip the HTTP probe and offer `TORRENT` on online nodes.
- `POST /api/ui/jobs` — `{type, url, storagePath?, profileId?, nodeId?, startImmediately?, maxSpeedBytes?}`.
  Types: `DIRECT`, `YTDLP`, `ARIA2C`, `TORRENT`. URLs: `http(s)://` for all types,
  `magnet:?` only for `TORRENT`.
- `GET /api/ui/jobs?active=true`
- `GET /api/ui/jobs/{id}`
- `POST /api/ui/jobs/{id}/cancel|pause|resume|retry` — body `{}`
- `POST /api/ui/jobs/{id}/url` — `{url}`
- `POST /api/ui/jobs/{id}/speed` — `{maxSpeedBytes}` (bytes/s, `null`/`0` = unlimited). Stored on the
  job; if it already runs on a node, the node applies it (HTTP immediately, other types restart
  and resume).
- `POST /api/ui/jobs/{id}/move` — `{targetNodeId?, storagePath?}`
- `GET|HEAD /api/ui/jobs/{id}/file` — streams the job output from its node (not JSON).
  `Range`/`If-Range` are forwarded (206/416 pass through), so downloads resume and
  videos seek. `?inline=1` sets `Content-Disposition: inline` for viewing in the browser.
  Folder outputs (torrents) come as a ZIP. 409 when the job has no output on a node yet.
- `GET /api/ui/jobs/{id}/preview` — JPEG thumbnail for image/video outputs, 404 when
  the node cannot make one.

## Media

- `POST /api/ui/media/extract` — `{url, nodeId?}`. Runs yt-dlp on a node (the given one or the
  fastest online node with `YTDLP`) over the page without downloading and returns
  `{url, kind, title, extractor, durationSeconds?, thumbnail?, sizeBytes?, entries[], entryCount, truncated, nodeId, nodeName}`.
  `kind` is `video` (one video; `url` is the page to send as a `YTDLP` job) or `playlist`
  (playlists, channels, pages with several embedded videos; each entry has `url`, `title`,
  `durationSeconds`, `thumbnail`). Errors: 422 with the yt-dlp message, 409 when no node with
  yt-dlp is online, 501 when the nodes are too old for this endpoint. Can take up to 2 minutes.

## Nodes

- `GET /api/ui/nodes?enabled=true`
- `POST /api/ui/nodes`
- `PUT /api/ui/nodes/{id}`
- `GET /api/ui/nodes/{id}/storage/targets?requiredBytes=`
- `POST /api/ui/nodes/{id}/storage/estimate` — `{type, url}`

## Profiles

- `GET /api/ui/profiles?enabled=true`
- `POST /api/ui/profiles`

## Health

- `GET /api/ui/system/health`
- `GET /api/ui/system/version`
