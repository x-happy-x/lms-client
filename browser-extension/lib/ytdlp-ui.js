import { decorateSelects, decorateToggles, hydrateIcons } from './ui.js'

export function profileLabel(value) {
  if (!value) return 'Обычный запрос'
  if (value === 'auto') return 'Автоматически'
  const [client, system] = value.split(':'), [browser, ...version] = client.split('-')
  const names = {chrome:'Chrome',edge:'Edge',safari:'Safari',firefox:'Firefox',tor:'Tor',macos:'macOS',windows:'Windows',android:'Android',ios:'iOS',linux:'Linux'}
  const name = `${names[browser] || browser}${version.length ? ` ${version.join('-')}` : ' · актуальный профиль'}`
  if (!system) return name
  const [os, ...osVersion] = system.split('-')
  return `${name} · ${names[os] || os}${osVersion.length ? ` ${osVersion.join('-')}` : ''}`
}
export async function loadProfileOptions(select, selected, nodeId, status) {
  const generation = select.lmsGeneration = (select.lmsGeneration || 0) + 1
  status.textContent = 'Запрашиваю возможности yt-dlp…'
  let answer
  try { answer = await chrome.runtime.sendMessage({type:'mediaCapabilities',nodeId}) }
  catch (error) { answer = {error:error.message} }
  if (select.lmsGeneration !== generation) return null
  select.replaceChildren(new Option('Обычный запрос', ''))
  const caps = answer?.ok ? answer.result : null
  const aliases = ['auto','chrome','edge','firefox','safari','tor']
  const targets = [...new Set(caps?.impersonationTargets || [])].sort((a,b) => {
    const x=aliases.indexOf(a),y=aliases.indexOf(b)
    if(x>=0||y>=0)return (x<0?100:x)-(y<0?100:y)
    return b.localeCompare(a,'en',{numeric:true})
  })
  for(const target of targets) select.append(new Option(profileLabel(target),target))
  if(selected && ![...select.options].some(option=>option.value===selected)) {
    const option = new Option(`${profileLabel(selected)} · недоступен`,selected);option.disabled=true;select.append(option)
  }
  select.value=selected || '';select.lmsSync?.()
  status.textContent = !caps ? answer?.error || 'Не удалось получить профили ноды' : caps.impersonationSupported ? 'Профиль применяется к запросам yt-dlp. Авторизация браузера не переносится; FFmpeg использует свой сетевой клиент.' : 'Нода не сообщает поддержку impersonation. Обычный режим доступен; для профилей обновите lms-node.'
  return caps
}
const shellQuote = value => /^[a-zA-Z0-9_./:-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\"'\"'")}'`
export async function initDiagnostics(settings) {
  const $ = id=>document.getElementById(id)
  if(!$('diagnostic-form'))return
  decorateSelects($('diagnostic-form'));decorateToggles($('diagnostic-form'));hydrateIcons($('diagnostic-form'))
  let busy=false,allowed=false,available=false
  const run=$('diagnostic-run'), node=$('diagnostic-node'), profile=$('diagnostic-profile')
  const updateButton=()=>{run.disabled=busy||!allowed||!available;run.setAttribute('aria-busy',String(busy))}
  const updateMode=()=>{
    const needsUrl=!['version','profiles'].includes($('diagnostic-mode').value)
    $('diagnostic-url').disabled=!needsUrl;$('diagnostic-url').required=needsUrl;profile.disabled=!needsUrl
  }
  const access=async()=>{
    try{
      const answer=await chrome.runtime.sendMessage({type:'accountStatus'})
      allowed=answer?.ok&&(!answer.enabled||answer.user?.role==='admin')
      $('diagnostic-access').textContent=allowed?'Ручные запросы доступны администратору LMS. Таймаут — 60 с, вывод — до 64 КиБ на поток.':answer?.enabled&&!answer.user?'Войдите через Account для диагностики.':'Для диагностики нужны права администратора LMS.'
    }catch(error){allowed=false;$('diagnostic-access').textContent=error.message}
    updateButton()
  }
  const load=async()=>{
    available=false;updateButton()
    const caps=await loadProfileOptions(profile,profile.value||settings.videoImpersonate||'',node.value,$('diagnostic-profile-status'))
    available=Boolean(caps?.diagnosticsSupported);updateButton()
  }
  $('diagnostic-mode').addEventListener('change',updateMode)
  node.addEventListener('change',()=>{void load()})
  $('diagnostic-form').addEventListener('submit',async event=>{
    event.preventDefault();if(run.disabled)return
    busy=true;updateButton();$('diagnostic-result').textContent='Выполняю запрос на ноде…';$('diagnostic-result').className='result muted'
    $('diagnostic-output').hidden=true
    const mode=$('diagnostic-mode').value, needsUrl=!['version','profiles'].includes(mode)
    try{
      const answer=await chrome.runtime.sendMessage({type:'diagnose',input:{mode,url:needsUrl?$('diagnostic-url').value.trim():undefined,nodeId:node.value||undefined,impersonate:needsUrl?profile.value||undefined:undefined,verbose:$('diagnostic-verbose').checked}})
      if(!answer?.ok)throw new Error(answer?.error||'Не удалось выполнить запрос')
      const result=answer.result
      $('diagnostic-command').textContent=(result.command||[]).map(shellQuote).join(' ')
      $('diagnostic-stdout').textContent=result.stdout||'Вывод пуст'
      $('diagnostic-stderr').textContent=result.stderr||'Сообщений нет'
      $('diagnostic-output').hidden=false
      $('diagnostic-result').textContent=[result.nodeName||'Нода',`код ${result.exitCode}`,`${(result.durationMillis/1000).toFixed(1)} с`,result.timedOut?'истёк таймаут':'',result.truncated?'вывод обрезан':''].filter(Boolean).join(' · ')
      $('diagnostic-result').className=`result ${result.exitCode===0?'ok':'error'}`
    }catch(error){$('diagnostic-result').textContent=error.message;$('diagnostic-result').className='result error'}
    finally{busy=false;updateButton()}
  })
  chrome.runtime.onMessage.addListener(message=>{if(message?.type==='accountChanged'){void access();void load()}})
  updateMode();void access()
  const nodes=await chrome.runtime.sendMessage({type:'destinations'}).catch(()=>null)
  node.replaceChildren(new Option('Автоматически',''))
  for(const item of nodes?.nodes||[])node.append(new Option(`${item.name}${item.status==='offline'?' · не в сети':''}`,item.id))
  node.value=settings.downloadNodeId||'';node.lmsSync?.();await load()
}
