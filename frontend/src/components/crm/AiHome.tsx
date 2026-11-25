import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import {
  addDays, crm, fmtRpm, gross, isBroker, rpm, shortDate, STATUSES, today, usd, weekStart,
  type AiAction, type AiCard, type AiEvent, type AiItem, type AiStep, type AiView, type CrmState, type ImportPlan, type LaneResult,
} from '../../lib/crm'
import { CheckBadge } from './CheckBadge'
import { prepare } from './LoadDocs'
import { place } from './LoadsTable'
import { RouteMap } from './MapView'

// The AI is the board's main screen. You ask or give a job at the bottom; the assistant works the board and the
// screen shows each step as it happens, the answer as it is written, and the cards it builds (tables, charts,
// maps, FMCSA checks). Board changes it makes can be undone; emails wait for your OK. A new chat opens with a
// briefing of the board and, for a new board, a way to move your data in by just dropping files.

const THREAD_KEY = 'haulpanel.ai.thread'
type Theme = 'light' | 'dark'
type History = { id: string; title: string; updatedAt: string }
type LiveStep = { id: string; label: string; state: 'running' | AiStep['state']; detail?: string; ms?: number }
type Live = { steps: LiveStep[]; text: string; cards: AiCard[]; actions: AiAction[]; thinking: boolean; started: number; userText: string; userFile?: string }

const toB64 = async (b: Blob) => {
  const bytes = new Uint8Array(await b.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`
}
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`
const isSheet = (f: File) => /\.(xlsx|xls|csv|tsv)$/i.test(f.name) || /sheet|excel|csv/.test(f.type)
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening' }
const TOOL: Record<string, string> = { create_load: 'Added load', update_load: 'Updated load', add_carrier: 'Added carrier', send_invoice: 'Invoice email', add_truck: 'Added truck', add_dispatcher: 'Added dispatcher', update_company: 'Company details', save_customer_email: 'Billing email' }
/** Starts the setup interview: the AI asks for what the board needs, one question at a time. */
const SETUP_ASK = 'Help me set up my board. I don’t have spreadsheets — ask me what you need, one question at a time.'

export function AiHome({ state, theme, openLoad, changed, prompt, onPromptUsed, contextLoadId, firstName, owner }: {
  state: CrmState
  theme: Theme
  openLoad: (id: number) => void
  changed: () => void
  prompt?: { text: string; send: boolean } | null
  onPromptUsed: () => void
  contextLoadId?: number | null
  firstName: string
  /** Only the owner can import data (adds carriers, trucks, dispatchers). */
  owner: boolean
}) {
  const [view, setView] = useState<AiView | null>(null)
  const [history, setHistory] = useState<History[]>([])
  const [q, setQ] = useState('')
  const [file, setFile] = useState<{ name: string; blob: Blob } | null>(null)
  const [live, setLive] = useState<Live | null>(null)
  const [err, setErr] = useState('')
  const [drag, setDrag] = useState(false)
  const [importing, setImporting] = useState<File[] | null>(null)
  /** A short note after an import (shown for a few seconds under the thread). */
  const [note, setNote] = useState('')
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(''), 8000); return () => clearTimeout(t) }, [note])
  const abort = useRef<AbortController | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const handled = useRef<object | null>(null)
  const scroller = useFollow(!!live)
  const busy = !!live

  const loadHistory = useCallback(() => { crm.aiThreads().then(setHistory, () => undefined) }, [])
  useEffect(() => {
    loadHistory()
    let id = ''
    try { id = localStorage.getItem(THREAD_KEY) ?? '' } catch { /* no storage */ }
    if (id) crm.aiThread(id).then(setView, () => undefined)
  }, [loadHistory])
  useEffect(() => { try { if (view?.threadId) localStorage.setItem(THREAD_KEY, view.threadId) } catch { /* no storage */ } }, [view?.threadId])

  /** Runs one streamed request; every event updates the live answer, `done` swaps in the saved chat. */
  const runStream = async (start: (on: (e: AiEvent) => void, signal: AbortSignal) => Promise<void>, userText: string, userFile?: string) => {
    const ac = new AbortController()
    abort.current = ac
    setErr('')
    setLive({ steps: [], text: '', cards: [], actions: [], thinking: true, started: Date.now(), userText, userFile })
    let final: AiView | null = null
    let changedBoard = false
    try {
      await start((e) => {
        if (e.type === 'done') { final = e.view; return }
        if (e.type === 'error') { setErr(e.message); return }
        if (e.type === 'action' && (e.action.status === 'done' || e.action.status === 'undone')) changedBoard = true
        setLive((l) => (l ? reduce(l, e) : l))
      }, ac.signal)
    } catch (e) {
      setErr((e as Error).message)
    }
    abort.current = null
    // Let the text finish appearing before the saved chat replaces the live one.
    await new Promise((r) => setTimeout(r, 350))
    if (final) setView(final)
    else if (view?.threadId) await crm.aiThread(view.threadId).then(setView, () => undefined)
    setLive(null)
    if (changedBoard) changed()
    loadHistory()
    input.current?.focus()
  }

  const send = async (text: string, attached = file) => {
    const t = text.trim()
    if ((!t && !attached) || busy) return
    setQ('')
    setFile(null)
    const payload = { threadId: view?.threadId || undefined, text: t, loadId: contextLoadId ?? null, ...(attached ? { file: { name: attached.name, data: await toB64(attached.blob) } } : {}) }
    await runStream((on, signal) => crm.aiChatStream(payload, on, signal), t, attached?.name)
  }
  const decide = (a: AiAction, approve: boolean) => {
    if (!view || busy) return
    void runStream((on, signal) => crm.aiDecideStream(view.threadId, a.id, approve, on, signal), '')
  }
  const undo = async (a: AiAction) => {
    if (!view) return
    try { setView(await crm.aiUndo(view.threadId, a.id)); changed() } catch (e) { setErr((e as Error).message) }
  }
  const stop = () => abort.current?.abort()

  // A question from the "Ask AI" bar elsewhere on the board.
  useEffect(() => {
    if (!prompt || handled.current === prompt) return
    handled.current = prompt
    onPromptUsed()
    if (prompt.send) void send(prompt.text)
    else { setQ(prompt.text); input.current?.focus() }
  }, [prompt]) // eslint-disable-line react-hooks/exhaustive-deps

  const take = async (files: File[]) => {
    if (!files.length) return
    if (owner && (files.length > 1 || files.some(isSheet))) { setImporting(files); return }
    try { const p = await prepare(files[0]); setFile({ name: p.name, blob: p.blob }); input.current?.focus() } catch (e) { setErr((e as Error).message) }
  }
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); void take([...e.dataTransfer.files]) }
  const newChat = () => { if (busy) return; setView(null); setErr(''); setQ(''); setImporting(null); try { localStorage.removeItem(THREAD_KEY) } catch { /* no storage */ } input.current?.focus() }
  const openChat = (id: string) => { if (busy) return; setErr(''); setImporting(null); crm.aiThread(id).then(setView, (e: Error) => setErr(e.message)) }
  const removeChat = (id: string) => { void crm.aiDeleteThread(id).then(() => { if (view?.threadId === id) newChat(); loadHistory() }) }

  const items = view?.items ?? []
  const actions = useMemo(() => new Map([...(view?.actions ?? []), ...(view?.pending ?? [])].map((a) => [a.id, a])), [view])
  const empty = !items.length && !live

  return (
    <div className={`ah ${drag ? 'drag' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false) }} onDrop={onDrop}>
      <aside className="ah-side" aria-label="Chats">
        <button className="ah-new" onClick={newChat} disabled={busy}><span aria-hidden="true">＋</span> New chat</button>
        {owner && <button className="ah-side-btn" onClick={() => setImporting([])}><span aria-hidden="true">⇪</span> Import your data</button>}
        <div className="ah-side-label">Chats</div>
        {!history.length && <p className="ah-side-empty">Your chats show up here.</p>}
        {history.map((h) => (
          <div key={h.id} className={`ah-chat ${view?.threadId === h.id ? 'on' : ''}`}>
            <button onClick={() => openChat(h.id)} title={h.title}><span>{h.title}</span><small>{ago(h.updatedAt)}</small></button>
            <button className="ah-chat-x" aria-label="Delete chat" onClick={() => { if (confirm('Delete this chat?')) removeChat(h.id) }}>×</button>
          </div>
        ))}
      </aside>

      <section className="ah-main">
        <div className="ah-scroll" ref={scroller}>
          <div className="ah-col">
            {empty && !importing && <Briefing state={state} firstName={firstName} owner={owner} ask={(t) => void send(t)} importData={() => setImporting([])} />}
            {importing && <ImportCard initial={importing} close={() => setImporting(null)} done={(msg) => { setImporting(null); changed(); setErr(''); setNote(msg) }} interview={() => { setImporting(null); void send(SETUP_ASK) }} />}
            {items.map((it, i) => (
              <Fragment key={i}>
                {it.role === 'user'
                  ? <UserMsg text={it.text} file={it.file} />
                  : <AiMsg item={it} actions={actions} state={state} theme={theme} openLoad={openLoad} busy={busy} decide={decide} undo={undo} />}
              </Fragment>
            ))}
            {live && (
              <>
                {(live.userText || live.userFile) && <UserMsg text={live.userText} file={live.userFile} />}
                <LiveMsg live={live} state={state} theme={theme} openLoad={openLoad} />
              </>
            )}
            {note && <div className="ah-note">✓ {note}</div>}
            {err && <p className="ah-err">⚠ {err}</p>}
          </div>
        </div>

        <div className="ah-dock">
          <div className="ah-col">
            {live && <div className="ah-status" role="status"><span className="ah-spin" /> {statusLine(live)}</div>}
            <div className={`ah-box ${busy ? 'busy' : ''}`}>
              {file && <span className="ah-chip">📄 {file.name}<button type="button" aria-label="Remove file" onClick={() => setFile(null)}>×</button></span>}
              <textarea ref={input} rows={1} value={q} autoFocus
                placeholder={busy ? 'Working on it — you can type the next job…' : contextLoadId ? `Ask about load #${contextLoadId}, or give a job…` : 'Ask anything or give a job — “invoice everything delivered this week”'}
                onChange={(e) => { setQ(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(200, e.target.scrollHeight)}px` }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(q) } }} />
              <div className="ah-bar">
                <button type="button" className="ah-icon" onClick={() => picker.current?.click()} title="Attach a rate con, BOL, POD — or spreadsheets to import" aria-label="Attach">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 12.5 12.5 21a5 5 0 0 1-7-7L14 5.5a3.3 3.3 0 0 1 4.7 4.7L10.2 18.7a1.7 1.7 0 0 1-2.4-2.4L15.5 8.6" /></svg>
                </button>
                <span className="ah-mode"><i />Does the work · asks before emails</span>
                {busy
                  ? <button type="button" className="ah-send stop" onClick={stop} aria-label="Stop"><span /></button>
                  : <button type="button" className="ah-send" disabled={!q.trim() && !file} onClick={() => void send(q)} aria-label="Send">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                    </button>}
              </div>
            </div>
            <div className="ah-foot">Works on your real loads, trucks and money. Every change is listed and can be undone.</div>
          </div>
        </div>
        <input ref={picker} type="file" hidden multiple accept="application/pdf,image/*,.xlsx,.xls,.csv,.tsv" onChange={(e) => { void take([...(e.target.files ?? [])]); e.target.value = '' }} />
      </section>
      {drag && <div className="ah-drop">Drop it here — a rate con becomes a load, spreadsheets fill your board</div>}
    </div>
  )
}

/** Applies one streamed event to the live answer. */
function reduce(l: Live, e: AiEvent): Live {
  if (e.type === 'thinking') return { ...l, thinking: true }
  if (e.type === 'text') return { ...l, text: l.text + e.delta, thinking: false }
  if (e.type === 'card') return { ...l, cards: [...l.cards, e.card] }
  if (e.type === 'action') return { ...l, actions: [...l.actions.filter((a) => a.id !== e.action.id), e.action] }
  if (e.type === 'step') {
    const s: LiveStep = { id: e.id, label: e.label, state: e.state, detail: e.detail, ms: e.ms }
    const i = l.steps.findIndex((x) => x.id === e.id)
    return { ...l, thinking: false, steps: i < 0 ? [...l.steps, s] : l.steps.map((x, j) => (j === i ? s : x)) }
  }
  return l
}

function statusLine(l: Live) {
  const running = l.steps.find((s) => s.state === 'running')
  if (running) return `${running.label}…`
  if (l.text) return 'Writing the answer…'
  return l.steps.length ? 'Thinking about the next step…' : 'Understanding the request…'
}

/**
 * Keeps the thread scrolled to the newest content while the assistant writes — unless the person scrolls up
 * themselves (wheel, touch, keys). Scrolling back near the bottom follows again.
 */
function useFollow(active: boolean) {
  const el = useRef<HTMLDivElement | null>(null)
  const pinned = useRef(true)
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!node) return
    const near = () => node.scrollHeight - node.scrollTop - node.clientHeight < 80
    const up = () => { pinned.current = false }
    const onWheel = (e: WheelEvent) => { if (e.deltaY < 0) up() }
    const onKey = (e: KeyboardEvent) => { if (['ArrowUp', 'PageUp', 'Home'].includes(e.key)) up() }
    const onScroll = () => { if (near()) pinned.current = true }
    node.addEventListener('wheel', onWheel, { passive: true })
    node.addEventListener('touchmove', up, { passive: true })
    node.addEventListener('keydown', onKey)
    node.addEventListener('scroll', onScroll, { passive: true })
    return () => { node.removeEventListener('wheel', onWheel); node.removeEventListener('touchmove', up); node.removeEventListener('keydown', onKey); node.removeEventListener('scroll', onScroll) }
  }, [node])
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const n = el.current
      if (n && pinned.current) {
        const d = n.scrollHeight - n.clientHeight - n.scrollTop
        if (d > 1) n.scrollTop += Math.max(1, d * 0.2)
      }
      raf = requestAnimationFrame(tick)
    }
    if (active) pinned.current = true
    raf = requestAnimationFrame(tick)
    // After the answer is done, keep following a little while the final cards settle, then stop.
    const stopAt = active ? 0 : window.setTimeout(() => cancelAnimationFrame(raf), 2500)
    return () => { cancelAnimationFrame(raf); if (stopAt) clearTimeout(stopAt) }
  }, [active])
  return useCallback((n: HTMLDivElement | null) => { el.current = n; setNode(n) }, [])
}

/** Text that appears at an even pace however the network delivers it. */
function useSmooth(target: string, running: boolean) {
  const [n, setN] = useState(0)
  const ref = useRef({ n: 0, target })
  ref.current.target = target
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const r = ref.current
      if (r.n < r.target.length) {
        const backlog = r.target.length - r.n
        r.n = Math.min(r.target.length, r.n + Math.max(1, Math.ceil(backlog / 14)))
        setN(r.n)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return running ? target.slice(0, n) : target
}

function UserMsg({ text, file }: { text?: string; file?: string }) {
  return <div className="ah-user">{file && <span className="ah-file">📄 {file}</span>}{text && <div>{text}</div>}</div>
}

const Avatar = ({ spin }: { spin?: boolean }) => (
  <span className={`ah-av ${spin ? 'spin' : ''}`} aria-hidden="true">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff"><path d="M12 2.5l2.2 6.3 6.3 2.2-6.3 2.2L12 19.5l-2.2-6.3L3.5 11l6.3-2.2z" /></svg>
  </span>
)

/** The answer being written right now. */
function LiveMsg({ live, state, theme, openLoad }: { live: Live; state: CrmState; theme: Theme; openLoad: (id: number) => void }) {
  const text = useSmooth(live.text, true)
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(t) }, [])
  return (
    <div className="ah-ai">
      <Avatar spin />
      <div className="ah-ai-body">
        <div className="ah-who">HaulPanel AI</div>
        <Plan steps={live.steps} running elapsed={now - live.started} thinking={live.thinking && !live.text} />
        {text && <div className="ah-text typing"><Markdown text={text} /></div>}
        {live.cards.map((c, i) => <div key={i} className="ah-in"><CardView card={c} state={state} theme={theme} openLoad={openLoad} /></div>)}
        {live.actions.filter((a) => a.status === 'pending').map((a) => <EmailCard key={a.id} a={a} busy />)}
      </div>
    </div>
  )
}

/** A finished answer from the saved chat. */
function AiMsg({ item, actions, state, theme, openLoad, busy, decide, undo }: {
  item: AiItem; actions: Map<string, AiAction>; state: CrmState; theme: Theme; openLoad: (id: number) => void; busy: boolean
  decide: (a: AiAction, approve: boolean) => void; undo: (a: AiAction) => void
}) {
  const steps = (item.steps ?? []).map((s, i): LiveStep => (typeof s === 'string' ? { id: String(i), label: s.replace(/^⚠\s*/, ''), state: s.startsWith('⚠') ? 'error' : 'done' } : { id: String(i), ...s }))
  const done = (item.actions ?? []).map((id) => actions.get(id)).filter((a): a is AiAction => !!a)
  const pending = (item.pending ?? []).map((id) => actions.get(id)).filter((a): a is AiAction => !!a)
  return (
    <div className="ah-ai">
      <Avatar />
      <div className="ah-ai-body">
        <div className="ah-who">HaulPanel AI{item.stopped && <em> · stopped</em>}</div>
        {!!steps.length && <Plan steps={steps} />}
        {item.text && <div className="ah-text"><Markdown text={item.text} /></div>}
        {item.cards?.map((c, i) => <CardView key={i} card={c} state={state} theme={theme} openLoad={openLoad} />)}
        {!!done.length && (
          <div className="ah-card ah-did">
            <div className="ah-card-h">What I did <small>{done.filter((a) => a.status === 'done').length} change{done.length === 1 ? '' : 's'}</small></div>
            {done.map((a) => (
              <div key={a.id} className={`ah-did-row ${a.status}`}>
                <span className="ah-ok" aria-hidden="true">{a.status === 'undone' ? '↺' : '✓'}</span>
                <span><b>{TOOL[a.tool] ?? a.tool}</b> {a.summary.replace(/^(Add load:|Change load|Add carrier)\s*/, '')}</span>
                {a.status === 'done' && a.undoable ? <button className="ah-undo" onClick={() => undo(a)}>Undo</button> : <small>{a.status === 'undone' ? 'Undone' : ''}</small>}
              </div>
            ))}
          </div>
        )}
        {pending.map((a) => <EmailCard key={a.id} a={a} busy={busy} decide={decide} />)}
      </div>
    </div>
  )
}

/** The live plan: every step with its state, what it found and how long it took. Collapses when the work is done. */
function Plan({ steps, running, elapsed, thinking }: { steps: LiveStep[]; running?: boolean; elapsed?: number; thinking?: boolean }) {
  const [open, setOpen] = useState(false)
  const show = running || open
  const total = steps.reduce((s, x) => s + (x.ms ?? 0), 0)
  const bad = steps.filter((s) => s.state === 'error').length
  return (
    <div className={`ah-plan ${running ? 'running' : ''}`}>
      {running && <div className="ah-plan-bar"><i style={{ width: `${Math.min(92, 18 + steps.filter((s) => s.state !== 'running').length * 16)}%` }} /></div>}
      <button type="button" className="ah-plan-h" onClick={() => !running && setOpen((v) => !v)} aria-expanded={show}>
        {running ? <span className="ah-spin" /> : <span className={`ah-ok ${bad ? 'warn' : ''}`}>{bad ? '!' : '✓'}</span>}
        <span className={running ? 'ah-shim' : ''}>{running ? (thinking && !steps.length ? 'Understanding the request' : 'Working on it') : `${steps.length} step${steps.length === 1 ? '' : 's'}${bad ? ` · ${bad} problem${bad === 1 ? '' : 's'}` : ''}`}</span>
        <small>{running ? `${steps.filter((s) => s.state !== 'running').length} done · ${secs(elapsed ?? 0)}` : total ? secs(total) : ''}</small>
        {!running && <em>{open ? 'Hide' : 'Show'}</em>}
      </button>
      {show && !!steps.length && (
        <ol>
          {steps.map((s) => (
            <li key={s.id} className={s.state}>
              <span className="ah-step-i">{s.state === 'running' ? <span className="ah-spin" /> : s.state === 'done' ? '✓' : s.state === 'waiting' ? '…' : '!'}</span>
              <span><span className={s.state === 'running' ? 'ah-shim' : ''}>{s.label}</span>{s.detail && <small>{s.detail}</small>}</span>
              <em>{s.ms != null ? secs(s.ms) : s.state === 'waiting' ? 'your OK' : ''}</em>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** An email the assistant prepared; nothing is sent until "Send". */
function EmailCard({ a, busy, decide }: { a: AiAction; busy: boolean; decide?: (a: AiAction, approve: boolean) => void }) {
  return (
    <div className={`ah-card ah-mail ${a.status}`}>
      <div className="ah-card-h">Email <span className={`ah-tag ${a.status === 'pending' ? 'warn' : a.status === 'done' ? 'ok' : ''}`}>{a.status === 'pending' ? 'Waiting for your OK' : a.status === 'done' ? 'Sent' : a.status === 'failed' ? 'Failed' : 'Not sent'}</span></div>
      {a.preview ? (
        <>
          <div className="ah-mail-h"><span>To</span><b>{a.preview.to}</b><span>Subject</span><b>{a.preview.subject}</b></div>
          <div className="ah-mail-b">{a.preview.lines.map((l, i) => <div key={i}>{l}</div>)}</div>
        </>
      ) : <div className="ah-mail-b">{a.summary}</div>}
      {a.status === 'pending' && decide && (
        <div className="ah-mail-f">
          <button className="primary" disabled={busy} onClick={() => decide(a, true)}>Send</button>
          <button className="ghost" disabled={busy} onClick={() => decide(a, false)}>Don’t send</button>
        </div>
      )}
    </div>
  )
}

/** A new chat: what is going on with the board today, with the request that handles each thing. */
function Briefing({ state, firstName, owner, ask, importData }: { state: CrmState; firstName: string; owner: boolean; ask: (t: string) => void; importData: () => void }) {
  const b = useMemo(() => {
    const now = today()
    const overdue = state.loads.filter((l) => l.status === 'invoiced' && l.invoicedOn && addDays(l.invoicedOn, 30) < now)
    const toInvoice = state.loads.filter((l) => l.status === 'delivered' && !l.invoicedOn)
    const transit = state.loads.filter((l) => l.status === 'in_transit')
    const broker = isBroker(state)
    // A brokerage covers its loads with carriers (their trucks aren't its own); a dispatch service puts its trucks on them.
    const noTruck = state.loads.filter((l) => l.status === 'booked' && (broker ? l.carrierId == null : l.truckId == null))
    const noPay = broker ? state.loads.filter((l) => l.status !== 'paid' && l.carrierId != null && !(l.carrierPay && l.carrierPay > 0)) : []
    const carriersOwed = broker ? state.loads.filter((l) => (l.carrierPay ?? 0) > 0 && !l.carrierPaidOn && ['delivered', 'invoiced', 'paid'].includes(l.status)) : []
    const ws = weekStart(now)
    // This week only (Mon–Sun): loads booked for next week don't count yet.
    const week = state.loads.filter((l) => l.date >= ws && l.date <= addDays(ws, 6))
    const weekGross = week.reduce((s, l) => s + gross(l), 0)
    const miles = week.reduce((s, l) => s + l.loadedMiles, 0)
    const unpaid = state.loads.filter((l) => l.status === 'invoiced').reduce((s, l) => s + gross(l) + l.lumper, 0)
    const alerts = (state.checks ?? []).filter((c) => c.role === 'carrier' && c.level === 'danger')
    const sum = (ls: typeof overdue) => ls.reduce((s, l) => s + gross(l) + l.lumper, 0)
    return { overdue, toInvoice, transit, noTruck, weekGross, miles, unpaid, alerts, sum, week, broker, noPay, carriersOwed }
  }, [state])
  const needs: { tone: string; title: string; sub: string; ask: string; cta: string }[] = []
  if (b.noTruck.length) needs.push(b.broker
    ? { tone: 'warn', title: `${b.noTruck.length} booked load${b.noTruck.length === 1 ? '' : 's'} without a carrier`, sub: b.noTruck.slice(0, 2).map((l) => `${l.broker || 'Load'} ${place(l.origin)} → ${place(l.destination)}`).join(' · '), ask: 'Which booked loads have no carrier yet? List them with lane, date and customer rate.', cta: 'Show' }
    : { tone: 'warn', title: `${b.noTruck.length} booked load${b.noTruck.length === 1 ? '' : 's'} without a truck`, sub: b.noTruck.slice(0, 2).map((l) => `${l.broker || 'Load'} ${place(l.origin)} → ${place(l.destination)}`).join(' · '), ask: 'Which booked loads have no truck yet, and which truck fits each best?', cta: 'Find trucks' })
  if (b.noPay.length) needs.push({ tone: 'warn', title: `${b.noPay.length} load${b.noPay.length === 1 ? '' : 's'} without carrier pay`, sub: 'Margin can’t be counted, and the carrier’s rate con needs it', ask: 'Which loads have a carrier but no carrier pay set?', cta: 'Show' })
  if (b.carriersOwed.length) needs.push({ tone: 'acc', title: `${usd(Math.round(b.carriersOwed.reduce((s, l) => s + (l.carrierPay ?? 0), 0)))} owed to carriers`, sub: `${b.carriersOwed.length} delivered load${b.carriersOwed.length === 1 ? '' : 's'} not paid to the carrier`, ask: 'Which carriers do we owe for delivered loads, and how much each?', cta: 'Review' })
  if (b.toInvoice.length) needs.push({ tone: 'acc', title: `${b.toInvoice.length} delivered, not invoiced — ${usd(Math.round(b.sum(b.toInvoice)))}`, sub: 'Money waiting on an invoice', ask: `Prepare invoices for the ${b.toInvoice.length} delivered loads that aren't invoiced yet`, cta: 'Prepare invoices' })
  if (b.overdue.length) needs.push({ tone: 'bad', title: `${b.overdue.length} overdue invoice${b.overdue.length === 1 ? '' : 's'} — ${usd(Math.round(b.sum(b.overdue)))}`, sub: 'Past net 30', ask: 'Which invoices are overdue, who owes the most, and what should I do?', cta: 'Review' })
  if (b.alerts.length) needs.push({ tone: 'bad', title: `${b.alerts.length} carrier${b.alerts.length === 1 ? '' : 's'} with FMCSA problems`, sub: 'Authority or insurance changed', ask: 'Which carriers have problems with FMCSA, and what exactly?', cta: 'Explain' })
  const fresh = state.loads.length < 3
  return (
    <div className="ah-ai ah-brief">
      <Avatar />
      <div className="ah-ai-body">
        <div className="ah-who">HaulPanel AI <small>Briefing · {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</small></div>
        <div className="ah-text">
          <p><b>{greeting()}, {firstName}.</b> {fresh
            ? (b.broker ? 'Your board is almost empty. Bring your loads, customers and carriers in — just drop your files, I’ll sort them out.' : 'Your board is empty. Bring your loads, carriers, trucks and drivers in — just drop your files, I’ll sort them out.')
            : `This week: ${usd(Math.round(b.weekGross))} gross on ${b.week.length} load${b.week.length === 1 ? '' : 's'}${b.miles ? ` (${fmtRpm(rpm(b.weekGross, b.miles))}/mi)` : ''}. ${b.transit.length} on the road, ${usd(Math.round(b.unpaid))} not paid yet.`}</p>
        </div>
        {fresh && owner && (
          <button className="ah-card ah-import-cta" onClick={importData}>
            <span className="ah-import-ico" aria-hidden="true">⇪</span>
            <span><b>Move your data in</b><small>Excel or CSV load logs, a Google Sheet, carrier lists, rate cons, screenshots of your old TMS — AI fills your board. You check it before anything is saved.</small></span>
            <em>Start →</em>
          </button>
        )}
        {fresh && owner && (
          <button className="ah-card ah-import-cta" onClick={() => ask(SETUP_ASK)}>
            <span className="ah-import-ico" aria-hidden="true">✦</span>
            <span><b>No spreadsheets? Let AI ask you</b><small>{b.broker
              ? 'Your MC, the carriers you book and your customers’ billing emails — answer in a few words, send photos of papers or rate cons. AI looks companies up in FMCSA and fills the board.'
              : 'Your MC, the carriers you dispatch, their trucks and drivers, your dispatchers — answer in a few words, send photos of papers or rate cons. AI looks companies up in FMCSA and fills the board.'}</small></span>
            <em>Start →</em>
          </button>
        )}
        {!!needs.length && (
          <div className="ah-card">
            <div className="ah-card-h">Needs you <span className="ah-tag">{needs.length}</span></div>
            {needs.map((n) => (
              <div key={n.title} className="ah-need">
                <span className={`ah-dot ${n.tone}`} />
                <span><b>{n.title}</b><small>{n.sub}</small></span>
                <button className="primary" onClick={() => ask(n.ask)}>{n.cta}</button>
              </div>
            ))}
          </div>
        )}
        {!fresh && (
          <div className="ah-card ah-kpis">
            <div><span>Gross this week</span><b>{usd(Math.round(b.weekGross))}</b></div>
            <div><span>Rate per mile</span><b>{b.miles ? fmtRpm(rpm(b.weekGross, b.miles)) : '—'}</b></div>
            <div><span>In transit</span><b>{b.transit.length}</b></div>
            <div><span>Not paid yet</span><b>{usd(Math.round(b.unpaid))}</b></div>
          </div>
        )}
        <div className="ah-try">
          {(b.broker
            ? ['What was my margin by customer this month?', 'Which customers owe me money?', 'Check carrier MC ', 'Which loads were delivered but not invoiced?']
            : ['How did each dispatcher do this month?', 'Which brokers pay the best rate per mile?', 'Check broker MC ', 'Which truck ran the most empty miles this month?']).map((t) => (
            <button key={t} onClick={() => ask(t)}>✦ {t.trim()}</button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Moving a dispatch office in: drop files or paste a Google Sheet link → preview → Import. */
export function ImportCard({ initial, close, done, interview }: { initial: File[]; close: () => void; done: (msg: string) => void; interview?: () => void }) {
  const [files, setFiles] = useState<File[]>(initial)
  const [sheet, setSheet] = useState('')
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const pick = useRef<HTMLInputElement>(null)
  const read = async () => {
    setErr(''); setBusy(`Reading ${files.length + (sheet ? 1 : 0)} file${files.length + (sheet ? 1 : 0) === 1 ? '' : 's'}…`)
    try {
      setPlan(await crm.aiImport({ files: await Promise.all(files.map(async (f) => ({ name: f.name, data: await toB64(f) }))), ...(sheet.trim() ? { sheetUrl: sheet.trim() } : {}) }))
    } catch (e) { setErr((e as Error).message) } finally { setBusy('') }
  }
  useEffect(() => { if (initial.length) void read() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const apply = async () => {
    if (!plan) return
    setBusy('Saving to your board…'); setErr('')
    try {
      const r = await crm.aiImportApply(plan.id)
      done(`Imported ${[r.loads && `${r.loads} loads`, r.carriers && `${r.carriers} carriers`, r.trucks && `${r.trucks} trucks`, r.dispatchers && `${r.dispatchers} dispatchers`, r.brokers && `${r.brokers} broker emails`].filter(Boolean).join(', ') || 'nothing new'}`)
    } catch (e) { setErr((e as Error).message); setBusy('') }
  }
  const nNew = (xs: { existing?: boolean; duplicate?: boolean }[]) => xs.filter((x) => !x.existing && !x.duplicate).length
  const fresh = plan ? nNew(plan.loads) + nNew(plan.carriers) + nNew(plan.trucks) + nNew(plan.dispatchers) + plan.brokers.length : 0
  const advice = plan?.advice ?? []
  const again = () => { setPlan(null); setFiles([]); setSheet(''); setErr('') }
  return (
    <div className="ah-ai">
      <Avatar spin={!!busy} />
      <div className="ah-ai-body">
        <div className="ah-who">HaulPanel AI <small>Import</small></div>
        {!plan ? (
          <div className="ah-card ah-imp">
            <div className="ah-card-h">Move your data in<button className="ah-x" onClick={close} aria-label="Close">×</button></div>
            <div className="ah-imp-drop" onClick={() => pick.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setFiles((f) => [...f, ...e.dataTransfer.files]) }}>
              <b>Drop files here or click to choose</b>
              <small>Excel · CSV · PDF · photos · screenshots — load logs, carrier and driver lists, rate cons, exports from your old TMS</small>
            </div>
            {interview && <button className="ah-imp-ask" onClick={interview}>✦ No files? <b>Let AI ask you</b> — answer a few questions and it fills the board</button>}
            {!!files.length && <div className="ah-imp-files">{files.map((f, i) => <span key={i} className="ah-chip">📄 {f.name}<button aria-label="Remove" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}>×</button></span>)}</div>}
            <label className="ah-imp-sheet"><span>or a Google Sheet</span><input value={sheet} onChange={(e) => setSheet(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/… (Share → Anyone with the link)" /></label>
            <div className="ah-imp-f">
              {busy ? <span className="ah-status"><span className="ah-spin" /> {busy}</span> : <small>Nothing is saved until you check the preview.</small>}
              <button className="primary" disabled={!!busy || (!files.length && !sheet.trim())} onClick={() => void read()}>Read with AI</button>
            </div>
            <input ref={pick} type="file" hidden multiple accept=".xlsx,.xls,.csv,.tsv,application/pdf,image/*" onChange={(e) => { setFiles((f) => [...f, ...(e.target.files ?? [])]); e.target.value = '' }} />
          </div>
        ) : !fresh ? (
          <>
            <div className="ah-text">
              <p><b>Nothing to add to your board from {plan.sources.length + plan.skipped.length === 1 ? 'this file' : 'these files'}.</b></p>
              {advice.map((a, i) => <p key={i}>{a.name && advice.length > 1 ? <><b>{a.name}:</b> </> : null}{a.text}</p>)}
            </div>
            <div className="ah-card ah-imp-f">
              <small>Nothing was saved.</small>
              <button className="ghost" onClick={close}>Close</button>
              {interview && <button className="ghost" onClick={interview}>Let AI ask you instead</button>}
              <button className="primary" onClick={again}>Add other files</button>
            </div>
          </>
        ) : (
          <>
            <div className="ah-text"><p><b>Here’s what I found.</b> {plan.sources.map((s) => `${s.name} — ${s.what}`).join('; ') || 'Nothing readable.'}</p></div>
            <div className="ah-card ah-kpis">
              <div><span>Loads</span><b>{nNew(plan.loads)}</b>{plan.loads.length - nNew(plan.loads) > 0 && <small>{plan.loads.length - nNew(plan.loads)} already on board</small>}</div>
              <div><span>Carriers</span><b>{nNew(plan.carriers)}</b>{plan.carriers.length - nNew(plan.carriers) > 0 && <small>{plan.carriers.length - nNew(plan.carriers)} already on board</small>}</div>
              <div><span>Trucks &amp; drivers</span><b>{nNew(plan.trucks)}</b>{plan.trucks.length - nNew(plan.trucks) > 0 && <small>{plan.trucks.length - nNew(plan.trucks)} already on board</small>}</div>
              <div><span>Dispatchers</span><b>{nNew(plan.dispatchers)}</b></div>
            </div>
            {!!plan.loads.length && (
              <div className="ah-card">
                <div className="ah-card-h">Loads <small>first {Math.min(8, plan.loads.length)} of {plan.loads.length}</small></div>
                <div className="ah-table-wrap"><table className="ah-table">
                  <thead><tr><th>Pickup</th><th>Broker</th><th>Lane</th><th>Carrier</th><th className="num">Rate</th><th>Status</th></tr></thead>
                  <tbody>{plan.loads.slice(0, 8).map((l, i) => (
                    <tr key={i} className={l.duplicate ? 'dim' : ''}><td>{shortDate(l.date)}</td><td><b>{l.broker || '—'}</b>{l.pro && <small>#{l.pro}</small>}</td><td>{place(l.origin) || '—'} → {place(l.destination) || '—'}</td><td>{l.carrier || '—'}</td><td className="num">{usd(l.rate)}</td><td>{l.duplicate ? <span className="ah-tag">On board</span> : <span className={`pill st-${l.status}`}>{STATUSES.find((s) => s.id === l.status)?.label}</span>}</td></tr>
                  ))}</tbody>
                </table></div>
              </div>
            )}
            {!!(plan.carriers.length + plan.trucks.length) && (
              <div className="ah-card ah-imp-lists">
                {!!plan.carriers.length && <div><div className="ah-card-h">Carriers</div>{plan.carriers.slice(0, 10).map((c, i) => <div key={i} className={c.existing ? 'dim' : ''}><b>{c.name}</b> {c.mc && <small>MC {c.mc}</small>} {c.existing && <span className="ah-tag">On board</span>}</div>)}</div>}
                {!!plan.trucks.length && <div><div className="ah-card-h">Trucks &amp; drivers</div>{plan.trucks.slice(0, 10).map((t, i) => <div key={i} className={t.existing ? 'dim' : ''}><b>{t.unit ? `#${t.unit}` : 'Truck'}</b> {t.driver} {t.existing && <span className="ah-tag">On board</span>}</div>)}</div>}
              </div>
            )}
            {!!plan.skipped.length && <p className="ah-muted">Skipped: {plan.skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}</p>}
            {advice.map((a, i) => <p key={i} className="ah-muted">⚠ {a.name && <b>{a.name}: </b>}{a.text}</p>)}
            <div className="ah-card ah-imp-f">
              {busy ? <span className="ah-status"><span className="ah-spin" /> {busy}</span> : <small>Items already on your board are not added twice. Carriers with an MC are checked in FMCSA after import.</small>}
              <button className="ghost" disabled={!!busy} onClick={close}>Cancel</button>
              <button className="primary" disabled={!!busy || !fresh} onClick={() => void apply()}>Import to my board</button>
            </div>
          </>
        )}
        {err && <p className="ah-err">⚠ {err}</p>}
      </div>
    </div>
  )
}

function CardView({ card, state, theme, openLoad }: { card: AiCard; state: CrmState; theme: Theme; openLoad: (id: number) => void }) {
  const [all, setAll] = useState(false)
  const lane = useCallback((a: string, b: string): Promise<LaneResult> => crm.lane(a, b), [])
  if (card.type === 'loads') {
    const loads = card.ids.map((id) => state.loads.find((l) => l.id === id)).filter((l): l is CrmState['loads'][number] => !!l)
    const shown = all ? loads : loads.slice(0, 8)
    return (
      <div className="ah-card">
        <div className="ah-card-h">{card.title}</div>
        {!loads.length ? <p className="ah-muted ah-pad">No loads.</p> : (
          <div className="ah-table-wrap">
            <table className="ah-table">
              <thead><tr><th>Pickup</th><th>{isBroker(state) ? 'Customer' : 'Broker'}</th><th>Lane</th><th className="num">Miles</th><th className="num">Gross</th><th className="num">RPM</th><th>Status</th></tr></thead>
              <tbody>
                {shown.map((l) => (
                  <tr key={l.id} className="click" onClick={() => openLoad(l.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') openLoad(l.id) }}>
                    <td>{shortDate(l.date)}</td>
                    <td><b>{l.broker || '—'}</b>{l.pro && <small>#{l.pro}</small>}</td>
                    <td>{place(l.origin) || '—'} → {place(l.destination) || '—'}</td>
                    <td className="num">{l.loadedMiles ? l.loadedMiles.toLocaleString('en-US') : '—'}</td>
                    <td className="num"><b>{usd(gross(l))}</b></td>
                    <td className="num">{fmtRpm(rpm(gross(l), l.loadedMiles))}</td>
                    <td><span className={`pill st-${l.status}`}>{STATUSES.find((s) => s.id === l.status)?.label}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {loads.length > 8 && <button className="ah-more" onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show all ${loads.length}`}</button>}
      </div>
    )
  }
  if (card.type === 'table') {
    return (
      <div className="ah-card">
        <div className="ah-card-h">{card.title}</div>
        <div className="ah-table-wrap">
          <table className="ah-table">
            <thead><tr>{card.columns.map((c, i) => <th key={i} className={i ? 'num' : ''}>{c}</th>)}</tr></thead>
            <tbody>{card.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={j ? 'num' : ''}>{j === 0 ? <b>{v}</b> : v}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </div>
    )
  }
  if (card.type === 'kpis') return <div className="ah-card ah-kpis">{card.items.map((k) => <div key={k.label}><span>{k.label}</span><b>{k.value}</b>{k.sub && <small>{k.sub}</small>}</div>)}</div>
  if (card.type === 'bars') {
    const max = Math.max(...card.rows.map((r) => r.value), 1)
    return (
      <div className="ah-card">
        <div className="ah-card-h">{card.title}</div>
        <div className="ah-bars">
          {card.rows.map((r) => (
            <div key={r.label} className="ah-bar-row" title={`${r.label}: ${r.text}`}>
              <span>{r.label}</span>
              <div><i style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} /></div>
              <b>{r.text}</b>
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (card.type === 'check') return <div className="ah-card ah-pad"><div className="ah-card-k">FMCSA check · {card.check.role}</div><CheckBadge check={card.check} details /></div>
  if (card.type === 'route') {
    return (
      <div className="ah-card">
        <div className="ah-card-h">Route · {place(card.from)} → {place(card.to)} <small>{card.miles.toLocaleString('en-US')} mi · ~{Math.round(card.hours)} h</small></div>
        <div className="ah-route"><RouteMap from={card.from} to={card.to} theme={theme} lane={lane} /></div>
      </div>
    )
  }
  if (card.type === 'link') return <div className="ah-card ah-pad">🔗 {card.label}: <a href={card.url} target="_blank" rel="noopener">{card.url.replace(/^https?:\/\//, '')}</a> <button className="ah-more" onClick={() => void navigator.clipboard.writeText(card.url)}>Copy</button></div>
  return <div className="ah-card ah-pad ah-done">✓ {card.text}</div>
}

/** Just enough Markdown for answers: paragraphs, **bold**, `code`, lists, tables, links, headings. */
export function Markdown({ text }: { text: string }) {
  const inline = (s: string): ReactNode[] => s.split(/(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/\S+)/g).map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <b key={i}>{p.slice(2, -2)}</b>
    if (/^`[^`]+`$/.test(p)) return <code key={i}>{p.slice(1, -1)}</code>
    if (/^https?:\/\//.test(p)) return <a key={i} href={p} target="_blank" rel="noopener">{p}</a>
    return p.replace(/\*\*/g, '')
  })
  const blocks: ReactNode[] = []
  const lines = text.replace(/\r/g, '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    if (/^\s*\|/.test(line)) {
      const rows: string[][] = []
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        if (!/^\s*\|?\s*:?-{2,}/.test(lines[i])) rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
        i++
      }
      i--
      blocks.push(<div key={i} className="ah-table-wrap"><table className="ah-table"><thead><tr>{rows[0]?.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead><tbody>{rows.slice(1).map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody></table></div>)
    } else if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line)
      const items: string[] = []
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, '')); i++ }
      i--
      blocks.push(ordered ? <ol key={i}>{items.map((x, j) => <li key={j}>{inline(x)}</li>)}</ol> : <ul key={i}>{items.map((x, j) => <li key={j}>{inline(x)}</li>)}</ul>)
    } else if (/^#{1,4}\s/.test(line)) {
      blocks.push(<h4 key={i}>{inline(line.replace(/^#+\s/, ''))}</h4>)
    } else {
      blocks.push(<p key={i}>{inline(line)}</p>)
    }
  }
  return <>{blocks}</>
}
