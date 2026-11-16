import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
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
import { crm, type CrmUser } from './lib/crm'
import { firstName, MeContext } from './lib/me'

const isLookup = (hash: string) => hash.startsWith('#/lookup')

// Search pages are real paths (the server gives each its own title and text); they open the matching tool.
const PATH_ROUTES: Record<string, string> = { '/new-mc-leads': '#/leads', '/mc-number-lookup': '#/lookup', '/mc-scanner': '#/scan' }
const pathRoute = PATH_ROUTES[location.pathname.replace(/\/+$/, '')]
if (pathRoute && (!location.hash || location.hash === '#')) history.replaceState(null, '', location.pathname + location.search + pathRoute)

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
  return { hash, navKey, lastLookup, setLastLookup }
}

export type BoardTool = 'lookup' | 'leads'
const TOOL_KEY = 'haulpanel.boardTool'
const ME_KEY = 'haulpanel.me'

export default function App() {
  const { hash, navKey, lastLookup, setLastLookup } = useHash()
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

  // Signed in or not, for the header on every page; checked again on each page change (after signing in or out on the board).
  // The last answer is remembered so the header shows the right buttons at once, before the server answers.
  const [me, setMe] = useState<CrmUser | null>(() => {
    try { return JSON.parse(localStorage.getItem(ME_KEY) || 'null') as CrmUser | null } catch { return null }
  })
  useEffect(() => {
    if (page === 'crm') return
    let stale = false
    crm.me().then((r) => {
      if (stale) return
      setMe(r.user)
      try { if (r.user) localStorage.setItem(ME_KEY, JSON.stringify(r.user)); else localStorage.removeItem(ME_KEY) } catch { /* private mode */ }
    }, () => {})
    return () => { stale = true }
  }, [page])

  // Lookup and New MC leads opened inside the dispatch board (its sidebar "Tools").
  const [boardTool, setBoardTool] = useState<BoardTool | null>(() => {
    try { const t = sessionStorage.getItem(TOOL_KEY); return t === 'lookup' || t === 'leads' ? t : null } catch { return null }
  })
  const [boardSlot, setBoardSlot] = useState<HTMLElement | null>(null)
  const openBoardTool = useCallback((t: BoardTool | null) => {
    if (t) track('board_tool', { tool: t })
    try { if (t) sessionStorage.setItem(TOOL_KEY, t); else sessionStorage.removeItem(TOOL_KEY) } catch { /* not remembered */ }
    setBoardTool(t)
  }, [])
  const inBoard = page === 'crm' && boardTool != null && boardSlot != null
  const toolsNode = useMemo(() => document.createElement('div'), [])
  const homeSlot = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const target = inBoard ? boardSlot : homeSlot.current
    if (target && toolsNode.parentNode !== target) target.appendChild(toolsNode)
  })
  /** Inside the board, links between the tools (a company's MC, "check this company") stay in the board. */
  const onToolClick = (e: MouseEvent) => {
    if (!inBoard) return
    const a = (e.target as HTMLElement).closest('a')
    const href = a?.getAttribute('href') ?? ''
    if (href.startsWith('#/lookup')) { e.preventDefault(); setLastLookup(href); openBoardTool('lookup'); scrollTo(0, 0) }
    else if (href.startsWith('#/leads')) { e.preventDefault(); openBoardTool('leads') }
  }

  /** Header links: keep the real path in the link, switch the in-app view on a plain click. */
  const go = (target: string) => (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    location.hash = target
  }

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
    <MeContext.Provider value={me}>
      {page !== 'crm' && (
      <header className={`nav ${page === 'home' ? 'nav-light' : ''}`}>
        <div className="wrap nav-inner">
          <a href="#/" className="brand" aria-label="HaulPanel home">
            <img src="/logo.svg" alt="" width="32" height="32" />
            <span className="brand-word">Haul<em>Panel</em></span>
          </a>
          <nav className="tabs" aria-label="Product">
            <a href="#/crm">Dispatch TMS</a>
            {/* Real addresses for search engines; a plain click switches the view without reloading. */}
            <a href="/mc-number-lookup" onClick={go(lastLookup)} className={page === 'lookup' ? 'active' : ''}>Company lookup</a>
            <a href="/new-mc-leads" onClick={go('#/leads')} className={page === 'leads' ? 'active' : ''}>New MC leads</a>
            <a href="/mc-scanner" onClick={go('#/scan')} className={`hide-md ${page === 'scan' ? 'active' : ''}`}>MC scanner</a>
          </nav>
          {me ? (
            <div className="nav-cta">
              <a className="nav-me" href="#/crm" title={me.email} data-track="header_me">
                {me.picture ? <img src={me.picture} alt="" referrerPolicy="no-referrer" /> : <span className="avatar">{firstName(me).slice(0, 1).toUpperCase()}</span>}
                <span className="hide-sm">{firstName(me)}</span>
              </a>
              <a className="btn nav-start" href="#/crm" data-track="header_board">My board</a>
            </div>
          ) : (
            <div className="nav-cta">
              <a className="nav-link" href="#/crm?login" data-track="header_login">Log in</a>
              <a className="btn nav-start" href="#/crm?signup" data-track="header_start_free">Free TMS</a>
            </div>
          )}
        </div>
      </header>
      )}

      {page === 'crm' && <CrmPage toast={toast.show} tool={boardTool} setTool={openBoardTool} toolSlot={setBoardSlot} />}
      <main className="wrap" hidden={page === 'crm'}>
        {page === 'home' && <HomePage backendOk={backendOk} />}
        {/* Lookup and the lead tools live here, or inside the dispatch board when opened from its sidebar (see below). */}
        <div ref={homeSlot} />
        {page === 'feedback' && <FeedbackPage groupUrl={telegram.group} supportUrl={telegram.support} />}
        {page !== 'feedback' && page !== 'crm' && page !== 'home' && <ComingSoon />}
      </main>
      {/* The tools are mounted once and their DOM is moved between the site and the board, so a running search
          or lead download keeps going (and keeps its results) when you switch between them. */}
      {createPortal(
        <div onClickCapture={onToolClick}>
          <div hidden={!(isTool || (inBoard && boardTool === 'leads'))}>
            <ScannerPage
              mode={inBoard ? 'leads' : page === 'scan' ? 'range' : 'leads'}
              embedded={inBoard}
              hash={hash}
              navKey={navKey}
              backendOk={backendOk}
              copy={(t, w) => void copy(t, w)}
              toast={toast.show}
            />
          </div>
          <div hidden={!(page === 'lookup' || (inBoard && boardTool === 'lookup'))}>
            <LookupPage hash={lastLookup} navigate={inBoard ? setLastLookup : undefined} embedded={inBoard} copy={(t) => void copy(t)} />
          </div>
        </div>,
        toolsNode,
      )}

      {page !== 'crm' && <Footer telegram={telegram} lastLookup={lastLookup} backendOk={backendOk} />}
      <div className={`toast ${toast.message ? 'show' : ''}`}>{toast.message}</div>
    </MeContext.Provider>
  )
}
