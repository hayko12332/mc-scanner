import { useCallback, useEffect, useState } from 'react'
import { crm, hoursLeft, type InboxSettings, type InboxView, type PostingRow } from '../../lib/crm'

// Load alerts: the board's load-board alerts and brokers' load lists (sent to its HaulPanel address) as loads matched
// to its trucks. A good match can email the broker at once (autopilot) or with one click. Nothing logs in to a load
// board: the boards send these emails to the dispatcher themselves.

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}
const usd = (n: number) => `$${n.toLocaleString('en-US')}`
const day = (d: string) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '')

export function LoadAlertsView({ owner, toast, changed }: { owner: boolean; toast: (m: string) => void; changed: () => void }) {
  const [v, setV] = useState<InboxView | null>(null)
  const [err, setErr] = useState('')
  const [only, setOnly] = useState(true)
  const load = useCallback(() => crm.inbox().then((x) => { setV(x); setErr('') }, (e: Error) => setErr(e.message)), [])
  useEffect(() => {
    void load()
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 20_000)
    return () => clearInterval(t)
  }, [load])

  if (err && !v) return <p className="w-msg error">{err}</p>
  if (!v) return <p className="w-msg">Loading…</p>
  const open = v.postings.filter((p) => p.status !== 'dismissed')
  const shown = only ? open.filter((p) => p.fit.ok || p.status === 'emailed') : open
  const confirmations = v.messages.filter((m) => m.kind === 'forwarding_confirmation' && m.note)

  return (
    <div className="la">
      <header className="ig-head">
        <h1>Load alerts</h1>
        <p>Loads from your load-board alerts and brokers’ emails, matched to your trucks — the broker gets an email in one click{v.settings.autoEmail ? ', or right away by autopilot' : ''}.</p>
      </header>

      {confirmations.map((m) => (
        <div key={m.id} className="la-confirm">
          <b>Confirm forwarding</b> — {m.summary}. {/^https?:/.test(m.note) ? <a href={m.note} target="_blank" rel="noopener noreferrer">Open the confirmation link</a> : <>Code: <code>{m.note}</code></>}
        </div>
      ))}

      <Setup v={v} owner={owner} toast={toast} reload={load} />

      <section className="ig-sec">
        <div className="la-bar">
          <h2>Loads · last 3 days</h2>
          <label className="la-only"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> Only loads that fit my trucks</label>
        </div>
        {!shown.length ? (
          <p className="ig-muted la-empty">{open.length ? 'No load fits your rules right now — untick the box to see all of them.' : 'No loads yet. They appear here a few seconds after an alert email arrives.'}</p>
        ) : (
          <div className="la-list">
            {shown.map((p) => <PostingCard key={p.id} p={p} toast={toast} reload={load} changed={changed} />)}
          </div>
        )}
      </section>

      {v.messages.length > 0 && (
        <section className="ig-sec">
          <h2>Emails received</h2>
          <div className="ig-list">
            {v.messages.slice(0, 12).map((m) => (
              <div key={m.id} className="ig-row">
                <span><b>{m.summary || m.subject || '(no subject)'}</b><small>{m.from} · {ago(m.receivedAt)}{m.postings ? ` · ${m.postings} loads` : ''}{m.note && m.kind !== 'forwarding_confirmation' ? ` · ${m.note}` : ''}</small></span>
                <em className={`ig-badge ${m.kind === 'other' ? '' : 'ok'}`}>{({ load_postings: 'Loads', rate_confirmation: 'Rate con → load', forwarding_confirmation: 'Confirm forwarding', other: 'Skipped' } as Record<string, string>)[m.kind] ?? m.kind}</em>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function Setup({ v, owner, toast, reload }: { v: InboxView; owner: boolean; toast: (m: string) => void; reload: () => void }) {
  const [s, setS] = useState<InboxSettings>(v.settings)
  const [paste, setPaste] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(!v.postings.length)
  const save = (n: InboxSettings) => { setS(n); void crm.saveInbox(n).then(reload, (e: Error) => toast(e.message)) }
  const read = async () => {
    setBusy(true)
    try {
      const r = await crm.pasteEmail(paste)
      toast(r.kind === 'load_postings' ? `${r.postings} new ${r.postings === 1 ? 'load' : 'loads'} read` : r.kind === 'rate_confirmation' ? 'Rate con read — load added' : 'No loads found in that text')
      setPaste(''); reload()
    } catch (e) { toast((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="la-setup">
      <div className="ig-card">
        <div className="ig-top">
          <span><b>Your alerts address</b><small>Send load-board alerts and brokers’ load lists here. Rate cons sent here become loads.</small></span>
          <button className="w-link" onClick={() => setOpen((x) => !x)}>{open ? 'Hide steps' : 'How to set up'}</button>
        </div>
        {v.address ? (
          <div className="la-addr"><code>{v.address}</code><button onClick={() => void navigator.clipboard.writeText(v.address).then(() => toast('Address copied'))}>Copy</button></div>
        ) : <p className="ig-note">Your email address is being set up. Meanwhile, paste an alert or a load list below — it’s read the same way.</p>}
        {open && (
          <ol className="la-steps">
            <li><b>DAT One:</b> open a saved search and turn on email alerts; send them to this address (or to your email, then forward — step 3).</li>
            <li><b>123Loadboard:</b> Settings → Notifications → turn on email; then set <i>Alert: On</i> for each saved search.</li>
            <li><b>Gmail:</b> Settings → Forwarding → add this address (the confirmation code shows up on this page); then a filter — from your load board or brokers’ load lists → <i>Forward to</i> this address.</li>
            <li>One saved search per truck lane works best: origin area, destination, trailer type.</li>
          </ol>
        )}
        {owner && (
          <div className="la-paste">
            <textarea rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Or paste an alert email or a broker’s load list here…" />
            <button className="primary" disabled={busy || paste.trim().length < 20 || !v.ai} onClick={() => void read()}>{busy ? 'Reading…' : 'Read loads'}</button>
          </div>
        )}
      </div>

      <div className={`ig-card ${s.autoEmail ? 'on' : ''}`}>
        <div className="ig-top">
          <span><b>Autopilot</b><small>Emails the broker the moment a load fits — before other carriers do. Once per load, signed by you, replies come to you.</small></span>
          <label className="la-switch"><input type="checkbox" disabled={!owner} checked={s.autoEmail} onChange={(e) => save({ ...s, autoEmail: e.target.checked })} /><span>{s.autoEmail ? 'On' : 'Off'}</span></label>
        </div>
        <div className="la-rules">
          <label>At least <span>$<input type="number" step="0.05" min="0" disabled={!owner} value={s.minRpm} onChange={(e) => setS({ ...s, minRpm: Number(e.target.value) })} onBlur={() => save(s)} />/mi</span></label>
          <label>Empty miles to pickup up to <span><input type="number" step="10" min="0" disabled={!owner} value={s.maxDeadhead} onChange={(e) => setS({ ...s, maxDeadhead: Number(e.target.value) })} onBlur={() => save(s)} /> mi</span></label>
          <label>At most <span><input type="number" step="5" min="0" disabled={!owner} value={s.dailyCap} onChange={(e) => setS({ ...s, dailyCap: Number(e.target.value) })} onBlur={() => save(s)} /> emails a day</span></label>
        </div>
      </div>
    </div>
  )
}

function PostingCard({ p, toast, reload, changed }: { p: PostingRow; toast: (m: string) => void; reload: () => void; changed: () => void }) {
  const [draft, setDraft] = useState<{ to: string; subject: string; body: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const d = p.data, f = p.fit
  const openDraft = () => void crm.postingDraft(p.id).then(setDraft, (e: Error) => toast(e.message))
  const send = async () => {
    if (!draft) return
    setBusy(true)
    try { await crm.emailPosting(p.id, draft.subject, draft.body); toast(`Email sent to ${draft.to}`); setDraft(null); reload(); changed() } catch (e) { toast((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className={`la-card ${f.ok ? 'fit' : ''} ${p.status}`}>
      <div className="la-main">
        <div className="la-lane">
          <b>{d.origin || '?'} → {d.destination || '?'}</b>
          <small>{[day(d.pickup_date), d.equipment, d.weight_lbs ? `${Math.round(d.weight_lbs / 1000)}k lbs` : '', f.loadedMiles ? `${f.loadedMiles.toLocaleString('en-US')} mi` : '', d.notes].filter(Boolean).join(' · ')}</small>
        </div>
        <div className="la-rate">
          <b>{d.rate ? usd(d.rate) : 'No rate'}</b>
          <small>{f.rpm ? `$${f.rpm.toFixed(2)}/mi` : 'ask the broker'}</small>
        </div>
        <div className="la-broker">
          <b>{d.broker || 'Broker'}</b>
          <small>{[d.contact, d.ref && `ref ${d.ref}`].filter(Boolean).join(' · ') || '—'}</small>
        </div>
        <div className="la-truck">
          {f.best ? (<>
            <b>#{f.best.unit || '—'} {f.best.driver}</b>
            <small>~{f.best.deadhead} mi empty · {f.best.from}{f.best.driveLeftMin != null ? ` · ${hoursLeft(f.best.driveLeftMin)} drive left` : ''}</small>
          </>) : <small>No truck nearby</small>}
          {!f.ok && f.why && <small className="la-why">{f.why}</small>}
        </div>
        <div className="la-act">
          {p.status === 'emailed' ? <span className="la-sent">✓ Emailed{p.emailedAuto ? ' by autopilot' : ''}{p.emailedAt ? ` · ${ago(p.emailedAt)}` : ''}</span> : (
            <>
              {d.email && <button className={f.ok ? 'primary' : ''} onClick={openDraft}>Email broker</button>}
              {d.phone && <a className="btn" href={`tel:${d.phone.replace(/[^\d+]/g, '')}`}>Call {d.phone}</a>}
              <button className="ghost" title="Hide this load" onClick={() => void crm.dismissPosting(p.id).then(reload)}>✕</button>
            </>
          )}
        </div>
      </div>
      {draft && (
        <div className="iv-form la-draft">
          <small className="ig-muted">To {draft.to} · from your company via HaulPanel · replies come to you</small>
          <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} aria-label="Subject" />
          <textarea rows={8} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} aria-label="Message" />
          <div className="iv-actions">
            <button className="ghost" onClick={() => setDraft(null)}>Cancel</button>
            <button className="primary" disabled={busy} onClick={() => void send()}>{busy ? 'Sending…' : 'Send'}</button>
          </div>
        </div>
      )}
      <small className="la-time">{ago(p.createdAt)}</small>
    </div>
  )
}
