import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonicalVideoPage, dedupeVkMedia } from '../lib/media-source.js'
test('VK embeds and tracking links identify the same source video', () => {
 assert.equal(canonicalVideoPage('https://vkvideo.ru/video-220754053_456244731?sh=4'),'https://vkvideo.ru/video-220754053_456244731')
 assert.equal(canonicalVideoPage('https://vk.com/video_ext.php?oid=-220754053&id=456244731&hash=temporary'),'https://vkvideo.ru/video-220754053_456244731')
 for(const url of ['https://vkvideo.ru.evil.test/video-1_2','javascript:alert(1)','https://user:pass@vk.com/video-1_2'])assert.equal(canonicalVideoPage(url),'')
})
test('CDN refreshes deduplicate while different representations remain distinct', () => {
 const base='https://vk2-4.vkuser.net/?mid=12&subId=34&type=5&ct=36&id=7'
 const items=[{url:base+'&sig=old&expires=1',kind:'audio',sizeBytes:100},{url:base+'&expires=2&sig=new',kind:'audio',sizeBytes:110},{url:base.replace('id=7','id=8')+'&sig=new',kind:'audio',sizeBytes:200}]
 const result=dedupeVkMedia(items);assert.equal(result.length,2);assert.equal(result[0].sizeBytes,110);assert.equal(result[1].sizeBytes,200)
})
