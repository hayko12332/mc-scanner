import { useState, type FormEvent } from 'react'
import { api } from '../../api'
import { addDays, today, usd, weekStart, type CarrierInput, type CrmState, type Dispatcher } from '../../lib/crm'
import { formatPhone } from '../../lib/format'
import { Icon } from '../Icon'

const blankCarrier: CarrierInput = { name: '', mc: '', dot: '', phone: '', email: '', notes: '' }

function grossBy(state: CrmState, key: 'carrierId' | 'dispatcherId', id: number) {
  const week = weekStart(today())
  const month = today().slice(0, 7)
  let w = 0, m = 0
  for (const l of state.loads) {
    if (l[key] !== id) continue
    if (l.date >= week && l.date <= addDays(week, 6)) w += l.rate
    if (l.date.startsWith(month)) m += l.rate
  }
  return { week: w, month: m }
}

/** Carriers the dispatcher works for: add by MC (filled from FMCSA) or by hand. */
export function CarriersView({ state, add, remove }: {
  state: CrmState
  add: (c: CarrierInput) => Promise<unknown>
  remove: (id: number) => Promise<unknown>
}) {
  const [v, setV] = useState<CarrierInput>(blankCarrier)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const set = (k: keyof CarrierInput, value: string) => setV((x) => ({ ...x, [k]: value }))

  const fill = async () => {
    const mc = v.mc.replace(/\D/g, '')
    if (!mc) return setNote('Enter an MC number first')
    setNote('Looking up MC…')
    try {
      const r = await api.lookup(mc, 'mc')
      const c = r.profiles[0]
      if (!c) return setNote('No carrier found for this MC')
      setV((x) => ({ ...x, name: c.legalName, dot: c.dot, phone: formatPhone(c.phone || c.cellPhone), email: c.email }))
      setNote('Filled from FMCSA')
    } catch (e) {
      setNote((e as Error).message)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await add(v)
      setV(blankCarrier)
      setNote('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="panel crm-add">
        <h3>Add a carrier</h3>
        <form className="carrier-form" onSubmit={submit}>
          <label><span>MC</span>
            <div className="mc-fill">
              <input placeholder="MC number" value={v.mc} onChange={(e) => set('mc', e.target.value)} />
              <button type="button" onClick={fill}><Icon name="search" size={14} />Fill from FMCSA</button>
            </div>
          </label>
          <label><span>Name</span><input required placeholder="Carrier or truck name" value={v.name} onChange={(e) => set('name', e.target.value)} /></label>
          <label><span>USDOT</span><input value={v.dot} onChange={(e) => set('dot', e.target.value)} /></label>
          <label><span>Phone</span><input value={v.phone} onChange={(e) => set('phone', e.target.value)} /></label>
          <label><span>Email</span><input type="email" value={v.email} onChange={(e) => set('email', e.target.value)} /></label>
          <div className="lf-actions"><button className="primary" disabled={busy}><Icon name="check" size={15} />Add carrier</button></div>
        </form>
        {note && <p className="muted small-text">{note}</p>}
      </div>
      <div className="panel crm-list">
        {!state.carriers.length && <p className="muted">No carriers yet. Each carrier works like a tab of your spreadsheet.</p>}
        {state.carriers.map((c) => {
          const g = grossBy(state, 'carrierId', c.id)
          return (
            <div key={c.id} className="crm-item">
              <div><b>{c.name}</b><small>{[c.mc && `MC-${c.mc.replace(/\D/g, '')}`, c.dot && `USDOT ${c.dot}`, c.phone, c.email].filter(Boolean).join(' · ') || '—'}</small></div>
              <div className="crm-item-nums"><span>This week <b>{usd(g.week)}</b></span><span>Month <b>{usd(g.month)}</b></span></div>
              <button className="icon-btn" title="Remove" aria-label={`Remove ${c.name}`}
                onClick={() => confirm(`Remove ${c.name}? Their loads stay in the journal.`) && remove(c.id)}>×</button>
            </div>
          )
        })}
      </div>
    </>
  )
}

function DispatcherRow({ d, state, save, remove }: {
  d: Dispatcher; state: CrmState; save: (d: Dispatcher) => Promise<unknown>; remove: (id: number) => Promise<unknown>
}) {
  const [name, setName] = useState(d.name)
  const [percent, setPercent] = useState(String(d.percent))
  const g = grossBy(state, 'dispatcherId', d.id)
  const changed = name !== d.name || Number(percent) !== d.percent
  const p = Number(percent) || 0
  return (
    <div className="crm-item">
      <div className="disp-edit">
        <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <span className="pct"><input aria-label="Percent" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} />%</span>
        {changed && <button className="primary" onClick={() => save({ id: d.id, name: name.trim() || d.name, percent: p })}>Save</button>}
      </div>
      <div className="crm-item-nums">
        <span>Booked this week <b>{usd(g.week)}</b></span>
        <span>Pay this week <b>{usd(Math.round((g.week * d.percent) / 100))}</b></span>
        <span>Pay this month <b>{usd(Math.round((g.month * d.percent) / 100))}</b></span>
      </div>
      <button className="icon-btn" title="Remove" aria-label={`Remove ${d.name}`}
        onClick={() => confirm(`Remove ${d.name}? Their loads stay in the journal.`) && remove(d.id)}>×</button>
    </div>
  )
}

/** Dispatchers (the BB column) and the percent each one earns. */
export function DispatchersView({ state, add, save, remove }: {
  state: CrmState
  add: (d: Omit<Dispatcher, 'id'>) => Promise<unknown>
  save: (d: Dispatcher) => Promise<unknown>
  remove: (id: number) => Promise<unknown>
}) {
  const [name, setName] = useState('')
  const [percent, setPercent] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    await add({ name: name.trim(), percent: Number(percent) || 0 })
    setName('')
    setPercent('')
  }
  return (
    <>
      <div className="panel crm-add">
        <h3>Add a dispatcher</h3>
        <form className="carrier-form" onSubmit={submit}>
          <label><span>Name</span><input required placeholder="e.g. Sergo" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label><span>Percent of each load</span><input inputMode="decimal" placeholder="e.g. 5" value={percent} onChange={(e) => setPercent(e.target.value)} /></label>
          <div className="lf-actions"><button className="primary"><Icon name="check" size={15} />Add dispatcher</button></div>
        </form>
      </div>
      <div className="panel crm-list">
        {!state.dispatchers.length && <p className="muted">No dispatchers yet. Each one gets their own percent of the loads they book.</p>}
        {state.dispatchers.map((d) => <DispatcherRow key={`${d.id}:${d.name}:${d.percent}`} d={d} state={state} save={save} remove={remove} />)}
      </div>
    </>
  )
}
