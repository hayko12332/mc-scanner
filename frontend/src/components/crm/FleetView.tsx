import { useEffect, useMemo, useRef, useState } from 'react'
import type { GeoJSONSource, Marker } from 'maplibre-gl'
import type * as GeoJSON from 'geojson'
import { isBroker, looksLikePlace, shortDate, words, type CrmState, type EldUnit, type LaneResult, type Load, type TrailPoint, type Truck, type TruckPosition } from '../../lib/crm'
import { agoText, cityOf, clockAt, compass, etaHours, milesBetween, splitRoute, type Hos, type LngLat } from '../../lib/geo'
import { place } from './LoadsTable'
import { addFleetLayers, EMPTY, fit, lineFeature, loadLib, pointFeature, setTruckMarker, truckMarkerEl, useMapLibre, type Theme } from './MapView'

// The fleet map, like an ELD's fleet view: every truck where its ELD (or the driver's Telegram) last put it, with
// its status, speed and heading, the driver's hours of service, and its load on the real road — the part driven,
// the part ahead and an ETA that counts the driver's breaks and rests. A selected truck also shows its GPS trail.

type Duty = 'driving' | 'on_duty' | 'stopped' | 'sleeper' | 'off_duty' | 'located' | 'no_signal' | 'none'
const DUTY: Record<Duty, { label: string; color: string }> = {
  driving: { label: 'Driving', color: '#16a34a' },
  on_duty: { label: 'On duty', color: '#d97706' },
  stopped: { label: 'Stopped', color: '#d97706' },
  sleeper: { label: 'Sleeper berth', color: '#7c3aed' },
  off_duty: { label: 'Off duty', color: '#64748b' },
  located: { label: 'Driver’s location', color: '#2563eb' },
  no_signal: { label: 'No signal', color: '#94a3b8' },
  none: { label: 'No location', color: '#cbd5e1' },
}
type Filter = 'all' | 'driving' | 'on' | 'off' | 'lost'
const FILTERS: [Filter, string, Duty[]][] = [
  ['all', 'All', []], ['driving', 'Driving', ['driving']], ['on', 'On duty', ['on_duty', 'stopped', 'located']],
  ['off', 'Off duty', ['off_duty', 'sleeper']], ['lost', 'No signal', ['no_signal', 'none']],
]
const HOS_MAX = { drive: 11 * 60, shift: 14 * 60, cycle: 70 * 60, break: 8 * 60 }

interface Row {
  truck: Truck; pos?: TruckPosition; eld?: EldUnit; duty: Duty; at: LngLat | null
  speed: number | null; heading: number | null; driver: string; address: string; hos: Hos | null
  load?: Load
  route?: {
    done: LngLat[]; ahead: LngLat[]; plan: LngLat[]; dead: LngLat[]
    progress: number | null; leftMiles: number | null; eta: { at: number; rest: boolean } | null; deadMiles: number | null
  }
}

/** Lanes asked for once per session: "origin|destination" → the road, or null when it can't be found. */
const lanes = new Map<string, LaneResult | null>()
const laneKey = (a: string, b: string) => `${a}|${b}`

function dutyOf(pos: TruckPosition | undefined, eld: EldUnit | undefined): Duty {
  if (!pos) return 'none'
  const ageMin = (Date.now() - new Date(pos.at).getTime()) / 60_000
  if (ageMin > (pos.source === 'eld' ? 30 : 180)) return 'no_signal'
  const speed = pos.speedMph ?? null
  if (speed != null && speed > 5) return 'driving'
  const s = eld?.hos?.status ?? ''
  if (s === 'driving') return speed === 0 ? 'stopped' : 'driving'
  if (s === 'on_duty' || s === 'yard_move') return 'on_duty'
  if (s === 'sleeper') return 'sleeper'
  if (s === 'off_duty' || s === 'personal_conveyance') return 'off_duty'
  return speed == null ? 'located' : 'stopped'
}

/** The load a truck is on: the one in transit, else its next booked load. */
function loadOf(loads: Load[], truckId: number): Load | undefined {
  const mine = loads.filter((l) => l.truckId === truckId)
  return mine.find((l) => l.status === 'in_transit') ?? mine.filter((l) => l.status === 'booked').sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)[0]
}

export function FleetView({ state, theme, openLoad, lane, trail, refresh, tracking, toast }: {
  state: CrmState; theme: Theme; openLoad: (id: number) => void
  lane: (from: string, to: string) => Promise<LaneResult>
  trail: (truckId: number, hours?: number) => Promise<{ points: TrailPoint[] }>
  refresh: () => void
  tracking?: (loadId: number) => Promise<{ url: string }>
  toast: (m: string) => void
}) {
  const who = words(isBroker(state)).customerLower
  const [sel, setSel] = useState<number | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [, setTick] = useState(0)
  const [crumbs, setCrumbs] = useState<LngLat[]>([])

  // Positions come with the board; ask for fresh ones every minute while the map is open.
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) refreshRef.current() }, 60_000)
    return () => clearInterval(id)
  }, [])

  const base = useMemo(() => state.trucks.map((truck) => {
    const pos = state.positions?.find((p) => p.truckId === truck.id)
    const eld = state.eld?.find((u) => u.truckId === truck.id)
    return {
      truck, pos, eld, duty: dutyOf(pos, eld), at: pos ? [pos.lon, pos.lat] as LngLat : null,
      speed: pos?.speedMph ?? null, heading: pos?.heading ?? null, driver: eld?.driver || truck.driver, address: eld?.address ?? '',
      hos: eld?.hos ?? null, load: loadOf(state.loads, truck.id),
    }
  }), [state.trucks, state.positions, state.eld, state.loads])

  // The roads: each truck's load, and for a booked load the empty miles from where the truck is to the pickup.
  useEffect(() => {
    const need: [string, string][] = []
    for (const r of base) {
      const l = r.load
      if (!l || !looksLikePlace(l.origin) || !looksLikePlace(l.destination)) continue
      need.push([l.origin, l.destination])
      const here = cityOf(r.address)
      if (l.status === 'booked' && here && place(here) !== place(l.origin)) need.push([here, l.origin])
    }
    const todo = need.filter(([a, b]) => !lanes.has(laneKey(a, b)))
    if (!todo.length) return
    let stale = false
    void (async () => {
      for (const [a, b] of todo) {
        if (lanes.has(laneKey(a, b))) continue
        lanes.set(laneKey(a, b), await lane(a, b).catch(() => null))
        if (!stale) setTick((t) => t + 1)
      }
    })()
    return () => { stale = true }
  }, [base, lane])

  const rows: Row[] = base.map((r) => {
    const l = r.load
    const road = l ? lanes.get(laneKey(l.origin, l.destination)) : undefined
    if (!l || !road) return r
    const here = cityOf(r.address)
    if (l.status === 'in_transit' && r.at) {
      const s = splitRoute(road.line, r.at)
      const hours = road.hours * s.leftShare + (s.offMiles * 1.2) / 50
      const e = etaHours(hours, r.hos)
      return { ...r, route: { done: s.done, ahead: s.ahead, plan: [], dead: [], progress: 1 - s.leftShare, leftMiles: Math.round(road.miles * s.leftShare + s.offMiles * 1.2), eta: { at: Date.now() + e.hours * 3600_000, rest: e.rest }, deadMiles: null } }
    }
    const dl = here && place(here) !== place(l.origin) ? lanes.get(laneKey(here, l.origin)) : null
    const deadMiles = dl ? dl.miles : r.at ? Math.round(milesBetween(r.at, road.a) * 1.2) : null
    const e = dl ? etaHours(dl.hours, r.hos) : null
    return { ...r, route: { done: [], ahead: l.status === 'in_transit' ? road.line : [], plan: l.status === 'booked' ? road.line : [], dead: dl ? dl.line : [], progress: null, leftMiles: null, eta: e ? { at: Date.now() + e.hours * 3600_000, rest: e.rest } : null, deadMiles } }
  })

  const counts = new Map<Filter, number>(FILTERS.map(([f, , d]) => [f, f === 'all' ? rows.length : rows.filter((r) => d.includes(r.duty)).length]))
  const needle = q.trim().toLowerCase()
  const shown = rows
    .filter((r) => filter === 'all' || FILTERS.find(([f]) => f === filter)![2].includes(r.duty))
    .filter((r) => !needle || [r.truck.unit, r.driver, r.address, r.load?.origin, r.load?.destination, r.load?.broker, r.load?.pro].some((x) => x?.toLowerCase().includes(needle)))
    .sort((a, b) => order(a.duty) - order(b.duty) || a.truck.unit.localeCompare(b.truck.unit, 'en', { numeric: true }))
  const selRow = rows.find((r) => r.truck.id === sel)

  // The selected truck's trail: the last 24 hours of GPS points.
  useEffect(() => {
    setCrumbs([])
    if (sel == null) return
    let live = true
    const get = () => trail(sel, 24).then((r) => { if (live) setCrumbs(r.points.map((p) => [p[0], p[1]] as LngLat)) }, () => undefined)
    void get()
    const id = setInterval(get, 60_000)
    return () => { live = false; clearInterval(id) }
  }, [sel, trail])

  // The map: roads and stops as layers, trucks as markers (so the arrow can turn with the heading).
  const { el, map, failed } = useMapLibre(theme, (m) => addFleetLayers(m, 'fleet'), { app: true })
  const markers = useRef(new Map<number, Marker>())
  const data = useMemo((): GeoJSON.FeatureCollection => {
    const f: GeoJSON.Feature[] = []
    for (const r of shown) {
      const l = r.load, rt = r.route
      if (!l || !rt) continue
      const dim = sel != null && sel !== r.truck.id
      if (rt.done.length > 1) f.push(lineFeature('done', rt.done, dim))
      if (rt.dead.length > 1) f.push(lineFeature('dead', rt.dead, dim))
      if (rt.plan.length > 1) f.push(lineFeature('plan', rt.plan, dim))
      if (rt.ahead.length > 1) f.push(lineFeature('ahead', rt.ahead, dim))
      const road = lanes.get(laneKey(l.origin, l.destination))
      // Stop names only for the selected truck, so the whole-fleet view stays readable.
      const named = sel === r.truck.id
      if (road) f.push(pointFeature('pickup', road.a, named ? `Pickup · ${place(l.origin)}` : '', dim), pointFeature('drop', road.b, named ? `Delivery · ${place(l.destination)}` : '', dim))
    }
    if (sel != null && crumbs.length > 1) f.push(lineFeature('trail', crumbs))
    return { type: 'FeatureCollection', features: f }
  }, [shown.map((r) => `${r.truck.id}:${r.load?.id}:${r.at}:${r.route?.leftMiles}:${r.route?.dead.length}:${r.route?.plan.length}`).join(), sel, crumbs]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { (map?.getSource('fleet') as GeoJSONSource | undefined)?.setData(map ? data : EMPTY) }, [map, data])

  useEffect(() => {
    if (!map) return
    let gone = false
    void loadLib().then((ml) => {
      if (gone) return
      const keep = new Set<number>()
      for (const r of shown) {
        if (!r.at) continue
        keep.add(r.truck.id)
        let mk = markers.current.get(r.truck.id)
        if (!mk) {
          const node = truckMarkerEl()
          node.addEventListener('click', (e) => { e.stopPropagation(); setSel(r.truck.id); document.getElementById(`fl-${r.truck.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) })
          mk = new ml.Marker({ element: node }).setLngLat(r.at).addTo(map)
          markers.current.set(r.truck.id, mk)
        }
        mk.setLngLat(r.at)
        const moving = r.duty === 'driving'
        setTruckMarker(mk.getElement(), {
          color: DUTY[r.duty].color, heading: r.heading, moving, selected: sel === r.truck.id, stale: r.duty === 'no_signal',
          label: `${r.truck.unit ? `#${r.truck.unit}` : r.driver || 'Truck'}${moving && r.speed ? ` · ${Math.round(r.speed)} mph` : ''}`,
        })
        mk.getElement().style.zIndex = sel === r.truck.id ? '3' : moving ? '2' : '1'
      }
      for (const [id, mk] of markers.current) if (!keep.has(id)) { mk.remove(); markers.current.delete(id) }
    })
    return () => { gone = true }
  }, [map, shown, sel])
  useEffect(() => () => { for (const mk of markers.current.values()) mk.remove(); markers.current.clear() }, [])

  // Frame the whole fleet once, and the selected truck with its road whenever the selection changes.
  const framed = useRef<string>('')
  useEffect(() => {
    if (!map) return
    const key = sel == null ? `all:${rows.filter((r) => r.at).length}` : `sel:${sel}:${crumbs.length > 1}`
    if (framed.current === key) return
    const pts: LngLat[] = sel == null
      ? rows.flatMap((r) => [...(r.at ? [r.at] : []), ...(r.route ? [...r.route.ahead, ...r.route.plan] : [])])
      : selRow ? [...(selRow.at ? [selRow.at] : []), ...(selRow.route ? [...selRow.route.done, ...selRow.route.ahead, ...selRow.route.plan, ...selRow.route.dead] : []), ...crumbs] : []
    if (!pts.length) return
    framed.current = key
    fit(map, pts, sel == null ? 60 : 80)
  }, [map, sel, rows, selRow, crumbs])

  const fitAll = () => { setSel(null); framed.current = '' }
  const copyLink = async (loadId: number) => {
    if (!tracking) return
    try {
      const r = await tracking(loadId)
      await navigator.clipboard.writeText(r.url).then(() => toast(`Tracking link copied — send it to the ${who}`), () => toast(r.url))
    } catch (e) { toast((e as Error).message) }
  }

  const sources = [...new Set((state.positions ?? []).map((p) => (p.source === 'eld' ? 'eld' : 'telegram')))]
  const eldName = state.eld?.[0]?.provider === 'motive' ? 'Motive' : 'Samsara'
  const newest = (state.positions ?? []).reduce<string | null>((m, p) => (!m || p.at > m ? p.at : m), null)
  const unassigned = state.loads.filter((l) => !l.truckId && (l.status === 'in_transit' || l.status === 'booked'))

  return (
    <div className="fl">
      <header className="fl-head">
        <div>
          <h2>Fleet</h2>
          <p>
            {rows.length} {rows.length === 1 ? 'truck' : 'trucks'}
            {sources.length ? ` · from ${sources.map((s) => (s === 'eld' ? eldName : 'drivers’ Telegram')).join(' and ')}` : ''}
            {newest ? ` · last update ${agoText(newest)}` : ''} · refreshes every minute
          </p>
        </div>
        <div className="fl-tools">
          <div className="fl-chips" role="group" aria-label="Show trucks">
            {FILTERS.map(([f, label, d]) => (
              <button key={f} className={filter === f ? 'on' : ''} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f !== 'all' && <i style={{ background: DUTY[d[0]].color }} />}{label}<em>{counts.get(f) ?? 0}</em>
              </button>
            ))}
          </div>
          <input className="fl-search" type="search" placeholder="Truck, driver, city, load #" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search trucks" />
        </div>
      </header>

      <div className="fl-body">
        <ul className="fl-list">
          {shown.map((r) => <TruckCard key={r.truck.id} r={r} selected={sel === r.truck.id} who={who}
            onSelect={() => setSel(sel === r.truck.id ? null : r.truck.id)} openLoad={openLoad} copyLink={tracking ? copyLink : undefined} />)}
          {!shown.length && <li className="fl-empty">{rows.length ? 'No trucks match.' : 'No trucks yet. Add them in Trucks, or connect Samsara in Integrations — its vehicles come in by themselves.'}</li>}
          {unassigned.length > 0 && (
            <li className="fl-unassigned">
              <h3>Loads without a truck <em>{unassigned.length}</em></h3>
              {unassigned.slice(0, 12).map((l) => (
                <button key={l.id} onClick={() => openLoad(l.id)}>
                  <b>{place(l.origin) || '—'} → {place(l.destination) || '—'}</b>
                  <small>{shortDate(l.date)} · {l.broker || '—'}{l.pro ? ` · #${l.pro}` : ''} · {l.status === 'in_transit' ? 'In transit' : 'Booked'}</small>
                </button>
              ))}
            </li>
          )}
        </ul>

        <div className="fl-mapwrap">
          <div className="fl-map" ref={el} role="region" aria-label="Fleet map">
            {failed && <p className="rm-msg">The map could not load. Check the connection and open the tab again.</p>}
          </div>
          <button className="fl-fit" onClick={fitAll}>Show all trucks</button>
          <div className="fl-legend" aria-hidden="true">
            <span><i style={{ background: DUTY.driving.color }} />Driving</span>
            <span><i style={{ background: DUTY.on_duty.color }} />On duty / stopped</span>
            <span><i style={{ background: DUTY.off_duty.color }} />Off duty</span>
            <span><b className="fl-l ahead" />Route ahead</span>
            <span><b className="fl-l done" />Driven</span>
            <span><b className="fl-l trail" />GPS trail (24 h)</span>
          </div>
        </div>
      </div>
    </div>
  )
}

const order = (d: Duty) => ['driving', 'on_duty', 'stopped', 'located', 'sleeper', 'off_duty', 'no_signal', 'none'].indexOf(d)

function TruckCard({ r, selected, who, onSelect, openLoad, copyLink }: {
  r: Row; selected: boolean; who: string; onSelect: () => void; openLoad: (id: number) => void; copyLink?: (loadId: number) => void
}) {
  const d = DUTY[r.duty]
  const l = r.load, rt = r.route
  return (
    <li id={`fl-${r.truck.id}`} className={`fl-card ${selected ? 'on' : ''}`}>
      <button className="fl-card-main" onClick={onSelect} aria-expanded={selected}>
        <span className="fl-r1">
          <span className="fl-unit"><i style={{ background: d.color }} />{r.truck.unit ? `#${r.truck.unit}` : 'Truck'}</span>
          <span className="fl-duty" style={{ color: d.color }}>
            {d.label}{r.duty === 'driving' && r.speed ? ` · ${Math.round(r.speed)} mph${r.heading != null ? ` ${compass(r.heading)}` : ''}` : ''}
          </span>
          {r.pos && <small className="fl-ago">{agoText(r.pos.at)}</small>}
        </span>
        <span className="fl-driver">{r.driver || 'No driver'}</span>
        <span className="fl-where">{r.address || (r.at ? `${r.at[1].toFixed(3)}, ${r.at[0].toFixed(3)}` : 'No location yet — link it to your ELD in Integrations, or connect the driver’s Telegram in Trucks')}</span>

        {l && (
          <span className="fl-load">
            <span className="fl-load-top">
              <b>{place(l.origin) || '—'} → {place(l.destination) || '—'}</b>
              <em className={`fl-st ${l.status}`}>{l.status === 'in_transit' ? 'In transit' : `Booked · ${shortDate(l.date)}`}</em>
            </span>
            {rt?.progress != null && <span className="fl-prog" aria-label={`${Math.round(rt.progress * 100)}% of the way`}><i style={{ width: `${Math.max(3, Math.round(rt.progress * 100))}%` }} /></span>}
            <small>
              {l.broker || '—'}{l.pro ? ` · #${l.pro}` : ''}
              {rt?.leftMiles != null && <> · <b>{rt.leftMiles.toLocaleString('en-US')} mi</b> left</>}
              {rt?.eta && l.status === 'in_transit' && <> · ETA <b>{clockAt(rt.eta.at)}</b>{rt.eta.rest ? ' (after a 10 h rest)' : ''}</>}
              {l.status === 'booked' && rt?.deadMiles != null && <> · <b>{rt.deadMiles.toLocaleString('en-US')} mi</b> empty to pickup{rt.eta ? <> · there by <b>{clockAt(rt.eta.at)}</b></> : null}</>}
            </small>
          </span>
        )}

        {r.hos && (
          <span className="fl-hos">
            <Clock label="Drive" min={r.hos.driveLeftMin} max={HOS_MAX.drive} low={60} />
            <Clock label="Shift" min={r.hos.shiftLeftMin} max={HOS_MAX.shift} low={60} />
            <Clock label="Cycle" min={r.hos.cycleLeftMin} max={HOS_MAX.cycle} low={300} />
            <Clock label="Break in" min={r.hos.breakLeftMin} max={HOS_MAX.break} low={30} />
          </span>
        )}
      </button>
      {selected && (
        <span className="fl-actions">
          {l && <button onClick={() => openLoad(l.id)}>Open load</button>}
          {l && copyLink && <button onClick={() => copyLink(l.id)}>🔗 Tracking link for the {who}</button>}
          {r.truck.phone && <a className="btn" href={`tel:${r.truck.phone}`}>Call {r.driver.split(' ')[0] || 'driver'}</a>}
        </span>
      )}
    </li>
  )
}

/** One hours-of-service clock: time left and a bar (amber under 2× the warning, red under it). */
function Clock({ label, min, max, low }: { label: string; min: number | null; max: number; low: number }) {
  if (min == null) return <span className="fl-clock"><em>{label}</em><b>—</b></span>
  const tone = min <= low ? 'bad' : min <= low * 2 ? 'warn' : 'ok'
  return (
    <span className={`fl-clock ${tone}`}>
      <em>{label}</em>
      <b>{Math.floor(min / 60)}:{String(min % 60).padStart(2, '0')}</b>
      <i><u style={{ width: `${Math.min(100, Math.round((min / max) * 100))}%` }} /></i>
    </span>
  )
}

