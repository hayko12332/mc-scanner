import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { useToast } from './hooks/useToast'
import { ComingSoon } from './components/ComingSoon'
import { Footer } from './components/Footer'
import { track } from './lib/analytics'
import { FeedbackPage } from './pages/FeedbackPage'
import { LookupPage } from './pages/LookupPage'
import { HomePage } from './pages/HomePage'
import { ScannerPage } from './pages/ScannerPage'
import { CrmPage } from './pages/CrmPage'

const isLookup = (hash: string) => hash.startsWith('#/lookup')

/** Current location hash, plus the last lookup hash so the Lookup tab keeps its search while you are away. */
function useHash() {
  const [hash, setHash] = useState(location.hash)
  const [navKey, setNavKey] = useState(0)
  const [lastLookup, setLastLookup] = useState(isLookup(location.hash) ? location.hash : '#/lookup')
  useEffect(() => {
    const onChange = () => {
      setHash(location.hash)
      setNavKey((n) => n + 1)
      if (isLookup(location.hash)) setLastLookup(location.hash)
    }
    addEventListener('hashchange', onChange)
    return () => removeEventListener('hashchange', onChange)
  }, [])
  return { hash, navKey, lastLookup }
}

export default function App() {
  const { hash, navKey, lastLookup } = useHash()
  const page = isLookup(hash) ? 'lookup'
    : hash.startsWith('#/feedback') ? 'feedback'
    : hash.startsWith('#/crm') ? 'crm'
    : hash.startsWith('#/leads') ? 'leads'
    : hash.startsWith('#/scan') ? 'scan'
    : 'home'
  const isTool = page === 'leads' || page === 'scan'
  const toast = useToast()
  const [backendOk, setBackendOk] = useState<boolean | null>(null)

  const [telegram, setTelegram] = useState({ bot: '', group: '', support: '' })

  useEffect(() => {
    api.health().then(() => setBackendOk(true), () => setBackendOk(false))
    api.telegramLinks().then((l) => setTelegram({ support: '', ...l }), () => {})
  }, [])

  useEffect(() => {
    track('page_view', { page })
    scrollTo(0, 0)
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
    <>
      {page !== 'crm' && (
      <header className="nav">
        <div className="wrap nav-inner">
          <a href="#/" className="brand" aria-label="HaulPanel home">
            <img src="/logo.svg" alt="" width="32" height="32" />
            <span className="brand-word">Haul<em>Panel</em></span>
          </a>
          <nav className="tabs" aria-label="Product">
            <a href="#/crm">Dispatch TMS</a>
            <a href={lastLookup} className={page === 'lookup' ? 'active' : ''}>Company lookup</a>
            <a href="#/leads" className={page === 'leads' ? 'active' : ''}>New MC leads</a>
            <a href="#/scan" className={`hide-md ${page === 'scan' ? 'active' : ''}`}>MC scanner</a>
          </nav>
          <div className="nav-cta">
            <a className="nav-link hide-sm" href="#/crm?login">Log in</a>
            <a className="btn primary nav-start" href="#/crm?signup">Start free</a>
          </div>
        </div>
      </header>
      )}

      {page === 'crm' && <CrmPage toast={toast.show} />}
      <main className="wrap" hidden={page === 'crm'}>
        {page === 'home' && <HomePage backendOk={backendOk} />}
        {/* The tools and Lookup stay mounted so a running scan keeps going while you look something up. */}
        <div hidden={!isTool}>
          <ScannerPage
            mode={page === 'scan' ? 'range' : 'leads'}
            hash={hash}
            navKey={navKey}
            backendOk={backendOk}
            copy={(t, w) => void copy(t, w)}
            toast={toast.show}
          />
        </div>
        <div hidden={page !== 'lookup'}>
          <LookupPage hash={lastLookup} copy={(t) => void copy(t)} />
        </div>
        {page === 'feedback' && <FeedbackPage groupUrl={telegram.group} supportUrl={telegram.support} />}
        {page !== 'feedback' && page !== 'crm' && page !== 'home' && <ComingSoon />}
      </main>

      {page !== 'crm' && <Footer telegram={telegram} lastLookup={lastLookup} backendOk={backendOk} />}
      <div className={`toast ${toast.message ? 'show' : ''}`}>{toast.message}</div>
    </>
  )
}
