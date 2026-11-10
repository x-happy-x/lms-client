import {test} from 'node:test'
import assert from 'node:assert/strict'
import {extractMedia,mediaInfo,prepareMedia,sendToRouter,mediaCapabilities,diagnoseMedia} from '../lib/router.js'
import {videoOptions} from '../lib/preferences.js'
import {profileLabel} from '../lib/ytdlp-ui.js'
test('the saved profile applies to search, inspection and preview preparation',async()=>{
 const settings={routerUrl:'https://lms.example',videoImpersonate:'chrome-152:windows-10'},calls=[]
 const mock=async(url,init)=>{calls.push({url,...init});return new Response(JSON.stringify({streamUrl:'/api/ui/media/stream/'+'a'.repeat(43)}))}
 await extractMedia(settings,'https://course.test/lesson',mock)
 await mediaInfo(settings,'https://course.test/lesson',false,mock)
 await prepareMedia(settings,{url:'https://course.test/lesson',page:true},mock)
 assert.equal(calls.length,3)
 for(const call of calls)assert.equal(JSON.parse(call.body).impersonate,settings.videoImpersonate)
 assert.equal(videoOptions(settings).impersonate,settings.videoImpersonate)
 assert.equal(profileLabel(settings.videoImpersonate),'Chrome 152 · Windows 10')
})
test('an older worker cannot silently ignore impersonation in a download',async()=>{
 let count=0
 await assert.rejects(()=>sendToRouter({routerUrl:'https://lms.example',videoImpersonate:'chrome'},'https://course.test/lesson',{type:'YTDLP'},async()=>{count++;return new Response(JSON.stringify({nodes:[{nodeId:'old',supportedTypes:['YTDLP'],ytdlpOptionsSupported:true,advancedOptionsSupported:true}]}))}),/обновите/)
 assert.equal(count,1)
})
test('diagnostic requests are typed JSON to LMS and do not create jobs',async()=>{
 const calls=[],settings={routerUrl:'https://lms.example',downloadNodeId:'test'}
 const mock=async(url,init)=>{calls.push({url,...init});return new Response('{}')}
 await mediaCapabilities(settings,'node/one',mock)
 await diagnoseMedia(settings,{mode:'formats',url:'https://course.test/lesson',nodeId:'test',impersonate:'chrome',verbose:true},mock)
 assert.equal(calls[0].url,'https://lms.example/api/ui/media/capabilities?nodeId=node%2Fone')
 assert.equal(calls[1].url,'https://lms.example/api/ui/media/diagnose')
 assert.deepEqual(JSON.parse(calls[1].body),{mode:'formats',url:'https://course.test/lesson',nodeId:'test',impersonate:'chrome',verbose:true})
})
