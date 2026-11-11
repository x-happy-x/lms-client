import { useEffect, useState } from 'react'
import { api } from '../../api'
import type { Job, NetworkRoutes, NodeItem } from '../../types'
import { Icon } from '../../ui/Icon'
import './network.css'

function useRoutes(nodeId: string, url: string, routeId = '', refresh = 0) {
  const [data, setData] = useState<NetworkRoutes | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    setData(null); setError('')
    if (!nodeId) { setLoading(false); return }
    let active = true
    setLoading(true)
    const timer = window.setTimeout(() => {
      api.networkRoutes(nodeId, /^https?:\/\//i.test(url) ? url : '', routeId).then(value => {
        if (active) setData(value)
      }, reason => { if (active) setError(reason.message) }).finally(() => { if (active) setLoading(false) })
    }, 250)
    return () => { active = false; clearTimeout(timer) }
  }, [nodeId, url, routeId, refresh])
  return { data, error, loading }
}

export function RouteSelector({ nodeId, url, type, value, onChange }: {nodeId: string; url: string; type: string; value: string; onChange: (value: string) => void}) {
  const { data, error, loading } = useRoutes(nodeId, url)
  const supported = data?.routes.filter(route => route.available && route.supportedTypes.includes(type)) || []
  return <section className="network-selector" aria-label="Маршрут загрузки">
    <label className="field"><span><Icon name="link" size={16} /> Маршрут загрузки</span>
      <select value={value} onChange={event => onChange(event.target.value)} disabled={!nodeId || loading || type === 'TORRENT'}>
        <option value="">Автоматически · правила сети</option>
        {supported.map(route => <option key={route.id} value={route.id}>{route.label}</option>)}
        {value && !supported.some(route => route.id === value) ? <option value={value} disabled>Выбранный маршрут недоступен</option> : null}
      </select>
    </label>
    <p className="muted small" role="status">{loading ? 'Получаем маршруты ноды…' : error || (type === 'TORRENT' ? 'Выделенный HTTP-маршрут не применяется к торрентам.' : value ? 'Выделенный маршрут применяется к этому заданию. Остальные устройства не переключаются.' : 'Выберите выделенный выход HomeNet или оставьте обычную маршрутизацию ноды.')}</p>
    {data?.message ? <p className="muted small">{data.message}</p> : null}
  </section>
}

export function JobNetworkRoute({ job }: { job: Job }) {
  const [open, setOpen] = useState(false)
  const { data, error, loading } = useRoutes(open ? job.nodeId || '' : '', job.url, job.networkRouteId || '')
  return <details className="job-network-route" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><Icon name="link" size={13} />{job.networkRouteLabel || 'Маршрут сети'}<Icon name="chevronRight" size={13} /></summary>
    <div className="job-network-body" role="status">{loading ? 'Получаем текущий путь…' : error || (data ? <><strong>{data.planned.label}</strong>{data.observed.length ? data.observed.map((item, index) => <p key={index}>{item.host}: {item.chains.join(' → ')}</p>) : <p>Текущий путь не подтверждён: совпавших активных соединений нет.</p>}{data.message ? <p>{data.message}</p> : null}</> : null)}</div>
  </details>
}

export function NetworkPage({ nodes }: { nodes: NodeItem[] }) {
  const [selected, setSelected] = useState('')
  const nodeId = selected || nodes.find(node => node.enabled)?.id || ''
  const [url, setUrl] = useState('')
  const [refresh, setRefresh] = useState(0)
  const { data, error, loading } = useRoutes(nodeId, url, '', refresh)
  return <section className="network-page">
    <div className="network-heading"><div><p className="network-eyebrow">HomeNet</p><h2>Маршруты загрузок</h2><p className="muted">Выделенные выходы и подтверждённые соединения ноды.</p></div><button className="btn icon-btn" title="Обновить маршруты" aria-label="Обновить маршруты" onClick={() => setRefresh(value => value + 1)} disabled={loading}><Icon name="retry" size={18} /></button></div>
    <div className="network-controls"><label className="field"><span>Нода</span><select value={nodeId} onChange={event => setSelected(event.target.value)}><option value="" disabled>Выберите ноду</option>{nodes.filter(node => node.enabled).map(node => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label><label className="field"><span>Сайт для фильтра соединений</span><input type="url" placeholder="https://example.com/video" value={url} onChange={event => setUrl(event.target.value)} /></label></div>
    {!nodeId ? <div className="empty">Добавьте ноду, чтобы увидеть маршруты.</div> : null}
    {loading ? <p className="muted" role="status">Получаем состояние HomeNet…</p> : null}
    {error ? <div className="alert error" role="alert">{error}</div> : null}
    {data ? <><div className="network-summary"><Icon name="server" size={25} /><div><strong>{data.planned.label}</strong><p className="muted small">{data.message || 'Выделенный выход выбирается при добавлении загрузки.'}</p></div><span className="tag">{data.canSelect ? `${data.routes.length} маршрутов` : 'Нет выделенных выходов'}</span></div>
      <div className="network-routes">{data.routes.map(route => <article className="network-route" key={route.id}><span className="network-route-icon"><Icon name="link" size={22} /></span><div><strong>{route.label}</strong><p className="muted small">{route.supportedTypes.map(type => type === 'DIRECT' ? 'HTTP' : type === 'YTDLP' ? 'yt-dlp' : 'aria2c').join(' · ')}</p></div><span className={`tag ${route.available ? 'ok' : ''}`}>{route.available ? 'Доступен' : 'Недоступен'}</span></article>)}</div>
      <div className="network-observed"><h3>Подтверждённые соединения</h3><p className="muted small">Путь определяется по активному соединению. Для сайта и его CDN выходы могут различаться.</p>{data.observed.length ? data.observed.map((item, index) => <article className="network-connection" key={`${item.host}-${index}`}><strong>{item.host}</strong><div className="network-chain">{item.chains.map((hop, index) => <span key={`${hop}-${index}`}>{index > 0 ? <Icon name="chevronRight" size={14} /> : null}{hop}</span>)}</div><small className="muted">{item.rule} · {new Date(item.observedAt).toLocaleTimeString()}</small></article>) : <div className="empty network-empty"><Icon name="eye" size={26} /><strong>Маршрут пока не подтверждён</strong><p className="muted">Совпавших активных соединений нет. Это не означает, что загрузка идёт напрямую.</p></div>}</div></> : null}
  </section>
}
