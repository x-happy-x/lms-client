import { useState } from 'react'
import { useExtension } from '../../hooks/useExtension'
import { copyText } from '../../lib/clipboard'
import { Icon } from '../../ui/Icon'

const DOWNLOAD_URL = 'https://github.com/x-happy-x/lms-client/releases/latest/download/lms-extension.zip'
const RELEASES_URL = 'https://github.com/x-happy-x/lms-client/releases'

function isChromium(): boolean {
  const brands = (navigator as Navigator & { userAgentData?: { brands?: Array<{ brand: string }> } }).userAgentData?.brands
  if (brands?.some((item) => item.brand === 'Chromium')) return true
  return /Chrome\/|Chromium\/|Edg\/|YaBrowser\//.test(navigator.userAgent) && !/Firefox\//.test(navigator.userAgent)
}

function extensionsPage(): string {
  const ua = navigator.userAgent
  if (/Edg\//.test(ua)) return 'edge://extensions'
  if (/YaBrowser\//.test(ua)) return 'browser://extensions'
  if (/OPR\//.test(ua)) return 'opera://extensions'
  return 'chrome://extensions'
}

function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="copy-field">
      <code>{value}</code>
      <button
        type="button"
        className="btn small"
        onClick={() =>
          void copyText(value).then((ok) => {
            setCopied(ok)
            if (ok) window.setTimeout(() => setCopied(false), 1500)
          })
        }
        aria-label={label}
      >
        <Icon name={copied ? 'check' : 'copy'} size={16} /> {copied ? 'Скопировано' : 'Копировать'}
      </button>
    </div>
  )
}

function StatusCard() {
  const { state, connecting, connect } = useExtension()
  const origin = window.location.origin

  if (state.status === 'checking') {
    return (
      <section className="card ext-status">
        <div className="card-head">
          <span className="ext-badge muted"><Icon name="retry" size={18} /></span>
          <div className="card-title"><strong>Проверяю, установлено ли расширение…</strong></div>
        </div>
      </section>
    )
  }
  if (state.status === 'missing') {
    return (
      <section className="card ext-status">
        <div className="card-head">
          <span className="ext-badge warn"><Icon name="alert" size={18} /></span>
          <div className="card-title">
            <strong>Расширение не найдено в этом браузере</strong>
            <span className="muted small">Установите его по шагам ниже. После установки обновите эту страницу.</span>
          </div>
          <a className="btn primary" href={DOWNLOAD_URL}>
            <Icon name="download" size={18} /> Скачать
          </a>
        </div>
      </section>
    )
  }
  return (
    <section className="card ext-status">
      <div className="card-head">
        <span className={`ext-badge ${state.connected ? 'ok' : 'warn'}`}>
          <Icon name={state.connected ? 'check' : 'link'} size={18} />
        </span>
        <div className="card-title">
          <strong>{state.connected ? 'Расширение подключено к этому роутеру' : 'Расширение установлено, но смотрит на другой адрес'}</strong>
          <span className="muted small">
            Версия {state.version || '?'} · {state.connected ? origin : `подключите его к ${origin}`}
          </span>
        </div>
        {state.connected ? null : (
          <button type="button" className="btn primary" disabled={connecting} onClick={connect}>
            <Icon name="link" size={18} /> {connecting ? 'Подтвердите…' : 'Подключить к этому роутеру'}
          </button>
        )}
      </div>
    </section>
  )
}

export function ExtensionPage() {
  const origin = window.location.origin
  const chromium = isChromium()

  return (
    <div className="page narrow">
      <p className="muted">
        Расширение для Chrome, Edge, Яндекс Браузера и других браузеров на Chromium. Оно находит на страницах видео, файлы
        и magnet-ссылки и перехватывает загрузки браузера, чтобы качала нода, а не компьютер.
      </p>

      {chromium ? (
        <StatusCard />
      ) : (
        <div className="alert warn">
          <Icon name="alert" size={18} /> Этот браузер не на Chromium — расширение работает в Chrome, Edge, Яндекс Браузере,
          Opera, Vivaldi и Brave.
        </div>
      )}

      <section className="card">
        <h3>Установка</h3>
        <ol className="steps">
          <li>
            <span>
              Скачайте архив и распакуйте его в папку, которую не будете удалять: браузер загружает расширение прямо из
              неё.
            </span>
            <div className="btn-row">
              <a className="btn primary" href={DOWNLOAD_URL}>
                <Icon name="download" size={18} /> lms-extension.zip
              </a>
              <a className="btn" href={RELEASES_URL} target="_blank" rel="noreferrer">
                Все версии
              </a>
            </div>
          </li>
          <li>
            <span>
              Откройте страницу расширений — вставьте адрес в новую вкладку (сайты не могут открыть её ссылкой):
            </span>
            <CopyField value={extensionsPage()} label="Копировать адрес страницы расширений" />
          </li>
          <li>Включите «Режим разработчика» (переключатель справа вверху).</li>
          <li>Нажмите «Загрузить распакованное» и выберите распакованную папку.</li>
          <li>Вернитесь на эту страницу и обновите её — здесь появится кнопка «Подключить к этому роутеру».</li>
        </ol>
        <p className="muted small">
          Обновление: распакуйте новый архив в ту же папку и нажмите «Обновить» на странице расширений. Само оно не
          обновляется — так устанавливаются все расширения не из магазина.
        </p>
      </section>

      <section className="card">
        <h3>Настройка</h3>
        <p>
          Кнопка «Подключить к этому роутеру» выше сохраняет адрес сама. Вручную: значок расширения → ⚙ Настройки → «Адрес
          веб-интерфейса LMS»:
        </p>
        <CopyField value={origin} label="Копировать адрес LMS" />
        <dl className="facts ext-facts">
          <div>
            <dt>Перехват загрузок</dt>
            <dd>Какие файлы отдавать в LMS (видео, архивы, образы…) и от какого размера</dd>
          </div>
          <div>
            <dt>Magnet-ссылки</dt>
            <dd>Клик по magnet открывает загрузку в LMS, а не в торрент-клиенте</dd>
          </div>
          <div>
            <dt>Видеопотоки</dt>
            <dd>Поиск HLS/DASH в запросах страницы — они уходят в yt-dlp</dd>
          </div>
          <div>
            <dt>Скорость</dt>
            <dd>Лимит по умолчанию для загрузок из браузера</dd>
          </div>
        </dl>
        <p className="muted small">
          Если LMS открыт через прокси с паролем, укажите в настройках расширения логин и пароль (HTTP Basic).
        </p>
      </section>

      <section className="card">
        <h3>Как пользоваться</h3>
        <ul className="plain-list">
          <li>
            <Icon name="list" size={18} /> <span>Значок расширения показывает, сколько видео и файлов найдено на странице. В
            его окне у каждой находки есть способ загрузки и кнопка «В LMS».</span>
          </li>
          <li>
            <Icon name="video" size={18} /> <span>«Отправить страницу (yt-dlp)» — для YouTube, VK, Rutube и других сайтов с
            видео. То же делает <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>.</span>
          </li>
          <li>
            <Icon name="more" size={18} /> <span>Правый клик по ссылке, видео или выделенному тексту → «Скачать через
            LMS».</span>
          </li>
          <li>
            <Icon name="alert" size={18} /> <span>Файлы, которым нужен вход на сайте (cookies), нода не скачает. Для них в
            уведомлении есть кнопка «Скачать в браузере». Если LMS недоступен, файл сразу качается браузером.</span>
          </li>
        </ul>
      </section>
    </div>
  )
}
