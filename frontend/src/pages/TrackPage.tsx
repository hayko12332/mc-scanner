import { useEffect, useState } from 'react'
import { TrackMap, hoursText } from '../components/crm/MapView'
import { place } from '../components/crm/LoadsTable'
import { crm, shortDate, type TrackingView } from '../lib/crm'

const STEPS = [['booked', 'Booked'], ['in_transit', 'In transit'], ['delivered', 'Delivered']] as const

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`
}
const miles = (a: [number, number], b: [number, number]) => {
  const r = (d: number) => (d * Math.PI) / 180
  const h = Math.sin(r(b[1] - a[1]) / 2) ** 2 + Math.cos(r(a[1])) * Math.cos(r(b[1])) * Math.sin(r(b[0] - a[0]) / 2) ** 2
  return 2 * 3958.8 * Math.asin(Math.sqrt(h))
}

/**
 * The page a dispatcher sends to the broker (#/track/<token>): where the truck is on the lane and the load's status.
 * No rates, no money, nothing else of the board. Refreshes every minute.
 */
export function TrackPage({ token }: { token: string }) {
  const [t, setT] = useState<TrackingView | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let live = true
    const load = () => crm.track(token).then((x) => { if (live) { setT(x); setErr('') } }, (e: Error) => { if (live) setErr(e.message) })
    void load()
    const id = setInterval(load, 60_000)
    return () => { live = false; clearInterval(id) }
  }, [token])

  const step = t ? Math.max(0, STEPS.findIndex(([s]) => s === t.status)) : 0
  const done = t && ['delivered', 'invoiced', 'paid'].includes(t.status)
  const truck = t?.position ? [t.position.lon, t.position.lat] as [number, number] : null
  // Miles left: straight line from the truck to the delivery × 1.2 (roads), at ~50 mph with stops.
  const left = truck && t?.lane && !done ? Math.round(miles(truck, t.lane.b) * 1.2) : null

  return (
    <div className="work theme-light tk">
      <header className="tk-top">
        <a href="https://haulpanel.com" className="w-brand"><img src="/logo.svg" alt="" width="22" height="22" /><b>HaulPanel</b></a>
        <span>Shipment tracking</span>
      </header>
      {err && !t && <p className="tk-msg">{err}</p>}
      {!t && !err && <p className="tk-msg">Loading…</p>}
      {t && (
        <main className="tk-main">
          <section className="tk-card">
            <small>{t.company ? `Hauled by ${t.company}` : 'Shipment'}{t.pro ? ` · Load #${t.pro}` : ''}</small>
            <h1>{place(t.origin) || '—'} <span>→</span> {place(t.destination) || '—'}</h1>
            <p className="tk-sub">Pickup {shortDate(t.date)}{t.miles || t.lane?.miles ? ` · ${(t.miles || t.lane!.miles).toLocaleString('en-US')} mi` : ''}{t.truck ? ` · Truck #${t.truck}` : ''}</p>
            <ol className="tk-steps">
              {STEPS.map(([id, label], i) => <li key={id} className={done || i <= step ? 'on' : ''}><i>{done || i < step ? '✓' : i + 1}</i>{label}</li>)}
            </ol>
            <p className="tk-where">
              {done ? '✅ Delivered.'
                : t.position ? <>📍 Truck location updated <b>{ago(t.position.at)}</b>{t.position.live ? ' · live' : ''}{left != null ? <> · about <b>{left.toLocaleString('en-US')} mi</b> to delivery (~{hoursText(left / 50)} driving)</> : null}</>
                  : 'The driver has not shared a location yet — this page updates by itself.'}
            </p>
          </section>
          <TrackMap lane={t.lane} truck={done ? null : truck} label={t.truck ? `#${t.truck}` : 'Truck'} />
          <p className="tk-foot">This page refreshes every minute. Powered by <a href="https://haulpanel.com">HaulPanel</a> — the TMS for dispatch companies.</p>
        </main>
      )}
    </div>
  )
}
