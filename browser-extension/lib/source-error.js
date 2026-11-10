export function sourceFailure(message) {
  const text = String(message || '')
  if (/HTTP(?:\s+Error|\s+status(?:\s+code)?)?\s*[:=]?\s*403\b/i.test(text)) return { code: 'SOURCE_FORBIDDEN', message: 'Сайт-источник отказал ноде в доступе (HTTP 403). Доступ в открытой вкладке браузера может отличаться от доступа ноды.' }
  if (/HTTP(?:\s+Error|\s+status(?:\s+code)?)?\s*[:=]?\s*410\b/i.test(text)) return { code: 'SOURCE_GONE', message: 'Сайт-источник вернул HTTP 410. Ссылка недоступна для запроса ноды; это само по себе не доказывает, что видео удалено.' }
  return null
}
