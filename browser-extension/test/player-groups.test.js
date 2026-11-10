import {test} from 'node:test'
import assert from 'node:assert/strict'
import {normalizePlayers,groupPlayerSources} from '../lib/player-groups.js'
import {extractMedia,health} from '../lib/router.js'
const page='https://course.example/lesson?id=7'
const make=(id,frameId,url=page,extra={})=>normalizePlayers([{id,pageUrl:url,title:'Lesson',sources:[],aliases:[],...extra}],frameId,url)
test('MP4, declared embed and HLS variants form one video while music and file links remain independent',()=>{
 const players={0:make('one',0,page,{sources:['https://cdn.example/lesson.mp4'],aliases:['https://player.example/embed/7']})}
 const data=groupPlayerSources([
  {url:'https://cdn.example/lesson.mp4',kind:'video',source:'video',frameId:0,playerId:'one'},
  {url:'https://player.example/embed/7',kind:'video',source:'video',frameId:0},
  {url:'https://cdn.example/master.m3u8',kind:'stream',source:'stream',frameId:0},
  {url:'https://cdn.example/index-v1-a1.m3u8',kind:'stream',source:'resource',frameId:0},
  {url:'https://music.example/song.m4a',kind:'audio',source:'audio',frameId:0},
  {url:'https://cdn.example/unrelated.mp4',kind:'video',source:'download-attr',frameId:0}
 ],players)
 assert.equal(data.videos.length,1);assert.equal(data.videos[0].url,page)
 assert.deepEqual(data.items.map(item=>item.url),['https://music.example/song.m4a','https://cdn.example/unrelated.mp4'])
})
test('two players with equal titles stay separate and ambiguous network media are retained',()=>{
 const players={0:[...make('one',0,'https://course.example/first'),...make('two',0,'https://course.example/second')]}
 const item={url:'https://cdn.example/unknown.m3u8',kind:'stream',source:'stream',frameId:0}
 const result=groupPlayerSources([item],players)
 assert.equal(result.videos.length,2);assert.deepEqual(result.items,[item])
 assert.equal(groupPlayerSources([{...item,frameId:3}],{0:make('one',0)}).items.length,1)
})
test('a declared iframe belongs to its parent card; unrelated frame videos stay separate',()=>{
 const embed='https://player.example/embed/7'
 const players={0:make('parent',0,page,{aliases:[embed]}),1:make('child',1,embed),2:make('other',2,'https://player.example/embed/8')}
 const result=groupPlayerSources([],players)
 assert.equal(result.videos.length,2);assert.ok(result.videos.find(video=>video.url===page).aliases.includes(embed))
})
test('invalid player metadata cannot create non-http cards or unbounded ids',()=>{
 assert.deepEqual(normalizePlayers([{id:'valid',pageUrl:'javascript:alert(1)'},{id:'x'.repeat(101),pageUrl:page}],0,page),[])
 assert.equal(normalizePlayers([{id:'ok',pageUrl:page}],0,page)[0].thumbnail,'')
})
test('source 403/410 stays separate from LMS authentication and never triggers bypass or retries',async()=>{
 for(const status of [403,410]){
  let requests=0
  await assert.rejects(()=>extractMedia({routerUrl:'https://lms.example'},page,async()=>{requests++;return new Response(JSON.stringify({error:`[Example] Unable to download webpage: HTTP Error ${status}: denied`}),{status:422})}),error=>error.status===422&&error.code===(status===403?'SOURCE_FORBIDDEN':'SOURCE_GONE')&&error.message.includes(String(status)))
  assert.equal(requests,1)
 }
 await assert.rejects(()=>health({routerUrl:'https://lms.example'},async()=>new Response(JSON.stringify({error:'Нет доступа к LMS'}),{status:403})),error=>error.status===403&&!error.code&&error.message==='Нет доступа к LMS')
})
