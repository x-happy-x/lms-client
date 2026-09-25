import assert from 'node:assert/strict'
import { test } from 'node:test'
import { downloadKind, shouldIntercept, sniffKind } from '../lib/intercept.js'
import { displayName, isDownloadable, kindFromContentType, kindOf, normalizeCandidates, normalizeRouterUrl, suggestType } from '../lib/links.js'
import { DEFAULT_SETTINGS, authHeaders, planJob, sendToRouter } from '../lib/router.js'

test('kinds and job types', () => {
  assert.equal(kindOf('https://x.ru/a/Movie.MKV?x=1'), 'video')
  assert.equal(kindOf('https://x.ru/live/index.m3u8'), 'stream')
  assert.equal(kindOf('magnet:?xt=urn:btih:abc'), 'magnet')
  assert.equal(kindOf('https://x.ru/page'), '')
  assert.equal(suggestType('magnet:?xt=urn:btih:abc'), 'TORRENT')
  assert.equal(suggestType('https://x.ru/a.torrent'), 'TORRENT')
  assert.equal(suggestType('https://www.youtube.com/watch?v=1'), 'YTDLP')
  assert.equal(suggestType('https://cdn.x.ru/v/master.m3u8'), 'YTDLP')
  assert.equal(suggestType('https://x.ru/file.zip'), 'DIRECT')
  assert.equal(isDownloadable('https://x.ru/photo.jpg'), false)
  assert.equal(kindFromContentType('application/vnd.apple.mpegurl; charset=utf-8'), 'stream')
  assert.equal(kindFromContentType('video/mp4'), 'video')
})

test('display names', () => {
  assert.equal(displayName('magnet:?xt=urn:btih:abc&dn=Ubuntu+24.04'), 'Ubuntu 24.04')
  assert.equal(displayName('https://x.ru/files/%D1%84%D0%B8%D0%BB%D1%8C%D0%BC.mp4'), 'фильм.mp4')
  assert.equal(displayName('https://x.ru/'), 'x.ru')
})

test('page candidates are resolved, filtered, deduplicated and ordered', () => {
  const items = normalizeCandidates(
    [
      { url: '/files/a.zip', source: 'link' },
      { url: 'https://x.ru/files/a.zip', source: 'link' },
      { url: 'blob:https://x.ru/123', source: 'video' },
      { url: 'https://x.ru/about', source: 'link' },
      { url: 'https://x.ru/img.png', source: 'link' },
      { url: 'magnet:?xt=urn:btih:abc&dn=A', source: 'magnet' },
      { url: 'https://cdn.x.ru/stream?id=5', source: 'video', name: 'Clip' },
      { url: '/get?id=7', source: 'download-attr', name: 'report' }
    ],
    'https://x.ru/page/'
  )
  assert.deepEqual(
    items.map((item) => [item.kind, item.url]),
    [
      ['video', 'https://cdn.x.ru/stream?id=5'],
      ['magnet', 'magnet:?xt=urn:btih:abc&dn=A'],
      ['archive', 'https://x.ru/files/a.zip'],
      ['file', 'https://x.ru/get?id=7']
    ]
  )
  assert.equal(items[0].name, 'Clip')
})

test('router address normalization', () => {
  assert.equal(normalizeRouterUrl('192.168.1.1:8082/'), 'http://192.168.1.1:8082')
  assert.equal(normalizeRouterUrl('https://lms.local/api/ui'), 'https://lms.local')
  assert.equal(normalizeRouterUrl(' '), '')
})

const settings = { ...DEFAULT_SETTINGS, routerUrl: '192.168.1.1:8082' }
const base = normalizeRouterUrl(settings.routerUrl)

test('download interception rules', () => {
  const big = { url: 'https://x.ru/a.iso', state: 'in_progress', totalBytes: 800 * 1024 * 1024 }
  assert.equal(shouldIntercept(settings, big, base, 'me'), true)
  assert.equal(shouldIntercept({ ...settings, interceptDownloads: false }, big, base, 'me'), false)
  assert.equal(shouldIntercept(settings, big, '', 'me'), false, 'no router configured')
  assert.equal(shouldIntercept(settings, { ...big, byExtensionId: 'me' }, base, 'me'), false, 'own fallback download')
  assert.equal(shouldIntercept(settings, { ...big, totalBytes: 1024 }, base, 'me'), false, 'below threshold')
  assert.equal(shouldIntercept(settings, { ...big, totalBytes: -1 }, base, 'me'), true, 'unknown size')
  assert.equal(shouldIntercept(settings, { ...big, url: 'blob:https://x.ru/1' }, base, 'me'), false)
  assert.equal(shouldIntercept(settings, { ...big, url: 'http://192.168.1.1:8082/api/ui/jobs/1/file' }, base, 'me'), false, 'router file')
  assert.equal(shouldIntercept(settings, { ...big, url: 'https://x.ru/doc.pdf' }, base, 'me'), false, 'kind not selected')
  assert.equal(downloadKind({ url: 'https://x.ru/get?id=1', filename: 'C:\\Users\\me\\Downloads\\film.mkv' }), 'video')
  assert.equal(downloadKind({ url: 'https://x.ru/get?id=1', mime: 'application/x-bittorrent' }), 'torrent')
  assert.equal(downloadKind({ url: 'https://x.ru/get?id=1' }), 'file')
})

test('network sniffing keeps streams and media elements, not MSE segments', () => {
  assert.equal(sniffKind('https://cdn.x.ru/master.m3u8', 'application/vnd.apple.mpegurl', 'xmlhttprequest'), 'stream')
  assert.equal(sniffKind('https://cdn.x.ru/manifest', 'application/dash+xml', 'xmlhttprequest'), 'stream')
  assert.equal(sniffKind('https://cdn.x.ru/v.mp4', 'video/mp4', 'media'), 'video')
  assert.equal(sniffKind('https://cdn.x.ru/seg1.ts', 'video/mp2t', 'media'), '')
  assert.equal(sniffKind('https://cdn.x.ru/range', 'video/mp4', 'xmlhttprequest'), '')
  assert.equal(sniffKind('https://x.ru/app.js', 'text/javascript', 'other'), '')
})

const preflight = {
  bestNodeId: 'n2',
  nodes: [
    { nodeId: 'n1', nodeName: 'Offline', status: 'offline', statusText: 'timeout', supportedTypes: [] },
    { nodeId: 'n2', nodeName: 'Fast', status: 'online', supportedTypes: ['DIRECT', 'ARIA2C'], recommendedType: 'ARIA2C', defaultStoragePath: '/d' },
    { nodeId: 'n3', nodeName: 'Tools', status: 'online', supportedTypes: ['DIRECT', 'YTDLP'], recommendedType: 'DIRECT' }
  ]
}

test('job planning picks a node that supports the wanted type', () => {
  assert.deepEqual(planJob(preflight, 'https://x.ru/a.zip'), { nodeId: 'n2', nodeName: 'Fast', type: 'DIRECT', storagePath: '/d' })
  assert.equal(planJob(preflight, 'https://youtube.com/watch?v=1').nodeId, 'n3')
  assert.equal(planJob(preflight, 'https://x.ru/a.zip', 'TORRENT').type, 'ARIA2C', 'falls back to the recommendation')
  assert.throws(() => planJob({ nodes: [preflight.nodes[0]] }, 'https://x.ru/a.zip'), /timeout/)
})

test('sendToRouter posts preflight then the job with auth and speed limit', async () => {
  const calls = []
  const fakeFetch = async (url, init) => {
    calls.push({ url, init })
    const body = url.endsWith('/preflight') ? preflight : { id: 'job-1' }
    return { ok: true, status: 200, text: async () => JSON.stringify(body) }
  }
  const withAuth = { ...settings, username: 'u', password: 'п', maxSpeedBytes: 1048576 }
  const { job, plan } = await sendToRouter(withAuth, 'https://x.ru/a.zip', {}, fakeFetch)
  assert.equal(job.id, 'job-1')
  assert.equal(plan.nodeId, 'n2')
  assert.equal(calls[0].url, 'http://192.168.1.1:8082/api/ui/jobs/preflight')
  assert.equal(calls[1].url, 'http://192.168.1.1:8082/api/ui/jobs')
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    type: 'DIRECT',
    url: 'https://x.ru/a.zip',
    nodeId: 'n2',
    storagePath: '/d',
    startImmediately: true,
    maxSpeedBytes: 1048576
  })
  assert.equal(calls[1].init.headers.Authorization, authHeaders(withAuth).Authorization)
  assert.equal(Buffer.from(authHeaders(withAuth).Authorization.slice(6), 'base64').toString(), 'u:п')
})

test('router errors surface the API message', async () => {
  const fakeFetch = async () => ({ ok: false, status: 400, text: async () => '{"error":"url is required"}' })
  await assert.rejects(sendToRouter(settings, 'https://x.ru/a.zip', {}, fakeFetch), /url is required/)
  await assert.rejects(sendToRouter({ ...settings, routerUrl: '' }, 'https://x.ru/a.zip', {}, fakeFetch), /адрес LMS/)
})
