import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initAnalytics } from './lib/analytics'
import { initTelegram } from './lib/telegram'

initTelegram()
// Deep links from the Telegram bot: ?view=leads opens New MC leads (and starts loading), ?view=lookup the lookup.
const view = new URLSearchParams(location.search).get('view')
if (view && !location.hash.startsWith('#/')) {
  const target = view === 'leads' ? 'leads?go=1' : view === 'lookup' ? 'lookup' : view === 'scan' ? 'scan' : ''
  history.replaceState(null, '', location.pathname + '#/' + target)
}
initAnalytics()
// After a new version is deployed, a page opened earlier asks for code files (the map, the AI panel) whose names
// changed: reload once to get the new version instead of showing a broken part. At most once a minute.
addEventListener('vite:preloadError', (e) => {
  try {
    const last = Number(sessionStorage.getItem('hp.reloadedForUpdate') ?? 0)
    if (Date.now() - last < 60_000) return
    sessionStorage.setItem('hp.reloadedForUpdate', String(Date.now()))
  } catch { /* no storage: still reload */ }
  e.preventDefault()
  location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
