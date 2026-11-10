import assert from 'node:assert/strict'
import { test } from 'node:test'
import { discoveryFilterReason, discoveryMinMb, filterDiscoveries, parseIgnoredExtensions } from '../lib/discovery-filter.js'
import { DEFAULT_SETTINGS } from '../lib/router.js'

const video = (sizeBytes) => ({ url: 'https://cdn.example/video.mp4', sizeBytes })
test('default discovery filter hides MP3 including encoded paths and extensionless MIME responses', () => {
  for (const item of [
    { url: 'https://cdn.example/track.MP3?token=1', sizeBytes: 10e6 },
    { url: 'https://cdn.example/track%2Emp3' },
    { url: 'https://cdn.example/audio?id=1', contentType: 'Audio/MPEG; charset=binary' }
  ]) assert.equal(discoveryFilterReason(item, DEFAULT_SETTINGS), 'extension')
  assert.equal(discoveryFilterReason({ url: 'https://cdn.example/watch?filename=track.mp3' }, DEFAULT_SETTINGS), '')
  assert.equal(discoveryFilterReason({ ...video(), contentType: 'audio/mpeg' }, DEFAULT_SETTINGS), '')
})

test('known full size is filtered below 1 MiB while the boundary and unknown sizes remain visible', () => {
  assert.equal(discoveryFilterReason(video(1024 ** 2 - 1), DEFAULT_SETTINGS), 'size')
  assert.equal(discoveryFilterReason(video(1024 ** 2), DEFAULT_SETTINGS), '')
  for (const size of [undefined, null, 0, -1, NaN, Infinity]) assert.equal(discoveryFilterReason(video(size), DEFAULT_SETTINGS), '')
  assert.deepEqual(filterDiscoveries([video(100), video(), video(2 * 1024 ** 2)], DEFAULT_SETTINGS), [video(), video(2 * 1024 ** 2)])
})

test('settings accept common extension syntax and can disable either filter independently', () => {
  assert.deepEqual(parseIgnoredExtensions(' .MP3, *.WebM; mp3\n.tar.gz, invalid?name'), ['mp3', 'webm', 'tar.gz'])
  assert.deepEqual(parseIgnoredExtensions(''), [])
  assert.equal(discoveryFilterReason({ url: 'https://cdn.example/archive.TAR.GZ' }, { discoveryIgnoredExtensions: ['tar.gz'] }), 'extension')
  assert.equal(discoveryFilterReason(video(100), { ...DEFAULT_SETTINGS, discoveryMinMb: 0 }), '')
  assert.equal(discoveryFilterReason({ url: 'https://cdn.example/track.mp3', sizeBytes: 2e6 }, { ...DEFAULT_SETTINGS, discoveryIgnoredExtensions: [] }), '')
  assert.equal(discoveryMinMb(-5), 0)
  assert.equal(discoveryMinMb(NaN), 1)
})
