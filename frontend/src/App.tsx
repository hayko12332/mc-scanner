import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { useToast } from './hooks/useToast'
import { ComingSoon } from './components/ComingSoon'
import { Footer } from './components/Footer'
import { Icon } from './components/Icon'
import { track } from './lib/analytics'
import { FeedbackPage } from './pages/FeedbackPage'
import { LookupPage } from './pages/LookupPage'
import { HomePage } from './pages/HomePage'
import { ScannerPage } from './pages/ScannerPage'

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
      <header className="nav">
        <div className="wrap nav-inner">
          <a href="#/" className="brand">
            <img src="/logo.svg" alt="" width="34" height="34" />
            <span className="brand-text">
              <span>Lead<em>Haul</em></span>
              <small>New MC leads every day</small>
            </span>
          </a>
          <nav className="tabs">
            <a href="#/leads" className={page === 'leads' ? 'active' : ''}><Icon name="zap" size={16} /><span><span className="hide-sm">New </span>Leads</span></a>
            <a href="#/scan" className={page === 'scan' ? 'active' : ''}><Icon name="scan" size={16} />Scanner</a>
            <a href={lastLookup} className={page === 'lookup' ? 'active' : ''}><Icon name="search" size={16} />Lookup</a>
            <a href="#/feedback" className={page === 'feedback' ? 'active' : ''}><Icon name="bulb" size={16} />Ideas</a>
          </nav>
          <div className="nav-cta">
            {telegram.support && (
              <a className="nav-link" href={telegram.support} target="_blank" rel="noopener" title="Questions or help? Write to us in Telegram">
                <Icon name="lifebuoy" size={18} /><span className="hide-sm">Support</span>
              </a>
            )}
            {page !== 'leads' && (
              <a className="btn nav-leads" href="#/leads?go=7"><Icon name="zap" size={16} /><span>Get <span className="hide-sm">new </span>leads</span></a>
            )}
            {telegram.bot && (
              <a className="btn nav-tg" href={telegram.bot} target="_blank" rel="noopener">
                <Icon name="send" size={16} />Telegram
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="wrap">
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
        {page !== 'feedback' && <ComingSoon />}
      </main>

      <Footer telegram={telegram} lastLookup={lastLookup} backendOk={backendOk} />
      <div className={`toast ${toast.message ? 'show' : ''}`}>{toast.message}</div>
    </>
  )
}
