# Router UI API

Base path `/api/ui`, JSON unless noted. Errors: `{"error": "..."}`.

## Jobs

- `POST /api/ui/jobs/preflight` — `{url}`; per-node supported types, size, default path.
  Magnet links skip the HTTP probe and offer `TORRENT` on online nodes.
- `POST /api/ui/jobs` — `{type, url, storagePath?, profileId?, nodeId?, startImmediately?}`.
  Types: `DIRECT`, `YTDLP`, `ARIA2C`, `TORRENT`. URLs: `http(s)://` for all types,
  `magnet:?` only for `TORRENT`.
- `GET /api/ui/jobs?active=true`
- `GET /api/ui/jobs/{id}`
- `POST /api/ui/jobs/{id}/cancel|pause|resume|retry` — body `{}`
- `POST /api/ui/jobs/{id}/url` — `{url}`
- `POST /api/ui/jobs/{id}/move` — `{targetNodeId?, storagePath?}`
- `GET|HEAD /api/ui/jobs/{id}/file` — streams the job output from its node (not JSON).
  `Range`/`If-Range` are forwarded (206/416 pass through), so downloads resume and
  videos seek. `?inline=1` sets `Content-Disposition: inline` for viewing in the browser.
  Folder outputs (torrents) come as a ZIP. 409 when the job has no output on a node yet.
- `GET /api/ui/jobs/{id}/preview` — JPEG thumbnail for image/video outputs, 404 when
  the node cannot make one.

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
