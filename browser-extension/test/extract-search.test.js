import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createExtractSearch } from '../lib/extract-search.js'

test('repeated tab activation reuses a pending and successful request', async () => {
  let finish, calls = 0
  const search = createExtractSearch(() => { calls++; return new Promise(resolve => { finish = resolve }) })
  const first = search.request('https://course.test/catalog')
  assert.equal(search.request('https://course.test/catalog'), first)
  await Promise.resolve()
  finish(true)
  assert.equal(await first, true)
  assert.equal(await search.request('https://course.test/catalog'), true)
  assert.equal(calls, 1)
})

test('a failed search can be retried and an explicit refresh bypasses a success', async () => {
  let calls = 0
  const search = createExtractSearch(async () => ++calls > 1)
  assert.equal(await search.request('https://course.test/catalog'), false)
  assert.equal(search.has('https://course.test/catalog'), true)
  assert.equal(await search.request('https://course.test/catalog'), true)
  await search.request('https://course.test/catalog', { force: true })
  assert.equal(calls, 3)
})

test('the catalog and embedded player have independent requests', async () => {
  const requests = []
  const search = createExtractSearch(async (url, options) => { requests.push({ url, ...options }); return true })
  await search.request('https://player.test/lesson')
  await search.request('https://course.test/catalog')
  assert.deepEqual(requests.map(request => request.url), ['https://player.test/lesson', 'https://course.test/catalog'])
})

test('invalidating a search prevents an old completion from replacing the new attempt', async () => {
  let finish, calls = 0
  const search = createExtractSearch(async () => ++calls === 1 ? new Promise(resolve => { finish = resolve }) : true)
  const old = search.request('https://course.test/catalog')
  await Promise.resolve()
  search.invalidate()
  const fresh = search.request('https://course.test/catalog')
  assert.equal(await fresh, true)
  finish(false)
  await old
  assert.equal(search.request('https://course.test/catalog'), fresh)
})
