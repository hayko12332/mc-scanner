import { Fragment, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react'
import { addDays, crm, gross, shortDate, STATUSES, today, usd, type AiCard, type AiView, type CrmState } from '../../lib/crm'
import { CheckBadge } from './CheckBadge'
import { prepare } from './LoadDocs'
import { place } from './LoadsTable'

const THREAD_KEY = 'haulpanel.ai.thread'
const toB64 = async (b: Blob) => {
  const bytes = new Uint8Array(await b.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/**
 * Ask AI — an assistant that works the board: it finds and totals loads, checks brokers and carriers, gets miles,
 * reads rate cons, and prepares changes (add or change loads, mark paid, send invoices) that run only when you
 * tap Confirm. Results come back as cards you can click. The chat is kept, so you can close it and come back.
 */
export function AskPanel({ state, close, openLoad, changed, loadId }: {
  state: CrmState
  close: () => void
  openLoad: (id: number) => void
  /** Reload the board after the assistant changed something. */
  changed: () => void
  /** The load open on the board, if any ("this load"). */
  loadId?: number | null
}) {
  const [view, setView] = useState<AiView | null>(null)
  const [q, setQ] = useState('')
  const [file, setFile] = useState<{ name: string; blob: Blob } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [drag, setDrag] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)

  // Pick up the last chat where it was left.
  useEffect(() => {
    let id = ''
    try { id = localStorage.getItem(THREAD_KEY) ?? '' } catch { /* no storage */ }
    if (id) crm.aiThread(id).then(setView, () => undefined)
    input.current?.focus()
  }, [])
  useEffect(() => {
    try { if (view?.threadId) localStorage.setItem(THREAD_KEY, view.threadId) } catch { /* no storage */ }
  }, [view?.threadId])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [close])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [view, busy])

  const run = async (fn: () => Promise<AiView>, optimistic?: string) => {
    if (optimistic != null) setView((v) => ({ threadId: v?.threadId ?? '', pending: v?.pending ?? [], items: [...(v?.items ?? []), { role: 'user', text: optimistic }] }))
    setBusy(true)
    setErr('')
    try {
      const doneBefore = view?.items.filter((i) => i.cards?.some((c) => c.type === 'note' || (c.type === 'loads' && /added|updated/i.test(c.title)))).length ?? 0
      const v = await fn()
      setView(v)
      const doneAfter = v.items.filter((i) => i.cards?.some((c) => c.type === 'note' || (c.type === 'loads' && /added|updated/i.test(c.title)))).length
      if (doneAfter > doneBefore) changed()
    } catch (e) {
      setErr((e as Error).message)
      if (view?.threadId) crm.aiThread(view.threadId).then(setView, () => undefined)
    } finally {
      setBusy(false)
      input.current?.focus()
    }
  }

  const send = async (text: string) => {
    const t = text.trim()
    if ((!t && !file) || busy) return
    const f = file
    setQ('')
    setFile(null)
    await run(async () => crm.aiChat({
      threadId: view?.threadId || undefined, text: t, loadId: loadId ?? null,
      ...(f ? { file: { name: f.name, data: await toB64(f.blob) } } : {}),
    }), f ? `📄 ${f.name}${t ? `\n${t}` : ''}` : t)
  }
  const decide = (id: string, approve: boolean) => { if (view) void run(() => crm.aiDecide(view.threadId, id, approve)) }
  const attach = async (f: File) => {
    try { const p = await prepare(f); setFile({ name: p.name, blob: p.blob }) } catch (e) { setErr((e as Error).message) }
  }
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) void attach(f) }
  const newChat = () => { setView(null); setErr(''); try { localStorage.removeItem(THREAD_KEY) } catch { /* no storage */ } input.current?.focus() }

  const suggestions = useMemo(() => suggest(state, loadId), [state, loadId])
  const pending = new Map((view?.pending ?? []).map((p) => [p.id, p]))
  const items = view?.items ?? []

  return (
    <div className="ld-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <aside className={`ld ask ${drag ? 'drag' : ''}`} role="dialog" aria-label="Ask AI" onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
        <header className="ld-head">
          <div>
            <small>Works with your board · changes only after you confirm</small>
            <h2><span className="ai-spark" aria-hidden="true">✦</span> Ask AI</h2>
          </div>
          <span className="ask-head-r">
            {items.length > 0 && <button className="ghost" onClick={newChat}>New chat</button>}
            <button className="ld-x" aria-label="Close" onClick={close}>×</button>
          </span>
        </header>

        <div className="ld-body ask-body" aria-live="polite">
          {!items.length && (
            <div className="ask-start">
              <p>I can find and total your loads, check brokers and carriers, get miles, read a rate con and add the load, mark loads paid and send invoices — you confirm every change.</p>
              <div className="ask-sugg">
                {suggestions.map((s) => <button key={s} onClick={() => void send(s)}>{s}</button>)}
                <button onClick={() => picker.current?.click()}>📄 Add a load from a rate con…</button>
              </div>
            </div>
          )}
          {items.map((it, i) => (
            <Fragment key={i}>
              {it.role === 'user' ? (
                <div className="ask-msg user">{it.file && <span className="ask-file">📄 {it.file}</span>}{it.text}</div>
              ) : (
                <div className="ask-ai">
                  {it.text && <div className="ask-msg assistant"><Markdown text={it.text} /></div>}
                  {it.cards?.map((c, j) => <CardView key={j} card={c} state={state} openLoad={openLoad} />)}
                  {it.pending?.map((id) => {
                    const p = pending.get(id)
                    if (!p) return null
                    return (
                      <div key={id} className={`ask-action ${p.status}`}>
                        <span className="ask-action-t">{p.summary}</span>
                        {p.status === 'pending' ? (
                          <span className="ask-action-b">
                            <button className="ghost" disabled={busy} onClick={() => decide(id, false)}>Cancel</button>
                            <button className="primary" disabled={busy} onClick={() => decide(id, true)}>Confirm</button>
                          </span>
                        ) : <em>{p.status === 'done' ? '✓ Done' : p.status === 'failed' ? '⚠ Failed' : 'Cancelled'}</em>}
                      </div>
                    )
                  })}
                </div>
              )}
            </Fragment>
          ))}
          {busy && <div className="ask-msg assistant ask-busy" aria-label="Working"><i /><i /><i /><span>Working on your board…</span></div>}
          {err && <p className="ask-err">⚠ {err}</p>}
          <div ref={end} />
        </div>

        <form className="ld-foot ask-form" onSubmit={(e: FormEvent) => { e.preventDefault(); void send(q) }}>
          {file && <span className="ask-chip">📄 {file.name}<button type="button" aria-label="Remove file" onClick={() => setFile(null)}>×</button></span>}
          <div className="ask-compose">
            <button type="button" className="ask-clip" title="Attach a rate con, BOL or POD (PDF or photo)" aria-label="Attach a file" onClick={() => picker.current?.click()}>📎</button>
            <textarea ref={input} rows={2} value={q} placeholder={loadId ? 'Ask about this load, or anything on your board…' : 'e.g. Send invoices for everything delivered this week'}
              onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(q) } }} />
            <button className="primary" disabled={busy || (!q.trim() && !file)}>Send</button>
          </div>
          <input ref={picker} type="file" hidden accept="application/pdf,image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void attach(f); e.target.value = '' }} />
        </form>
      </aside>
    </div>
  )
}

/** Questions that fit the board right now (overdue invoices, loads to invoice, the open load…). */
function suggest(state: CrmState, loadId?: number | null): string[] {
  const out: string[] = []
  const l = loadId ? state.loads.find((x) => x.id === loadId) : undefined
  if (l) out.push('Summarize this load and check the broker', l.status === 'delivered' ? 'Send the invoice for this load' : 'What is the all-in RPM on this load?')
  const overdue = state.loads.filter((x) => x.status === 'invoiced' && x.invoicedOn && addDays(x.invoicedOn, 30) < today())
  if (overdue.length) out.push(`Which invoices are overdue and who owes the most? (${overdue.length})`)
  const toInvoice = state.loads.filter((x) => x.status === 'delivered' && !x.invoicedOn)
  if (toInvoice.length) out.push(`Send invoices for the ${toInvoice.length} delivered ${toInvoice.length === 1 ? 'load' : 'loads'}`)
  out.push('How did we do this week vs last week, per dispatcher?', 'Which brokers pay the best rate per mile this month?')
  if (state.trucks.length) out.push('Which truck had the most empty miles this month?')
  return out.slice(0, 5)
}

function CardView({ card, state, openLoad }: { card: AiCard; state: CrmState; openLoad: (id: number) => void }) {
  const [all, setAll] = useState(false)
  if (card.type === 'loads') {
    const loads = card.ids.map((id) => state.loads.find((l) => l.id === id)).filter((l): l is CrmState['loads'][number] => !!l)
    const shown = all ? loads : loads.slice(0, 6)
    return (
      <div className="ask-card">
        <div className="ask-card-h">{card.title}</div>
        {!loads.length ? <p className="ask-card-empty">No loads.</p> : (
          <ul className="ask-loads">
            {shown.map((l) => (
              <li key={l.id}>
                <button onClick={() => openLoad(l.id)}>
                  <span className={`dot st-${l.status}`} />
                  <span className="ask-l-main"><b>{l.broker || 'No broker'}</b><small>{place(l.origin) || '—'} → {place(l.destination) || '—'} · {shortDate(l.date)}</small></span>
                  <span className="ask-l-r"><b>{usd(gross(l))}</b><small>{STATUSES.find((s) => s.id === l.status)?.label}</small></span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {loads.length > 6 && <button className="w-link ask-more" onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show all ${loads.length}`}</button>}
      </div>
    )
  }
  if (card.type === 'table') {
    return (
      <div className="ask-card">
        <div className="ask-card-h">{card.title}</div>
        <div className="ask-table-wrap">
          <table className="ask-table">
            <thead><tr>{card.columns.map((c, i) => <th key={i} className={i ? 'num' : ''}>{c}</th>)}</tr></thead>
            <tbody>{card.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={j ? 'num' : ''}>{v}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </div>
    )
  }
  if (card.type === 'check') return <div className="ask-card"><CheckBadge check={card.check} details /></div>
  if (card.type === 'route') return <div className="ask-card ask-route">🗺 <b>{place(card.from)} → {place(card.to)}</b> · {card.miles.toLocaleString('en-US')} mi · ~{Math.round(card.hours)} h driving</div>
  if (card.type === 'link') return <div className="ask-card ask-route">🔗 {card.label}: <a href={card.url} target="_blank" rel="noopener">{card.url.replace(/^https?:\/\//, '')}</a> <button className="w-link" onClick={() => void navigator.clipboard.writeText(card.url)}>Copy</button></div>
  return <div className="ask-card ask-note">✓ {card.text}</div>
}

/** Just enough Markdown for chat answers: paragraphs, **bold**, `code`, lists, small tables, links. */
function Markdown({ text }: { text: string }) {
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
      blocks.push(<div key={i} className="ask-table-wrap"><table className="ask-table"><thead><tr>{rows[0]?.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead><tbody>{rows.slice(1).map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody></table></div>)
    } else if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line)
      const items: string[] = []
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, '')); i++ }
      i--
      blocks.push(ordered
        ? <ol key={i}>{items.map((x, j) => <li key={j}>{inline(x)}</li>)}</ol>
        : <ul key={i}>{items.map((x, j) => <li key={j}>{inline(x)}</li>)}</ul>)
    } else if (/^#{1,4}\s/.test(line)) {
      blocks.push(<p key={i} className="ask-h">{inline(line.replace(/^#+\s/, ''))}</p>)
    } else {
      blocks.push(<p key={i}>{inline(line)}</p>)
    }
  }
  return <>{blocks}</>
}
