import { useState, type FormEvent } from 'react'
import { api } from '../../api'
import { addDays, today, usd, weekStart, type CarrierInput, type CrmCarrier, type CrmState, type Dispatcher } from '../../lib/crm'
import { formatPhone } from '../../lib/format'
import { Icon } from '../Icon'
import { EditText } from './LoadsTable'

const blankCarrier: CarrierInput = { name: '', mc: '', dot: '', phone: '', email: '', notes: '', feeType: 'percent', fee: 0, factoring: '' }

/** Loads and gross this week and this month for one carrier or dispatcher. */
function totals(state: CrmState, key: 'carrierId' | 'dispatcherId', id: number) {
  const week = weekStart(today())
  const weekEnd = addDays(week, 6)
  const month = today().slice(0, 7)
  let week$ = 0, weekLoads = 0, month$ = 0, all = 0
  for (const l of state.loads) {
    if (l[key] !== id) continue
    all++
    if (l.date >= week && l.date <= weekEnd) { week$ += l.rate; weekLoads++ }
    if (l.date.startsWith(month)) month$ += l.rate
  }
  return { week: week$, weekLoads, month: month$, all }
}

const RemoveButton = ({ name, onRemove }: { name: string; onRemove: () => void }) => (
  <button className="row-del" title="Remove" aria-label={`Remove ${name}`}
    onClick={() => confirm(`Remove ${name}? Their loads stay in the journal.`) && onRemove()}>×</button>
)

/** Carriers the dispatcher works for: add by MC (filled from FMCSA) or by hand; every cell edits in place. */
export function CarriersView({ state, add, update, remove }: {
  state: CrmState
  add: (c: CarrierInput) => Promise<unknown>
  update: (c: CrmCarrier) => Promise<unknown>
  remove: (id: number) => Promise<unknown>
}) {
  const [v, setV] = useState<CarrierInput>(blankCarrier)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const set = (k: keyof CarrierInput, value: string) => setV((x) => ({ ...x, [k]: value }))
  const save = (c: CrmCarrier, patch: Partial<CarrierInput>) => { update({ ...c, ...patch }).catch(() => undefined) }

  const fill = async () => {
    const mc = v.mc.replace(/\D/g, '')
    if (!mc) return setNote('Enter an MC number first')
    setNote('Looking up MC…')
    try {
      const r = await api.lookup(mc, 'mc')
      const c = r.profiles[0]
      if (!c) return setNote('No carrier found for this MC')
      setV((x) => ({ ...x, name: c.legalName, dot: c.dot, phone: formatPhone(c.phone || c.cellPhone), email: c.email }))
      setNote('Filled from FMCSA — check and press Add')
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

  const rows = state.carriers.map((c) => ({ c, t: totals(state, 'carrierId', c.id) }))
  const sum = (k: 'week' | 'month') => rows.reduce((s, r) => s + r.t[k], 0)

  return (
    <div className="lt">
      <form className="pv-add" onSubmit={submit}>
        <b>Add carrier</b>
        <input className="w-mc" placeholder="MC number" aria-label="MC" value={v.mc} onChange={(e) => set('mc', e.target.value)} />
        <button type="button" className="ghost" onClick={fill}><Icon name="search" size={14} />Fill from FMCSA</button>
        <input className="w-grow" required placeholder="Carrier name" aria-label="Name" value={v.name} onChange={(e) => set('name', e.target.value)} />
        <input placeholder="USDOT" aria-label="USDOT" value={v.dot} onChange={(e) => set('dot', e.target.value)} />
        <input placeholder="Phone" aria-label="Phone" value={v.phone} onChange={(e) => set('phone', e.target.value)} />
        <input className="w-grow" type="email" placeholder="Email" aria-label="Email" value={v.email} onChange={(e) => set('email', e.target.value)} />
        <button className="primary" disabled={busy}>+ Add carrier</button>
      </form>
      {note && <p className="pv-note">{note}</p>}

      <div className="lt-scroll">
        <table className="lt-table pv-table">
          <colgroup>
            <col /><col style={{ width: '12%' }} /><col style={{ width: '10%' }} /><col style={{ width: '13%' }} />
            <col style={{ width: '19%' }} /><col style={{ width: '8%' }} /><col style={{ width: '9%' }} /><col style={{ width: '9%' }} /><col style={{ width: '48px' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Carrier</th><th>MC</th><th>USDOT</th><th>Phone</th><th>Email</th>
              <th className="num">Loads</th><th className="num">This week</th><th className="num">This month</th><th />
            </tr>
          </thead>
          <tbody>
            {!rows.length && <tr className="lt-empty"><td colSpan={9}>No carriers yet. Add one by MC above — each carrier works like a tab of your spreadsheet.</td></tr>}
            {rows.map(({ c, t }) => (
              <tr key={c.id} className="lt-row">
                <td className="pv-name"><EditText value={c.name} onSave={(x) => x && save(c, { name: x })} /></td>
                <td className="pv-muted"><EditText value={c.mc} display={c.mc.replace(/\D/g, '') || undefined} onSave={(x) => save(c, { mc: x })} /></td>
                <td className="pv-muted"><EditText value={c.dot} onSave={(x) => save(c, { dot: x })} /></td>
                <td><EditText value={c.phone} onSave={(x) => save(c, { phone: x })} /></td>
                <td><EditText value={c.email} onSave={(x) => save(c, { email: x })} /></td>
                <td className="num">{t.all}</td>
                <td className="num">{usd(t.week)}</td>
                <td className="num strong">{usd(t.month)}</td>
                <td className="c-del"><RemoveButton name={c.name} onRemove={() => void remove(c.id)} /></td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={5}>{rows.length} {rows.length === 1 ? 'carrier' : 'carriers'}</td>
                <td className="num">{rows.reduce((s, r) => s + r.t.all, 0)}</td>
                <td className="num">{usd(sum('week'))}</td>
                <td className="num wk-gross">{usd(sum('month'))}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

/** Dispatchers (the BB column) and the percent each one earns; name and percent edit in place. */
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
  const update = (d: Dispatcher, patch: Partial<Dispatcher>) => { save({ ...d, ...patch }).catch(() => undefined) }

  const rows = state.dispatchers.map((d) => {
    const t = totals(state, 'dispatcherId', d.id)
    return { d, t, payWeek: (t.week * d.percent) / 100, payMonth: (t.month * d.percent) / 100 }
  })
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0)

  return (
    <div className="lt">
      <form className="pv-add" onSubmit={submit}>
        <b>Add dispatcher</b>
        <input className="w-grow" required placeholder="Name, e.g. Sergo" aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="pv-pct"><input inputMode="decimal" placeholder="5" aria-label="Percent of each load" value={percent} onChange={(e) => setPercent(e.target.value)} /><span>% of each load</span></label>
        <button className="primary">+ Add dispatcher</button>
      </form>

      <div className="lt-scroll">
        <table className="lt-table pv-table">
          <colgroup>
            <col /><col style={{ width: '10%' }} /><col style={{ width: '12%' }} /><col style={{ width: '14%' }} />
            <col style={{ width: '13%' }} /><col style={{ width: '13%' }} /><col style={{ width: '48px' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Dispatcher</th><th className="num">Percent</th><th className="num">Loads this week</th><th className="num">Booked this week</th>
              <th className="num">Pay this week</th><th className="num">Pay this month</th><th />
            </tr>
          </thead>
          <tbody>
            {!rows.length && <tr className="lt-empty"><td colSpan={7}>No dispatchers yet. Each one gets their own percent of the loads they book.</td></tr>}
            {rows.map(({ d, t, payWeek, payMonth }) => (
              <tr key={d.id} className="lt-row">
                <td className="pv-name"><EditText value={d.name} onSave={(x) => x && update(d, { name: x })} /></td>
                <td className="num-edit"><EditText align="right" value={String(d.percent)} display={`${d.percent}%`} onSave={(x) => update(d, { percent: Number(x.replace(/[%\s]/g, '')) || 0 })} /></td>
                <td className="num">{t.weekLoads}</td>
                <td className="num">{usd(t.week)}</td>
                <td className="num strong">{usd(Math.round(payWeek))}</td>
                <td className="num">{usd(Math.round(payMonth))}</td>
                <td className="c-del"><RemoveButton name={d.name} onRemove={() => void remove(d.id)} /></td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={2}>{rows.length} {rows.length === 1 ? 'dispatcher' : 'dispatchers'}</td>
                <td className="num">{sum((r) => r.t.weekLoads)}</td>
                <td className="num">{usd(sum((r) => r.t.week))}</td>
                <td className="num wk-gross">{usd(Math.round(sum((r) => r.payWeek)))}</td>
                <td className="num">{usd(Math.round(sum((r) => r.payMonth)))}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
