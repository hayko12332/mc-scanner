import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import {
  addDays, carrierFee, daysBetween, extras, feeLabel, fmtRpm, gross, LOAD_EXTRAS, overdueDays, PAY_TERMS_DAYS, rpm, shortDate, STATUSES, today, usd,
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

/** Where a truck finished its last load on or before a date: the start of the deadhead to the next pickup. */
function lastDrop(state: CrmState, truckId: number | null, date: string, exceptId?: number): Load | null {
  if (truckId == null) return null
  return state.loads
    .filter((l) => l.truckId === truckId && l.id !== exceptId && l.destination && l.date <= date)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)[0] ?? null
}

/** Distinct values, most recently used first: brokers and places for the form's suggestions. */
function recent(loads: Load[], pick: (l: Load) => string[]): string[] {
  const out = new Map<string, string>()
  for (const l of [...loads].sort((a, b) => b.date.localeCompare(a.date))) {
    for (const s of pick(l)) { const t = place(s.trim()); if (t && !out.has(t.toLowerCase())) out.set(t.toLowerCase(), t) }
  }
  return [...out.values()].slice(0, 300)
}

/** Looks up the miles between two places a moment after both are typed; `off` when the miles were typed by hand. */
function useAutoMiles(from: string, to: string, off: boolean, miles: (a: string, b: string) => Promise<MilesResult>, got: (n: number) => void) {
  const [busy, setBusy] = useState(false)
  const ok = from.trim().length > 2 && to.trim().length > 2
  const latest = useRef(got)
  latest.current = got
  useEffect(() => {
    if (!ok || off) return
    let stale = false
    const t = setTimeout(() => {
      setBusy(true)
      miles(from, to).then((r) => { if (!stale && r.miles) latest.current(r.miles) }, () => undefined)
        .finally(() => { if (!stale) setBusy(false) })
    }, 700)
    return () => { stale = true; clearTimeout(t); setBusy(false) }
  }, [from, to, ok, off, miles])
  return busy
}

type Draft = {
  date: string; broker: string; pro: string; origin: string; destination: string; loadedMiles: string; emptyMiles: string
  rate: string; carrierId: string; truckId: string; dispatcherId: string; notes: string
}

/**
 * New load as a form in the side panel, the way TMSs take a rate confirmation: broker and load #, lane and pickup date,
 * who hauls it, the rate. Brokers and cities are suggested from earlier loads, loaded miles and the deadhead from the
 * truck's last drop are calculated while you type, and RPM shows before you save.
 */
export function NewLoadDrawer({ state, defaults, add, close, miles }: {
  state: CrmState
  defaults: { carrierId: string; dispatcherId: string }
  add: (l: LoadInput) => Promise<unknown>
  close: () => void
  miles: (from: string, to: string) => Promise<MilesResult>
}) {
  const only = (xs: { id: number }[]) => (xs.length === 1 ? String(xs[0].id) : '')
  const blank = (keep?: Partial<Draft>): Draft => ({
    date: today(), broker: '', pro: '', origin: '', destination: '', loadedMiles: '', emptyMiles: '', rate: '', notes: '',
    carrierId: defaults.carrierId || only(state.carriers), truckId: '', dispatcherId: defaults.dispatcherId || only(state.dispatchers), ...keep,
  })
  const [v, setV] = useState<Draft>(() => blank())
  const [touched, setTouched] = useState({ loaded: false, empty: false })
  const [added, setAdded] = useState('')
  const [err, setErr] = useState('')
  const first = useRef<HTMLInputElement>(null)
  const set = (patch: Partial<Draft>) => { setV((x) => ({ ...x, ...patch })); setErr('') }

  useEffect(() => { first.current?.focus() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [close])

  const brokers = useMemo(() => recent(state.loads, (l) => [l.broker]), [state.loads])
  const places = useMemo(() => recent(state.loads, (l) => [l.origin, l.destination]), [state.loads])
  const trucks = state.trucks.filter((t) => !v.carrierId || String(t.carrierId) === v.carrierId)
  const truckId = v.truckId ? Number(v.truckId) : null
  const drop = lastDrop(state, truckId, v.date)

  // Miles fill themselves in a moment after both ends of the lane are typed (unless you typed the miles yourself).
  const busy = {
    loaded: useAutoMiles(v.origin, v.destination, touched.loaded, miles, (n) => setV((x) => ({ ...x, loadedMiles: String(n) }))),
    empty: useAutoMiles(drop?.destination ?? '', v.origin, touched.empty, miles, (n) => setV((x) => ({ ...x, emptyMiles: String(n) }))),
  }

  const carrier = state.carriers.find((c) => String(c.id) === v.carrierId)
  const dispatcher = state.dispatchers.find((d) => String(d.id) === v.dispatcherId)
  const rate = money(v.rate)
  const loaded = whole(v.loadedMiles)
  const emptyMi = whole(v.emptyMiles)
  const fee = carrier?.feeType === 'percent' ? (rate * carrier.fee) / 100 : null

  // The dispatcher who last worked this truck (or carrier) comes along, if none is chosen yet.
  const usualDispatcher = (match: (l: Load) => boolean) => {
    if (v.dispatcherId) return v.dispatcherId
    const last = state.loads.filter((l) => match(l) && l.dispatcherId != null).sort((a, b) => b.date.localeCompare(a.date))[0]
    return last ? String(last.dispatcherId) : ''
  }
  const pickCarrier = (id: string) => {
    const keepTruck = state.trucks.find((t) => String(t.id) === v.truckId && String(t.carrierId) === id)
    set({ carrierId: id, truckId: keepTruck ? v.truckId : '', dispatcherId: usualDispatcher((l) => String(l.carrierId) === id) })
  }
  const pickTruck = (id: string) => {
    const t = state.trucks.find((x) => String(x.id) === id)
    setTouched((x) => ({ ...x, empty: false }))
    set({
      truckId: id, emptyMiles: '', carrierId: t?.carrierId != null ? String(t.carrierId) : v.carrierId,
      dispatcherId: usualDispatcher((l) => String(l.truckId) === id),
    })
  }

  const submit = (again: boolean) => {
    if (!v.date) return setErr('Pick the pickup date')
    if (!v.broker.trim() && !rate) return setErr('Enter at least the broker or the rate')
    const load: LoadInput = {
      ...LOAD_EXTRAS,
      date: v.date, broker: v.broker.trim(), pro: v.pro.trim(), origin: v.origin.trim(), destination: v.destination.trim(),
      loadedMiles: loaded, emptyMiles: emptyMi, rate, notes: v.notes.trim(), status: 'booked',
      carrierId: v.carrierId ? Number(v.carrierId) : null, truckId, dispatcherId: v.dispatcherId ? Number(v.dispatcherId) : null,
    }
    const typed = v
    add(load).catch(() => { setV(typed); setAdded('') })
    if (!again) return close()
    setAdded(`Added ${load.broker || 'load'}${rate ? ` · ${usd(rate)}` : ''}`)
    setTouched({ loaded: false, empty: false })
    setV(blank({ date: v.date, carrierId: v.carrierId, dispatcherId: v.dispatcherId }))
    first.current?.focus()
  }
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); submit(e.shiftKey) }
  }

  const input = (k: keyof Draft, label: string, o: { placeholder?: string; list?: string; prefix?: string; suffix?: string; hint?: ReactNode; type?: string; numeric?: boolean; wide?: boolean; ref?: typeof first; onChange?: (s: string) => void } = {}) => (
    <label className={`ld-field ${o.wide ? 'wide' : ''}`}>
      <span>{label}</span>
      <div className="ld-input">
        {o.prefix && <i>{o.prefix}</i>}
        <input ref={o.ref} type={o.type ?? 'text'} inputMode={o.numeric ? 'decimal' : undefined} list={o.list} placeholder={o.placeholder}
          value={v[k]} onChange={(e) => (o.onChange ? o.onChange(e.target.value) : set({ [k]: e.target.value }))} autoComplete="off" />
        {o.suffix && <i>{o.suffix}</i>}
      </div>
      {o.hint && <small>{o.hint}</small>}
    </label>
  )

  return (
    <div className="ld-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <aside className="ld" role="dialog" aria-label="New load" onKeyDown={onKey}>
        <header className="ld-head">
          <div>
            <small>New load{added ? '' : ' · from the rate confirmation'}</small>
            <h2>{v.broker.trim() || 'New load'}</h2>
            <p>{place(v.origin) || 'Origin'} <span>→</span> {place(v.destination) || 'Destination'}</p>
            {added && <p className="ld-added">✓ {added}. Next one:</p>}
          </div>
          <button className="ld-x" aria-label="Close" onClick={close}>×</button>
        </header>

        <div className="ld-body">
          <section className="ld-sum">
            <div><span>Rate</span><b>{rate ? usd(rate) : '—'}</b></div>
            <div><span>RPM</span><b>{fmtRpm(rpm(rate, loaded))}</b></div>
            <div><span>All-in RPM</span><b>{fmtRpm(rpm(rate, loaded + emptyMi))}</b></div>
            <div><span>{dispatcher ? `${dispatcher.name}’s pay` : 'Dispatch fee'}</span>
              <b>{dispatcher ? usd(Math.round((rate * dispatcher.percent) / 100)) : fee != null ? usd(Math.round(fee)) : '—'}</b></div>
          </section>

          <section>
            <h3>Load</h3>
            <div className="ld-grid">
              {input('broker', 'Broker', { placeholder: 'C.H. Robinson', list: 'nl-brokers', ref: first })}
              {input('pro', 'Load # / PRO#', { placeholder: 'From the rate con' })}
              {input('rate', 'Rate', { prefix: '$', numeric: true, placeholder: '0' })}
              {input('date', 'Pickup date', { type: 'date' })}
            </div>
          </section>

          <section>
            <h3>Lane</h3>
            <div className="ld-grid">
              {input('origin', 'Pickup', { placeholder: 'City, ST', list: 'nl-places' })}
              {input('destination', 'Delivery', { placeholder: 'City, ST', list: 'nl-places' })}
              {input('loadedMiles', 'Loaded miles', {
                numeric: true, suffix: 'mi', placeholder: busy.loaded ? 'calculating…' : 'auto',
                hint: busy.loaded ? 'Calculating from the map…' : touched.loaded ? undefined : 'Filled from the map; type to change',
                onChange: (s) => { setTouched((x) => ({ ...x, loaded: s !== '' })); set({ loadedMiles: s }) },
              })}
              {input('emptyMiles', 'Empty miles (deadhead)', {
                numeric: true, suffix: 'mi', placeholder: busy.empty ? 'calculating…' : '0',
                hint: drop ? `From ${place(drop.destination)}, the truck’s last drop (${shortDate(drop.date)})` : 'Pick a truck to calculate it',
                onChange: (s) => { setTouched((x) => ({ ...x, empty: s !== '' })); set({ emptyMiles: s }) },
              })}
            </div>
          </section>

          <section>
            <h3>Who hauls it</h3>
            <div className="ld-grid">
              <label className="ld-field">
                <span>Carrier</span>
                <div className="ld-input">
                  <select value={v.carrierId} onChange={(e) => pickCarrier(e.target.value)}>
                    <option value="">—</option>
                    {state.carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                {!state.carriers.length && <small>Add carriers in the Carriers tab</small>}
              </label>
              <label className="ld-field">
                <span>Truck / driver</span>
                <div className="ld-input">
                  <select value={v.truckId} onChange={(e) => pickTruck(e.target.value)}>
                    <option value="">—</option>
                    {trucks.map((t) => <option key={t.id} value={t.id}>{[t.unit && `#${t.unit}`, t.driver].filter(Boolean).join(' · ')}</option>)}
                  </select>
                </div>
                {drop && <small>Last drop: {place(drop.destination)}, {shortDate(drop.date)}</small>}
              </label>
              <label className="ld-field">
                <span>Dispatcher</span>
                <div className="ld-input">
                  <select value={v.dispatcherId} onChange={(e) => set({ dispatcherId: e.target.value })}>
                    <option value="">—</option>
                    {state.dispatchers.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.percent}%</option>)}
                  </select>
                </div>
              </label>
              {input('notes', 'Notes', { placeholder: 'Appointment, reference, contact…' })}
            </div>
          </section>
          {err && <p className="ld-note bad">{err}</p>}
        </div>

        <footer className="ld-foot">
          <button className="ghost" onClick={close}>Cancel</button>
          <span className="ld-foot-r">
            <button className="ghost" onClick={() => submit(true)} title="Shift + Enter">Add &amp; next</button>
            <button className="primary" onClick={() => submit(false)} title="Enter">Add load</button>
          </span>
        </footer>
        <datalist id="nl-brokers">{brokers.map((b) => <option key={b} value={b} />)}</datalist>
        <datalist id="nl-places">{places.map((p) => <option key={p} value={p} />)}</datalist>
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
