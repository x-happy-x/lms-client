import { icon } from './ui.js'

const roles = { viewer: 'Просмотр', editor: 'Редактор', admin: 'Администратор' }

export function initAccountUI({ compact = false } = {}) {
  const panel = document.getElementById('account-panel')
  const title = document.getElementById('account-title')
  const detail = document.getElementById('account-detail')
  const button = document.getElementById('account-action')
  let user = null, busy = false

  async function refresh() {
    if (busy) return
    let answer
    try { answer = await chrome.runtime.sendMessage({ type: 'accountStatus' }) }
    catch (error) { answer = { error: error.message } }
    panel.hidden = compact && !answer?.enabled
    user = answer?.user || null
    title.textContent = user ? (user.name || user.login) : 'Вход через Account'
    detail.textContent = user ? `@${user.login} · ${roles[user.role] || user.role}` : answer?.message || answer?.error || 'Войдите, чтобы работать со своими правами LMS.'
    detail.classList.toggle('error', Boolean(answer?.error))
    button.disabled = !answer?.enabled
    button.classList.toggle('icon', Boolean(user))
    button.classList.toggle('btn', !user)
    button.classList.toggle('primary', !user)
    button.title = user ? 'Выйти из аккаунта' : 'Войти через Account'
    button.setAttribute('aria-label', button.title)
    button.replaceChildren(icon(user ? 'logout' : 'user'))
    if (!user) button.append(document.createTextNode('Войти'))
  }

  button.addEventListener('click', async () => {
    if (busy) return
    busy = true
    button.disabled = true
    detail.classList.remove('error')
    detail.textContent = user ? 'Выходим…' : 'Подтвердите вход в окне Account…'
    try {
      const answer = await chrome.runtime.sendMessage({ type: user ? 'accountLogout' : 'accountLogin' })
      if (!answer?.ok) throw new Error(answer?.error || 'Не удалось завершить вход')
      location.reload()
    } catch (error) {
      detail.textContent = error.message
      detail.classList.add('error')
      button.disabled = false
    } finally { busy = false }
  })
  chrome.runtime.onMessage.addListener(message => { if (message?.type === 'accountChanged') void refresh() })
  void refresh()
  return refresh
}
