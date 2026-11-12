import { useEffect, useState, type ReactNode } from 'react'
import {
  addDays, carrierFee, daysBetween, extras, feeLabel, fmtRpm, gross, overdueDays, PAY_TERMS_DAYS, rpm, shortDate, STATUSES, today, usd,
  withStatusDates, type CrmState, type Load, type LoadInput, type LoadStatus, type MilesResult,
} from '../../lib/crm'
import { place } from './LoadsTable'

const money = (s: string) => Math.max(0, Number(s.replace(/[$,\s]/g, '')) || 0)
const whole = (s: string) => Math.max(0, Math.round(Number(s.replace(/[,\s]/g, '')) || 0))

/** An input that keeps what you type and saves when you leave it (or press Enter). */
function Field({ label, value, onSave, type = 'text', prefix, suffix, hint, placeholder, wide, action }: {
  label: string; value: string; onSave: (v: string) => void; type?: 'text' | 'date' | 'number'
  prefix?: string; suffix?: string; hint?: ReactNode; placeholder?: string; wide?: boolean; action?: ReactNode
}) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const commit = () => { if (v.trim() !== value) onSave(v.trim()) }
  return (
    <label className={`ld-field ${wide ? 'wide' : ''}`}>
      <span>{label}</span>
      <div className="ld-input">
        {prefix && <i>{prefix}</i>}
        <input type={type === 'number' ? 'text' : type} inputMode={type === 'number' ? 'decimal' : undefined} value={v} placeholder={placeholder}
          onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
        {suffix && <i>{suffix}</i>}
        {action}
      </div>
      {hint && <small>{hint}</small>}
    </label>
  )
}

function Pick({ label, value, options, onSave }: { label: string; value: string; options: [string, string][]; onSave: (v: string) => void }) {
  return (
    <label className="ld-field">
      <span>{label}</span>
      <div className="ld-input"><select value={value} onChange={(e) => onSave(e.target.value)}>{options.map(([id, t]) => <option key={id} value={id}>{t}</option>)}</select></div>
    </label>
  )
}

/**
 * Everything about one load in a side panel: the trip (truck, lane, loaded and empty miles), the pay
 * (rate, accessorials, gross, RPM, dispatch fee) and billing (invoice and payment dates against 30-day terms).
 */
export function LoadDrawer({ load, state, save, remove, close, miles }: {
  load: Load
  state: CrmState
  save: (l: LoadInput) => void
  remove: () => void
  close: () => void
  miles: (from: string, to: string) => Promise<MilesResult>
}) {
  const [busy, setBusy] = useState<'' | 'loaded' | 'empty'>('')
  const [note, setNote] = useState('')
  const set = (patch: Partial<LoadInput>) => save({ ...load, ...patch })
  const carrier = state.carriers.find((c) => c.id === load.carrierId)
  const truck = state.trucks.find((t) => t.id === load.truckId)
  const dispatcher = state.dispatchers.find((d) => d.id === load.dispatcherId)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [close])
  useEffect(() => setNote(''), [load.id])

  // Deadhead: from where this truck delivered its previous load to this pickup.
  const previous = load.truckId == null ? null : state.loads
    .filter((l) => l.truckId === load.truckId && l.id !== load.id && l.destination && (l.date < load.date || (l.date === load.date && l.id < load.id)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)[0] ?? null

  const calc = async (kind: 'loaded' | 'empty') => {
    const [from, to] = kind === 'loaded' ? [load.origin, load.destination] : [previous?.destination ?? '', load.origin]
    if (!from || !to) return setNote(kind === 'loaded' ? 'Enter origin and destination first' : 'Assign a truck with an earlier load first')
    setBusy(kind)
    setNote('')
    try {
      const r = await miles(from, to)
      set(kind === 'loaded' ? { loadedMiles: r.miles } : { emptyMiles: r.miles })
      if (r.estimate) setNote('Estimated from a straight line — the map router is busy; check the miles.')
    } catch (e) {
      setNote((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  const g = gross(load)
  const fee = carrier?.feeType === 'percent' ? carrierFee(carrier, [load]) : null
  const pay = dispatcher ? (g * dispatcher.percent) / 100 : 0
  const late = overdueDays(load)
  const due = load.invoicedOn ? addDays(load.invoicedOn, PAY_TERMS_DAYS) : null
  const billing = load.paidOn && load.invoicedOn
    ? <span className="ok">Paid {daysBetween(load.invoicedOn, load.paidOn)} days after the invoice</span>
    : late > 0 ? <span className="bad">{late} days overdue — due {shortDate(due!)}</span>
      : due ? <span>Due {shortDate(due)} · net {PAY_TERMS_DAYS}</span>
        : <span>Mark it invoiced when you send the invoice — the 30-day clock starts then.</span>

  return (
    <div className="ld-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <aside className="ld" role="dialog" aria-label="Load details">
        <header className="ld-head">
          <div>
            <small>{shortDate(load.date)}{load.pro ? ` · PRO# ${load.pro}` : ''}</small>
            <h2>{load.broker || 'Load'}</h2>
            <p>{place(load.origin) || '—'} <span>→</span> {place(load.destination) || '—'}</p>
          </div>
          <button className="ld-x" aria-label="Close" onClick={close}>×</button>
        </header>

        <div className="ld-body">
          <section className="ld-sum">
            <div><span>Gross</span><b>{usd(g)}</b></div>
            <div><span>RPM</span><b>{fmtRpm(rpm(g, load.loadedMiles))}</b></div>
            <div><span>All-in RPM</span><b>{fmtRpm(rpm(g, load.loadedMiles + load.emptyMiles))}</b></div>
            <div><span>Dispatch fee</span><b>{fee != null ? usd(Math.round(fee * 100) / 100) : carrier?.feeType === 'flat' ? 'Weekly' : '—'}</b></div>
          </section>

          <section>
            <h3>Trip</h3>
            <div className="ld-grid">
              <Field label="Date" type="date" value={load.date} onSave={(v) => v && set({ date: v })} />
              <Pick label="Status" value={load.status} onSave={(v) => set(withStatusDates(load, v as LoadStatus))}
                options={STATUSES.map((s): [string, string] => [s.id, s.label])} />
              <Pick label="Carrier" value={String(load.carrierId ?? '')}
                onSave={(v) => set({ carrierId: v ? Number(v) : null, truckId: truck && String(truck.carrierId) !== v ? null : load.truckId })}
                options={[['', '—'], ...state.carriers.map((c): [string, string] => [String(c.id), c.name])]} />
              <Pick label="Truck / driver" value={String(load.truckId ?? '')}
                onSave={(v) => { const t = state.trucks.find((x) => String(x.id) === v); set({ truckId: t?.id ?? null, carrierId: t?.carrierId ?? load.carrierId }) }}
                options={[['', '—'], ...state.trucks.filter((t) => load.carrierId == null || t.carrierId === load.carrierId || t.id === load.truckId)
                  .map((t): [string, string] => [String(t.id), [t.unit && `#${t.unit}`, t.driver].filter(Boolean).join(' · ')])]} />
              <Field label="Broker" value={load.broker} onSave={(v) => set({ broker: v })} />
              <Field label="PRO# / load #" value={load.pro} onSave={(v) => set({ pro: v })} />
              <Field label="Origin" value={load.origin} placeholder="City, ST" onSave={(v) => set({ origin: v, loadedMiles: 0 })} />
              <Field label="Destination" value={load.destination} placeholder="City, ST" onSave={(v) => set({ destination: v, loadedMiles: 0 })} />
              <Field label="Loaded miles" type="number" value={load.loadedMiles ? String(load.loadedMiles) : ''} suffix="mi" placeholder="0"
                onSave={(v) => set({ loadedMiles: whole(v) })}
                action={<button type="button" className="ld-calc" disabled={busy !== ''} onClick={() => void calc('loaded')}>{busy === 'loaded' ? '…' : 'Calculate'}</button>} />
              <Field label="Empty miles (deadhead)" type="number" value={load.emptyMiles ? String(load.emptyMiles) : ''} suffix="mi" placeholder="0"
                onSave={(v) => set({ emptyMiles: whole(v) })}
                hint={previous ? `From ${place(previous.destination)} — where this truck delivered on ${shortDate(previous.date)}` : undefined}
                action={previous ? <button type="button" className="ld-calc" disabled={busy !== ''} onClick={() => void calc('empty')}>{busy === 'empty' ? '…' : 'Calculate'}</button> : undefined} />
            </div>
            {note && <p className="ld-note">{note}</p>}
          </section>

          <section>
            <h3>Pay</h3>
            <div className="ld-grid three">
              <Field label="Linehaul rate" type="number" prefix="$" value={String(load.rate || '')} placeholder="0" onSave={(v) => set({ rate: money(v) })} />
              <Field label="Detention" type="number" prefix="$" value={load.detention ? String(load.detention) : ''} placeholder="0" onSave={(v) => set({ detention: money(v) })} />
              <Field label="Layover" type="number" prefix="$" value={load.layover ? String(load.layover) : ''} placeholder="0" onSave={(v) => set({ layover: money(v) })} />
              <Field label="TONU" type="number" prefix="$" value={load.tonu ? String(load.tonu) : ''} placeholder="0" onSave={(v) => set({ tonu: money(v) })} />
              <Field label="Other" type="number" prefix="$" value={load.other ? String(load.other) : ''} placeholder="0" onSave={(v) => set({ other: money(v) })} />
              <Field label="Lumper (reimbursed)" type="number" prefix="$" value={load.lumper ? String(load.lumper) : ''} placeholder="0" onSave={(v) => set({ lumper: money(v) })} />
            </div>
            <dl className="ld-math">
              <div><dt>Rate {extras(load) ? `+ accessorials ${usd(extras(load))}` : ''}</dt><dd>{usd(g)} gross</dd></div>
              {load.lumper > 0 && <div><dt>Lumper — paid back to the carrier, not in gross</dt><dd>{usd(load.lumper)}</dd></div>}
              <div><dt>Dispatch fee · {feeLabel(carrier)}</dt><dd>{fee != null ? usd(Math.round(fee * 100) / 100) : carrier?.feeType === 'flat' ? 'on the weekly statement' : '—'}</dd></div>
              <div><dt>{dispatcher ? `${dispatcher.name}’s pay · ${dispatcher.percent}%` : 'Dispatcher pay'}</dt><dd>{dispatcher ? usd(Math.round(pay * 100) / 100) : '—'}</dd></div>
            </dl>
          </section>

          <section>
            <h3>Billing</h3>
            <div className="ld-grid">
              <Field label="Invoiced on" type="date" value={load.invoicedOn ?? ''}
                onSave={(v) => set(v ? { invoicedOn: v, status: load.status === 'paid' ? 'paid' : 'invoiced' } : { invoicedOn: null })} />
              <Field label="Paid on" type="date" value={load.paidOn ?? ''}
                onSave={(v) => set(v ? { paidOn: v, invoicedOn: load.invoicedOn ?? v, status: 'paid' } : { paidOn: null })} />
            </div>
            <p className="ld-billing">{billing}</p>
            {carrier?.factoring && <p className="ld-billing">Factoring: <b>{carrier.factoring}</b></p>}
            {!load.paidOn && (
              <div className="ld-quick">
                {!load.invoicedOn && <button onClick={() => set(withStatusDates(load, 'invoiced'))}>Invoiced today</button>}
                <button onClick={() => set(withStatusDates(load, 'paid', today()))}>Paid today</button>
              </div>
            )}
          </section>

          <section>
            <h3>Notes</h3>
            <NotesBox value={load.notes} onSave={(v) => set({ notes: v })} />
          </section>
        </div>

        <footer className="ld-foot">
          <button className="ld-del" onClick={() => { if (confirm('Delete this load?')) remove() }}>Delete load</button>
          <button className="primary" onClick={close}>Done</button>
        </footer>
      </aside>
    </div>
  )
}

function NotesBox({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <textarea className="ld-notes" rows={3} placeholder="Appointment, contact at the shipper, anything to remember…" value={v}
      onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== value) onSave(v) }} />
  )
}
