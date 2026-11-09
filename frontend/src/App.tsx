import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { useToast } from './hooks/useToast'
import { ComingSoon } from './components/ComingSoon'
import { track } from './lib/analytics'
import { FeedbackPage } from './pages/FeedbackPage'
import { LookupPage } from './pages/LookupPage'
import { ScannerPage } from './pages/ScannerPage'

const isLookup = (hash: string) => hash.startsWith('#/lookup')

/** Current location hash, plus the last lookup hash so the Lookup tab keeps its search while you are away. */
function useHash() {
  const [hash, setHash] = useState(location.hash)
  const [lastLookup, setLastLookup] = useState(isLookup(location.hash) ? location.hash : '#/lookup')
  useEffect(() => {
    const onChange = () => {
      setHash(location.hash)
      if (isLookup(location.hash)) setLastLookup(location.hash)
    }
    addEventListener('hashchange', onChange)
    return () => removeEventListener('hashchange', onChange)
  }, [])
  return { hash, lastLookup }
}

export default function App() {
  const { hash, lastLookup } = useHash()
  const page = isLookup(hash) ? 'lookup' : hash.startsWith('#/feedback') ? 'feedback' : 'scanner'
  const toast = useToast()
  const [backendOk, setBackendOk] = useState<boolean | null>(null)

  const [telegram, setTelegram] = useState({ bot: '', group: '' })

  useEffect(() => {
    api.health().then(() => setBackendOk(true), () => setBackendOk(false))
    api.telegramLinks().then(setTelegram, () => {})
  }, [])

  useEffect(() => {
    track('page_view', { page })
  }, [page])

  const copy = useCallback(async (text: string, what = text) => {
    if (!text) return toast.show('Nothing to copy')
    try {
      await navigator.clipboard.writeText(text)
      toast.show(`Copied: ${what}`)
    } catch {
      toast.show('Could not copy')
    }
  }, [toast])

  return (
    <div className="wrap">
      <header className="top">
        <a href="#/" className="brand">
          <img src="/logo.svg" alt="" width="32" height="32" />
          <h1>MC Scanner</h1>
        </a>
        <nav className="tabs">
          <a href="#/" className={page === 'scanner' ? 'active' : ''}>Scanner</a>
          <a href={lastLookup} className={page === 'lookup' ? 'active' : ''}>Lookup</a>
          <a href="#/feedback" className={page === 'feedback' ? 'active' : ''}>Suggestions</a>
        </nav>
      </header>

      {/* Scanner and Lookup stay mounted so a running scan keeps going while you look something up. */}
      <div hidden={page !== 'scanner'}>
        <ScannerPage backendOk={backendOk} copy={(t, w) => void copy(t, w)} toast={toast.show} />
      </div>
      <div hidden={page !== 'lookup'}>
        <LookupPage hash={lastLookup} copy={(t) => void copy(t)} />
      </div>
      {page === 'feedback' && <FeedbackPage groupUrl={telegram.group} />}
      {page !== 'feedback' && <ComingSoon />}

      <footer className="footer">
        {(telegram.bot || telegram.group) && (
          <p className="footer-links">
            {telegram.bot && <a href={telegram.bot} target="_blank" rel="noopener">🤖 Telegram bot @{telegram.bot.split('/').pop()}</a>}
            {telegram.group && <a href={telegram.group} target="_blank" rel="noopener">👥 Join our Telegram group</a>}
          </p>
        )}
        Free to use. Data: FMCSA open data and SAFER. We record anonymous usage (pages opened, searches) to improve
        the service.
      </footer>
      <div className={`toast ${toast.message ? 'show' : ''}`}>{toast.message}</div>
    </div>
  )
}
