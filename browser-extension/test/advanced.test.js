import { test } from 'node:test'
import assert from 'node:assert/strict'
import { videoOptions, parseTime } from '../lib/preferences.js'
import { prepareMedia, mediaInfo, sendToRouter } from '../lib/router.js'
test('fragment times validate and advanced options remain typed', () => {
  assert.equal(parseTime('1:02:03'), 3723); assert.equal(parseTime(''), null); assert.equal(parseTime('90'), 90)
  for (const input of ['1:60', '-1', '1;touch foo', '604801']) assert.throws(() => parseTime(input))
  assert.deepEqual(videoOptions({videoAudioOnly:true, videoAudioFormat:'opus', videoMaxFps:30, videoStartSeconds:0, videoEndSeconds:90, videoForceKeyframes:true, videoEmbedMetadata:true},false), {audioOnly:true,audioFormat:'opus',startSeconds:0,endSeconds:90,forceKeyframes:true,embedMetadata:true,playlist:false})
})
test('preview asks only LMS and never exposes Account tokens in the stream URL', async () => {
  const calls=[], settings={routerUrl:'https://lms.example',accountToken:'secret',videoMaxHeight:720,videoMaxFps:30}
  const mock=async(url,init)=>{calls.push({url,...init});return new Response(JSON.stringify({streamUrl:'/api/ui/media/stream/'+'a'.repeat(43),info:{height:720}}))}
  const result=await prepareMedia(settings,{url:'https://video.example/watch',page:true},mock)
  assert.equal(result.streamUrl, 'https://lms.example/api/ui/media/stream/'+'a'.repeat(43))
  assert.equal(calls[0].url,'https://lms.example/api/ui/media/preview')
  assert.deepEqual(JSON.parse(calls[0].body),{url:'https://video.example/watch',direct:false,maxHeight:720,maxFps:30})
  assert.equal(calls[0].headers.Authorization,'Bearer secret')
  await assert.rejects(()=>prepareMedia(settings,{url:'https://video.example'},async()=>new Response(JSON.stringify({streamUrl:'https://evil.example/steal'}))), /Некорректный/)
})
test('old workers cannot silently ignore advanced ffmpeg options', async () => {
  let requests=0
  await assert.rejects(()=>sendToRouter({routerUrl:'https://lms.example'},'https://video.example',{type:'YTDLP',ytdlpOptions:{maxFps:30}},async()=>{
    requests++;return new Response(JSON.stringify({nodes:[{nodeId:'old',supportedTypes:['YTDLP'],ytdlpOptionsSupported:true}]}))
  }),/обновите/)
  assert.equal(requests,1)
})
