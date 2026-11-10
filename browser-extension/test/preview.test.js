import assert from 'node:assert/strict'
import { test } from 'node:test'
import { previewMode, previewUrl, openPreview, forgetPreview } from '../lib/preview.js'

test('preview always uses the LMS player, including extracted page links', () => {
  assert.equal(previewMode({ url: 'https://cdn.example/movie.mp4', page: true }), 'player')
  assert.equal(previewMode({ url: 'https://cdn.example/manifest', kind: 'stream' }), 'player')
  assert.equal(previewMode({ url: 'https://youtube.com/watch?v=1', page: true }), 'player')
  assert.equal(previewMode({ url: 'https://course.example/lesson', page: true }), 'player')
  for (const url of ['file:///private/video.mp4', 'javascript:alert(1)', 'https://user:password@example.com/video']) assert.throws(() => previewUrl(url))
})

test('player URL contains an opaque id, session metadata is removed on close, no job API is called', async () => {
  const values = {}, created = []
  globalThis.chrome = {
    runtime: { getURL: path => `chrome-extension://test/${path}` },
    tabs: { create: async tab => { created.push(tab); return { id: 123 } } },
    storage: { session: {
      get: async key => key === null ? { ...values } : { [key]: values[key] },
      set: async entries => Object.assign(values, entries),
      remove: async keys => { for (const key of [].concat(keys)) delete values[key] }
    } }
  }
  const previous = globalThis.fetch
  globalThis.fetch = () => { throw new Error('Preview must not create a router job') }
  try {
    const url = 'https://cdn.example/video.mp4?signature=private'
    assert.deepEqual(await openPreview({ url, title: 'Lesson', sourceUrl: 'https://example.com/lesson' }), { ok: true, mode: 'player' })
    assert.match(created[0].url, /^chrome-extension:\/\/test\/player.html\?id=[a-f0-9-]{36}$/)
    assert.ok(!created[0].url.includes('private'))
    const key = values['previewTab:123']
    assert.equal(values[key].url, url)
    await forgetPreview(123)
    assert.deepEqual(values, {})
    await openPreview({ url: 'https://youtube.com/watch?v=1', page: true })
    assert.match(created[1].url, /^chrome-extension:\/\/test\/player.html\?id=/)
    assert.equal(values[values['previewTab:123']].page, true)
    await forgetPreview(123)
    assert.deepEqual(values, {})
  } finally { globalThis.fetch = previous }
})
