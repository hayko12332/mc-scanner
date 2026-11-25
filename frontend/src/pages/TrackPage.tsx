import { useEffect, useState } from 'react'
import { TrackMap, hoursText } from '../components/crm/MapView'
import { place } from '../components/crm/LoadsTable'
import { crm, shortDate, type TrackingView } from '../lib/crm'
import { agoText, clockAt, compass, milesBetween, splitRoute, type LngLat } from '../lib/geo'

const STEPS = [['booked', 'Booked'], ['in_transit', 'In transit'], ['delivered', 'Delivered']] as const

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
  const pos = t?.position && !done ? t.position : null
  const at: LngLat | null = pos ? [pos.lon, pos.lat] : null
  // Miles and hours left: along the road from where the truck is (plus the way back to the road if it is off it).
  const left = (() => {
    if (!at || !t?.lane || t.status !== 'in_transit') return null
    const s = splitRoute(t.lane.line, at)
    return { miles: Math.round(t.lane.miles * s.leftShare + s.offMiles * 1.2), hours: t.lane.hours * s.leftShare + (s.offMiles * 1.2) / 50 }
  })()
  const moving = pos?.speedMph != null ? pos.speedMph > 3 : null
  const trail = (t?.trail ?? []).map((p) => [p[0], p[1]] as LngLat)
  const toPickup = at && t?.lane && t.status === 'booked' ? Math.round(milesBetween(at, t.lane.a) * 1.2) : null

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
                : pos ? <>
                    <span className={`tk-live ${moving ? 'on' : ''}`}>{moving ? `Moving${pos.speedMph ? ` · ${Math.round(pos.speedMph)} mph` : ''}${pos.heading != null ? ` ${compass(pos.heading)}` : ''}` : moving === false ? 'Stopped' : 'Location'}</span>
                    {' '}updated <b>{agoText(pos.at)}</b>{pos.live ? ' · live' : ''}
                    {left && <> · <b>{left.miles.toLocaleString('en-US')} mi</b> to delivery · ETA about <b>{clockAt(Date.now() + left.hours * 3600_000)}</b> (~{hoursText(left.hours)} driving)</>}
                    {toPickup != null && <> · about <b>{toPickup.toLocaleString('en-US')} mi</b> to pickup</>}
                  </>
                  : 'The truck’s location is not shared yet — this page updates by itself.'}
            </p>
          </section>
          <TrackMap lane={t.lane} trail={trail}
            truck={at ? { at, color: moving ? '#16a34a' : '#d97706', heading: pos?.heading ?? null, moving: !!moving, label: t.truck ? `#${t.truck}` : 'Truck' } : null} />
          <p className="tk-foot">This page refreshes every minute. Powered by <a href="https://haulpanel.com">HaulPanel</a> — the TMS for dispatch companies.</p>
        </main>
      )}
    </div>
  )
}
