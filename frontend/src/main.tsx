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
  const target = view === 'leads' ? 'leads?go=7' : view === 'lookup' ? 'lookup' : view === 'scan' ? 'scan' : ''
  history.replaceState(null, '', location.pathname + '#/' + target)
}
initAnalytics()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
