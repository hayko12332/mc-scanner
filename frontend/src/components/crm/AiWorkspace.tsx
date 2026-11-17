import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import {
  addDays, crm, fmtRpm, gross, rpm, shortDate, STATUSES, today, usd, weekStart,
  type AiAction, type AiCard, type AiItem, type AiView, type CrmState, type LaneResult,
} from '../../lib/crm'
import { CheckBadge } from './CheckBadge'
import { prepare } from './LoadDocs'
import { place } from './LoadsTable'
import { RouteMap } from './MapView'

const THREAD_KEY = 'haulpanel.ai.thread'
type Theme = 'light' | 'dark'
type History = { id: string; title: string; updatedAt: string }

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
const TOOL_TITLE: Record<string, string> = { create_load: 'Add load', update_load: 'Change load', send_invoice: 'Send invoice', add_carrier: 'Add carrier' }

/**
 * AI Assistant — the board's main working tool, full width: a briefing of what needs attention today, then a
 * conversation where the assistant finds, totals and checks things with the board's own tools and prepares changes
 * you confirm. Chat history on the left, what this chat touched on the right. One page scroll; the composer stays
 * at the bottom.
 */
export function AiWorkspace({ state, theme, openLoad, changed, prompt, onPromptUsed, contextLoadId, firstName }: {
  state: CrmState
  theme: Theme
  openLoad: (id: number) => void
  changed: () => void
  /** A question typed in the "Ask AI" bar of another section: put in the composer and sent. */
  prompt?: { text: string; send: boolean } | null
  onPromptUsed: () => void
  /** A load the user came from ("this load"). */
  contextLoadId?: number | null
  firstName: string
}) {
  const [view, setView] = useState<AiView | null>(null)
  const [history, setHistory] = useState<History[]>([])
  const [q, setQ] = useState('')
  const [file, setFile] = useState<{ name: string; blob: Blob } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const handled = useRef<object | null>(null)

  const loadHistory = useCallback(() => { crm.aiThreads().then(setHistory, () => undefined) }, [])
  useEffect(() => {
    loadHistory()
    let id = ''
    try { id = localStorage.getItem(THREAD_KEY) ?? '' } catch { /* no storage */ }
    if (id) crm.aiThread(id).then(setView, () => undefined)
  }, [loadHistory])
  useEffect(() => { try { if (view?.threadId) localStorage.setItem(THREAD_KEY, view.threadId) } catch { /* no storage */ } }, [view?.threadId])
  useEffect(() => { if (view?.items.length || busy) end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }) }, [view, busy])

  const run = async (fn: () => Promise<AiView>, optimistic?: AiItem) => {
    if (optimistic) setView((v) => ({ threadId: v?.threadId ?? '', title: v?.title ?? '', pending: v?.pending ?? [], items: [...(v?.items ?? []), optimistic] }))
    setBusy(true)
    setErr('')
    const doneBefore = (view?.pending ?? []).filter((p) => p.status === 'done').length + countDone(view)
    try {
      const v = await fn()
      setView(v)
      if (countDone(v) + v.pending.filter((p) => p.status === 'done').length > doneBefore) changed()
      loadHistory()
    } catch (e) {
      setErr((e as Error).message)
      if (view?.threadId) crm.aiThread(view.threadId).then(setView, () => undefined)
    } finally {
      setBusy(false)
      input.current?.focus()
    }
  }

  const send = async (text: string, attached = file) => {
    const t = text.trim()
    if ((!t && !attached) || busy) return
    setQ('')
    setFile(null)
    await run(async () => crm.aiChat({
      threadId: view?.threadId || undefined, text: t, loadId: contextLoadId ?? null,
      ...(attached ? { file: { name: attached.name, data: await toB64(attached.blob) } } : {}),
    }), { role: 'user', text: t, ...(attached ? { file: attached.name } : {}) })
  }
  const decide = (ids: string[], approve: boolean) => {
    if (!view) return
    void run(async () => {
      let v = view
      for (const id of ids) v = await crm.aiDecide(v.threadId, id, approve)
      return v
    })
  }

  // A question from the "Ask AI" bar elsewhere on the board.
  useEffect(() => {
    // Each question is handled once, even when React runs the effect twice.
    if (!prompt || handled.current === prompt) return
    handled.current = prompt
    onPromptUsed()
    if (prompt.send) void send(prompt.text)
    else { setQ(prompt.text); input.current?.focus() }
  }, [prompt]) // eslint-disable-line react-hooks/exhaustive-deps

  const attach = async (f: File) => { try { const p = await prepare(f); setFile({ name: p.name, blob: p.blob }); input.current?.focus() } catch (e) { setErr((e as Error).message) } }
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) void attach(f) }
  const newChat = () => { setView(null); setErr(''); setQ(''); try { localStorage.removeItem(THREAD_KEY) } catch { /* no storage */ } input.current?.focus() }
  const openChat = (id: string) => { setErr(''); crm.aiThread(id).then(setView, (e: Error) => setErr(e.message)) }
  const removeChat = (id: string) => { void crm.aiDeleteThread(id).then(() => { if (view?.threadId === id) newChat(); loadHistory() }) }

  const items = view?.items ?? []
  const pending = new Map((view?.pending ?? []).map((p) => [p.id, p]))
  const open = (view?.pending ?? []).filter((p) => p.status === 'pending')
  const empty = !items.length && !busy

  const composer = (
    <div className={`aiw-compose ${empty ? 'aiw-compose-big' : ''}`}>
      {file && <span className="ask-chip">📄 {file.name}<button type="button" aria-label="Remove file" onClick={() => setFile(null)}>×</button></span>}
      <div className="aiw-input">
        <textarea ref={input} rows={empty ? 3 : 1} value={q} autoFocus
          placeholder={contextLoadId ? `Ask about load #${contextLoadId}, or anything on your board…` : 'Ask anything, or tell me what to do — “send invoices for everything delivered this week”'}
          onChange={(e) => { setQ(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(220, e.target.scrollHeight)}px` }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(q) } }} />
        <div className="aiw-input-bar">
          <button type="button" className="aiw-attach" onClick={() => picker.current?.click()} title="Attach a rate con, BOL or POD (PDF or photo)">📎 Attach</button>
          <span className="aiw-hint">Enter to send · I ask before changing anything</span>
          <button className="aiw-send" disabled={busy || (!q.trim() && !file)} onClick={() => void send(q)} aria-label="Send">↑</button>
        </div>
      </div>
      <input ref={picker} type="file" hidden accept="application/pdf,image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void attach(f); e.target.value = '' }} />
    </div>
  )

  return (
    <div className={`aiw ${drag ? 'drag' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false) }} onDrop={onDrop}>
      <aside className="aiw-hist" aria-label="Chats">
        <button className="aiw-new" onClick={newChat}>＋ New chat</button>
        <div className="aiw-hist-label">Recent</div>
        {!history.length && <p className="aiw-hist-empty">Your chats show up here.</p>}
        {history.map((h) => (
          <div key={h.id} className={`aiw-hist-item ${view?.threadId === h.id ? 'on' : ''}`}>
            <button onClick={() => openChat(h.id)} title={h.title}><span>{h.title}</span><small>{ago(h.updatedAt)}</small></button>
            <button className="aiw-hist-x" aria-label="Delete chat" onClick={() => { if (confirm('Delete this chat?')) removeChat(h.id) }}>×</button>
          </div>
        ))}
      </aside>

      <section className="aiw-main">
        {empty ? (
          <div className="aiw-hero">
            <div className="aiw-orb" aria-hidden="true">✦</div>
            <h1>{greeting()}, {firstName}</h1>
            <p>I’m your dispatch assistant. I work right on your board — find and total loads, check brokers and carriers, read rate cons, mark loads paid and send invoices. Nothing changes until you confirm.</p>
            {composer}
            <Briefing state={state} ask={(t) => void send(t)} attach={() => picker.current?.click()} />
          </div>
        ) : (
          <>
            <div className="aiw-thread">
              {items.map((it, i) => (
                <Fragment key={i}>
                  {it.role === 'user' ? (
                    <div className="aiw-user">{it.file && <span className="aiw-file">📄 {it.file}</span>}{it.text && <div>{it.text}</div>}</div>
                  ) : (
                    <div className="aiw-ai">
                      <div className="aiw-avatar" aria-hidden="true">✦</div>
                      <div className="aiw-ai-body">
                        {!!it.steps?.length && <div className="aiw-steps">{it.steps.map((s, j) => <span key={j} className={s.startsWith('⚠') ? 'warn' : ''}>{s.startsWith('⚠') ? s : `✓ ${s}`}</span>)}</div>}
                        {it.text && <div className="aiw-text"><Markdown text={it.text} /></div>}
                        {it.cards?.map((c, j) => <CardView key={j} card={c} state={state} theme={theme} openLoad={openLoad} />)}
                        {it.pending?.map((id) => { const p = pending.get(id); return p ? <ActionCard key={id} p={p} busy={busy} decide={decide} /> : null })}
                      </div>
                    </div>
                  )}
                </Fragment>
              ))}
              {open.length > 1 && (
                <div className="aiw-confirm-all">
                  <span>{open.length} actions waiting for you</span>
                  <button className="ghost" disabled={busy} onClick={() => decide(open.map((p) => p.id), false)}>Cancel all</button>
                  <button className="primary" disabled={busy} onClick={() => decide(open.map((p) => p.id), true)}>Confirm all {open.length}</button>
                </div>
              )}
              {busy && (
                <div className="aiw-ai">
                  <div className="aiw-avatar spin" aria-hidden="true">✦</div>
                  <div className="aiw-ai-body"><div className="aiw-working"><i /><i /><i /><span>Working on your board…</span></div></div>
                </div>
              )}
              {err && <p className="aiw-err">⚠ {err}</p>}
              <div ref={end} />
            </div>
            <div className="aiw-dock">{composer}</div>
          </>
        )}
      </section>

      <aside className="aiw-ctx" aria-label="In this chat">
        <ContextRail state={state} view={view} openLoad={openLoad} contextLoadId={contextLoadId} />
      </aside>
      {drag && <div className="aiw-dropzone">Drop the rate con, BOL or POD — I’ll read it</div>}
    </div>
  )
}

const countDone = (v: AiView | null) => (v?.items ?? []).filter((i) => i.cards?.some((c) => c.type === 'note' || (c.type === 'loads' && /added|updated/i.test(c.title)))).length
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening' }

/** What needs attention on the board today, each with the request that handles it. */
function Briefing({ state, ask, attach }: { state: CrmState; ask: (t: string) => void; attach: () => void }) {
  const b = useMemo(() => {
    const now = today()
    const overdue = state.loads.filter((l) => l.status === 'invoiced' && l.invoicedOn && addDays(l.invoicedOn, 30) < now)
    const toInvoice = state.loads.filter((l) => l.status === 'delivered' && !l.invoicedOn)
    const transit = state.loads.filter((l) => l.status === 'in_transit')
    const noTruck = state.loads.filter((l) => l.status === 'booked' && l.truckId == null)
    const ws = weekStart(now), lws = addDays(ws, -7)
    const week = state.loads.filter((l) => l.date >= ws).reduce((s, l) => s + gross(l), 0)
    const last = state.loads.filter((l) => l.date >= lws && l.date < ws && l.date <= addDays(now, -7)).reduce((s, l) => s + gross(l), 0)
    const alerts = (state.checks ?? []).filter((c) => c.role === 'carrier' && c.level === 'danger')
    const sum = (ls: typeof overdue) => ls.reduce((s, l) => s + gross(l) + l.lumper, 0)
    return { overdue, toInvoice, transit, noTruck, week, last, alerts, sum }
  }, [state])
  const tiles: { tone: string; k: string; v: string; sub: string; ask: string; cta: string }[] = []
  tiles.push({ tone: 'blue', k: 'Gross this week', v: usd(Math.round(b.week)), sub: b.last ? `${b.week >= b.last ? '▲' : '▼'} ${Math.abs(Math.round(((b.week - b.last) / b.last) * 100))}% vs same days last week` : 'week to date', ask: 'How are we doing this week vs last week, per dispatcher?', cta: 'Break it down' })
  if (b.toInvoice.length) tiles.push({ tone: 'violet', k: 'Delivered, not invoiced', v: `${b.toInvoice.length} · ${usd(b.sum(b.toInvoice))}`, sub: 'money waiting on an invoice', ask: `Send invoices for the ${b.toInvoice.length} delivered loads that aren't invoiced yet`, cta: 'Send invoices' })
  if (b.overdue.length) tiles.push({ tone: 'red', k: 'Overdue invoices', v: `${b.overdue.length} · ${usd(b.sum(b.overdue))}`, sub: 'past net 30', ask: 'Which invoices are overdue, who owes the most, and what should I do?', cta: 'Review' })
  if (b.transit.length) tiles.push({ tone: 'amber', k: 'In transit', v: String(b.transit.length), sub: 'loads on the road', ask: 'Which loads are in transit, with which trucks, and when do they deliver?', cta: 'Show' })
  if (b.noTruck.length) tiles.push({ tone: 'amber', k: 'Booked, no truck', v: String(b.noTruck.length), sub: 'need a truck assigned', ask: 'Which booked loads have no truck yet?', cta: 'Show' })
  if (b.alerts.length) tiles.push({ tone: 'red', k: 'Carrier alerts', v: String(b.alerts.length), sub: 'FMCSA problems found', ask: 'Which carriers have problems with FMCSA, and what exactly?', cta: 'Explain' })
  return (
    <div className="aiw-brief">
      <div className="aiw-brief-h">Today on your board</div>
      <div className="aiw-tiles">
        {tiles.map((t) => (
          <button key={t.k} className={`aiw-tile ${t.tone}`} onClick={() => ask(t.ask)}>
            <span className="aiw-tile-k">{t.k}</span>
            <b>{t.v}</b>
            <small>{t.sub}</small>
            <em>{t.cta} →</em>
          </button>
        ))}
      </div>
      <div className="aiw-try">
        <button onClick={attach}>📄 Add a load from a rate con</button>
        <button onClick={() => ask('Which brokers paid us the best rate per mile this month?')}>Top brokers by RPM this month</button>
        <button onClick={() => ask('Which truck ran the most empty miles this month, and why?')}>Deadhead by truck</button>
        <button onClick={() => ask('Check broker MC ')}>Check a broker by MC</button>
      </div>
    </div>
  )
}

/** Right rail: the loads this chat is about and what was done in it. */
function ContextRail({ state, view, openLoad, contextLoadId }: { state: CrmState; view: AiView | null; openLoad: (id: number) => void; contextLoadId?: number | null }) {
  const ids = [...new Set([...(contextLoadId ? [contextLoadId] : []), ...(view?.items ?? []).flatMap((i) => i.cards ?? []).flatMap((c) => (c.type === 'loads' ? c.ids : []))])].slice(0, 8)
  const loads = ids.map((id) => state.loads.find((l) => l.id === id)).filter((l): l is CrmState['loads'][number] => !!l)
  const done = (view?.pending ?? []).filter((p) => p.status !== 'pending')
  return (
    <>
      <div className="aiw-ctx-sec">
        <div className="aiw-ctx-h">Loads in this chat</div>
        {!loads.length ? <p className="aiw-ctx-empty">Loads the assistant finds show up here.</p> : loads.map((l) => (
          <button key={l.id} className="aiw-ctx-load" onClick={() => openLoad(l.id)}>
            <span className={`dot st-${l.status}`} /><span><b>{l.broker || 'Load'}</b><small>{place(l.origin) || '—'} → {place(l.destination) || '—'}</small></span><em>{usd(gross(l))}</em>
          </button>
        ))}
      </div>
      <div className="aiw-ctx-sec">
        <div className="aiw-ctx-h">Done in this chat</div>
        {!done.length ? <p className="aiw-ctx-empty">Actions you confirm are listed here.</p> : done.map((p) => (
          <div key={p.id} className={`aiw-ctx-done ${p.status}`}><b>{p.status === 'done' ? '✓' : p.status === 'failed' ? '⚠' : '–'} {TOOL_TITLE[p.tool] ?? p.tool}</b><small>{p.summary}</small></div>
        ))}
      </div>
      <div className="aiw-ctx-sec aiw-ctx-can">
        <div className="aiw-ctx-h">The assistant can</div>
        <ul>
          <li>Find and total loads by any filter</li>
          <li>Check brokers and carriers in FMCSA</li>
          <li>Read a rate con and add the load</li>
          <li>Change status, mark paid, send invoices</li>
          <li>Miles, RPM, deadhead, tracking links</li>
        </ul>
      </div>
    </>
  )
}

function ActionCard({ p, busy, decide }: { p: AiAction; busy: boolean; decide: (ids: string[], approve: boolean) => void }) {
  return (
    <div className={`aiw-action ${p.status}`}>
      <div className="aiw-action-top">
        <span className="aiw-action-tag">{TOOL_TITLE[p.tool] ?? p.tool}</span>
        {p.status !== 'pending' && <em>{p.status === 'done' ? '✓ Done' : p.status === 'failed' ? '⚠ Failed' : 'Cancelled'}</em>}
      </div>
      <p>{p.summary}</p>
      {p.status === 'pending' && (
        <div className="aiw-action-b">
          <button className="ghost" disabled={busy} onClick={() => decide([p.id], false)}>Cancel</button>
          <button className="primary" disabled={busy} onClick={() => decide([p.id], true)}>Confirm</button>
        </div>
      )}
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
      <div className="aiw-card">
        <div className="aiw-card-h">{card.title}</div>
        {!loads.length ? <p className="aiw-card-empty">No loads.</p> : (
          <div className="aiw-table-wrap">
            <table className="aiw-table aiw-loads">
              <thead><tr><th>Pickup</th><th>Broker</th><th>Lane</th><th className="num">Miles</th><th className="num">Gross</th><th className="num">RPM</th><th>Status</th></tr></thead>
              <tbody>
                {shown.map((l) => (
                  <tr key={l.id} onClick={() => openLoad(l.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') openLoad(l.id) }}>
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
        {loads.length > 8 && <button className="w-link aiw-more" onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show all ${loads.length}`}</button>}
      </div>
    )
  }
  if (card.type === 'table') {
    return (
      <div className="aiw-card">
        <div className="aiw-card-h">{card.title}</div>
        <div className="aiw-table-wrap">
          <table className="aiw-table">
            <thead><tr>{card.columns.map((c, i) => <th key={i} className={i ? 'num' : ''}>{c}</th>)}</tr></thead>
            <tbody>{card.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={j ? 'num' : ''}>{j === 0 ? <b>{v}</b> : v}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </div>
    )
  }
  if (card.type === 'check') return <div className="aiw-card aiw-pad"><div className="aiw-card-k">FMCSA check · {card.check.role}</div><CheckBadge check={card.check} details /></div>
  if (card.type === 'route') {
    return (
      <div className="aiw-card">
        <div className="aiw-card-h">Route · {place(card.from)} → {place(card.to)} · {card.miles.toLocaleString('en-US')} mi · ~{Math.round(card.hours)} h</div>
        <div className="aiw-route"><RouteMap from={card.from} to={card.to} theme={theme} lane={lane} /></div>
      </div>
    )
  }
  if (card.type === 'link') return <div className="aiw-card aiw-pad">🔗 {card.label}: <a href={card.url} target="_blank" rel="noopener">{card.url.replace(/^https?:\/\//, '')}</a> <button className="w-link" onClick={() => void navigator.clipboard.writeText(card.url)}>Copy</button></div>
  return <div className="aiw-card aiw-done">✓ {card.text}</div>
}

/** Just enough Markdown for answers: paragraphs, **bold**, `code`, lists, tables, links, headings. */
export function Markdown({ text }: { text: string }) {
  const inline = (s: string): ReactNode[] => s.split(/(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/\S+)/g).map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <b key={i}>{p.slice(2, -2)}</b>
    if (/^`[^`]+`$/.test(p)) return <code key={i}>{p.slice(1, -1)}</code>
    if (/^https?:\/\//.test(p)) return <a key={i} href={p} target="_blank" rel="noopener">{p}</a>
    return p
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
      blocks.push(<div key={i} className="aiw-table-wrap"><table className="aiw-table"><thead><tr>{rows[0]?.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead><tbody>{rows.slice(1).map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody></table></div>)
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
