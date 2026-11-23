import { useEffect, useMemo, useRef, useState } from 'react'
import type { GeoJSONSource, Map as MlMap, MapLayerMouseEvent } from 'maplibre-gl'
import type * as GeoJSON from 'geojson'
import { gross, looksLikePlace, shortDate, STATUSES, usd, type CrmState, type LaneResult, type Load, type LoadStatus } from '../../lib/crm'
import { place } from './LoadsTable'

// Maps: MapLibre with free OpenStreetMap tiles from OpenFreeMap (no key). The library (~250 KB gzip) loads only
// when a map is first shown, so the site itself stays light.

type Theme = 'light' | 'dark'
type LngLat = [number, number]

export const STATUS_COLOR: Record<LoadStatus, string> = {
  booked: '#3b82f6', in_transit: '#eab308', delivered: '#8b5cf6', invoiced: '#f97316', paid: '#22c55e',
}
const styleUrl = (theme: Theme) => `https://tiles.openfreemap.org/styles/${theme === 'dark' ? 'dark' : 'positron'}`
const US_BOUNDS: [LngLat, LngLat] = [[-125, 24], [-66, 49.5]]

let lib: Promise<typeof import('maplibre-gl')> | null = null
const loadLib = () => (lib ??= Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]).then(([m]) => m))

/** Creates a map in the element once the library is loaded; `ready` runs when the style is in, with the map. */
function useMapLibre(theme: Theme, ready: (map: MlMap) => void) {
  const el = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<MlMap | null>(null)
  const [failed, setFailed] = useState(false)
  const onReady = useRef(ready)
  onReady.current = ready
  useEffect(() => {
    let m: MlMap | null = null
    let gone = false
    loadLib().then((ml) => {
      if (gone || !el.current) return
      try {
        m = new ml.Map({
          container: el.current, style: styleUrl(theme), bounds: US_BOUNDS, fitBoundsOptions: { padding: 20 },
          attributionControl: { compact: true }, cooperativeGestures: true, dragRotate: false, pitchWithRotate: false,
        })
      } catch {
        // No WebGL (an old browser, or too many maps open at once).
        return setFailed(true)
      }
      m.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right')
      m.on('load', () => { if (!gone && m) { onReady.current(m); setMap(m) } })
    }, () => {
      // The map code didn't load (offline, or the site was updated since this page opened): try again next time.
      lib = null
      setFailed(true)
    })
    return () => { gone = true; m?.remove() }
  }, [theme])
  return { el, map, failed }
}

const fit = (map: MlMap, pts: LngLat[], padding = 40) => {
  if (!pts.length) return
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding, maxZoom: 9, duration: 0 })
}

/**
 * The lane of one load on a map: the road from pickup (A) to delivery (B), with miles and driving time.
 * Shown in the load panel; needs both ends as "City, ST".
 */
export function RouteMap({ from, to, theme, lane }: {
  from: string; to: string; theme: Theme; lane: (from: string, to: string) => Promise<LaneResult>
}) {
  const ok = looksLikePlace(from) && looksLikePlace(to)
  const [r, setR] = useState<LaneResult | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    setR(null); setErr('')
    if (!ok) return
    let stale = false
    lane(from, to).then((x) => { if (!stale) setR(x) }, (e: Error) => { if (!stale) setErr(e.message) })
    return () => { stale = true }
  }, [from, to, ok, lane])

  const draw = (map: MlMap, x: LaneResult | null) => {
    if (!x) return
    const data: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { kind: 'route' }, geometry: { type: 'LineString', coordinates: x.line } },
        { type: 'Feature', properties: { kind: 'a' }, geometry: { type: 'Point', coordinates: x.a } },
        { type: 'Feature', properties: { kind: 'b' }, geometry: { type: 'Point', coordinates: x.b } },
      ],
    }
    const src = map.getSource('lane') as GeoJSONSource | undefined
    if (src) src.setData(data)
    else {
      map.addSource('lane', { type: 'geojson', data })
      map.addLayer({ id: 'lane-casing', type: 'line', source: 'lane', filter: ['==', ['get', 'kind'], 'route'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': theme === 'dark' ? 0.25 : 0.9 } })
      map.addLayer({ id: 'lane-line', type: 'line', source: 'lane', filter: ['==', ['get', 'kind'], 'route'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#2563eb', 'line-width': 4, ...(x.estimate ? { 'line-dasharray': [2, 2] } : {}) } })
      map.addLayer({ id: 'lane-ends', type: 'circle', source: 'lane', filter: ['!=', ['get', 'kind'], 'route'], paint: { 'circle-radius': 7, 'circle-color': ['match', ['get', 'kind'], 'a', '#16a34a', '#dc2626'], 'circle-stroke-width': 2.5, 'circle-stroke-color': '#ffffff' } })
    }
    const pts = x.line.length ? x.line : [x.a, x.b]
    fit(map, pts)
    // The panel slides in while the map loads: fit again once it has its final size.
    setTimeout(() => { try { map.resize(); fit(map, pts) } catch { /* map closed */ } }, 350)
  }
  const { el, map, failed } = useMapLibre(theme, (m) => draw(m, r))
  useEffect(() => { if (map) draw(map, r) }, [map, r]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!ok) return null
  return (
    <div className="rm">
      <div className="rm-map" ref={el} role="img" aria-label={`Map of the route from ${from} to ${to}`}>
        {(failed || err) && <p className="rm-msg">{err || <>The map could not load. <button type="button" className="w-link" onClick={() => location.reload()}>Reload</button></>}</p>}
      </div>
      <div className="rm-foot">
        <span><i className="rm-dot a" />{place(from)}</span><span className="rm-arrow">→</span><span><i className="rm-dot b" />{place(to)}</span>
        <b>{r ? `${r.miles.toLocaleString('en-US')} mi · ${hoursText(r.hours)} driving` : err ? '' : 'Finding the route…'}</b>
        {r && <small>{r.estimate ? 'straight-line estimate' : r.truck ? 'truck route' : 'road route'}</small>}
      </div>
    </div>
  )
}

export const hoursText = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : `${Math.floor(h)} h${Math.round((h % 1) * 60) ? ` ${Math.round((h % 1) * 60)} min` : ''}`)

const pointCache = new Map<string, LngLat | null>()

/**
 * The board map: loads as lines from pickup to delivery, colored by status (active work shown first), so you see
 * where your trucks are headed. Click a lane to open the load. The list under the map shows the same loads.
 */
export function BoardMap({ state, theme, openLoad, points }: {
  state: CrmState; theme: Theme; openLoad: (id: number) => void
  points: (places: string[]) => Promise<Record<string, LngLat | null>>
}) {
  const [show, setShow] = useState<Set<LoadStatus>>(() => new Set<LoadStatus>(['booked', 'in_transit']))
  const [, setTick] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  const counts = useMemo(() => {
    const c = new Map<LoadStatus, number>()
    for (const l of state.loads) c.set(l.status, (c.get(l.status) ?? 0) + 1)
    return c
  }, [state.loads])
  const loads = useMemo(() => state.loads.filter((l) => show.has(l.status) && l.id > 0).slice(0, 400), [state.loads, show])

  // Look up the map points of the cities on these loads (known cities answer at once; the rest are cached).
  useEffect(() => {
    const need = [...new Set(loads.flatMap((l) => [l.origin, l.destination]).filter((p) => looksLikePlace(p) && !pointCache.has(p)))]
    if (!need.length) return
    let stale = false
    void (async () => {
      for (let i = 0; i < need.length; i += 200) {
        const got = await points(need.slice(i, i + 200)).catch(() => ({} as Record<string, LngLat | null>))
        for (const p of need.slice(i, i + 200)) pointCache.set(p, got[p] ?? null)
        if (!stale) setTick((t) => t + 1)
      }
    })()
    return () => { stale = true }
  }, [loads, points])

  const placed = loads.map((l) => ({ l, a: pointCache.get(l.origin) ?? null, b: pointCache.get(l.destination) ?? null }))
  const onMap = placed.filter((x) => x.a && x.b) as { l: Load; a: LngLat; b: LngLat }[]
  const missing = placed.length - onMap.length

  const data = useMemo((): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: onMap.flatMap(({ l, a, b }) => [
      { type: 'Feature', id: l.id, properties: { id: l.id, kind: 'lane', color: STATUS_COLOR[l.status] }, geometry: { type: 'LineString', coordinates: arc(a, b) } },
      { type: 'Feature', properties: { id: l.id, kind: 'a', color: STATUS_COLOR[l.status] }, geometry: { type: 'Point', coordinates: a } },
      { type: 'Feature', properties: { id: l.id, kind: 'b', color: STATUS_COLOR[l.status] }, geometry: { type: 'Point', coordinates: b } },
    ] as GeoJSON.Feature[]),
  }), [onMap.map((x) => `${x.l.id}${x.l.status}${x.a}${x.b}`).join()]) // eslint-disable-line react-hooks/exhaustive-deps

  const open = useRef(openLoad)
  open.current = openLoad
  const { el, map, failed } = useMapLibre(theme, (m) => {
    m.addSource('loads', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    m.addLayer({ id: 'loads-hit', type: 'line', source: 'loads', filter: ['==', ['get', 'kind'], 'lane'], paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 14 } })
    m.addLayer({ id: 'loads-line', type: 'line', source: 'loads', filter: ['==', ['get', 'kind'], 'lane'], layout: { 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 5, 2.5], 'line-opacity': 0.9 } })
    m.addLayer({ id: 'loads-ends', type: 'circle', source: 'loads', filter: ['!=', ['get', 'kind'], 'lane'],
      paint: { 'circle-radius': ['match', ['get', 'kind'], 'b', 5, 3.5], 'circle-color': ['match', ['get', 'kind'], 'b', ['get', 'color'], '#ffffff'],
        'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2 } })
    // Trucks: where each driver last shared their location (Telegram), labelled with the unit number.
    m.addSource('trucks', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    m.addLayer({ id: 'trucks-dot', type: 'circle', source: 'trucks',
      paint: { 'circle-radius': 9, 'circle-color': ['case', ['get', 'live'], '#0f172a', '#64748b'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 } })
    m.addLayer({ id: 'trucks-label', type: 'symbol', source: 'trucks',
      layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 11.5, 'text-offset': [0, 1.5], 'text-anchor': 'top', 'text-allow-overlap': true },
      paint: { 'text-color': theme === 'dark' ? '#f8fafc' : '#0f172a', 'text-halo-color': theme === 'dark' ? '#0f172a' : '#ffffff', 'text-halo-width': 1.6 } })
    const pick = (e: MapLayerMouseEvent) => Number(e.features?.[0]?.properties?.id)
    m.on('click', 'loads-hit', (e) => { const id = pick(e); if (id) open.current(id) })
    m.on('mousemove', 'loads-hit', (e) => { m.getCanvas().style.cursor = 'pointer'; setHover(pick(e) || null) })
    m.on('mouseleave', 'loads-hit', () => { m.getCanvas().style.cursor = ''; setHover(null) })
  })
  const fitted = useRef('')
  useEffect(() => {
    if (!map) return
    ;(map.getSource('loads') as GeoJSONSource | undefined)?.setData(data)
    const key = [...show].join()
    if (onMap.length && fitted.current !== key) { fitted.current = key; fit(map, onMap.flatMap((x) => [x.a, x.b]), 50) }
  }, [map, data]) // eslint-disable-line react-hooks/exhaustive-deps
  const trucks = useMemo((): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: (state.positions ?? []).map((p) => {
      const t = state.trucks.find((x) => x.id === p.truckId)
      const mins = Math.round((Date.now() - new Date(p.at).getTime()) / 60_000)
      const when = mins < 60 ? `${mins} min` : mins < 2880 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} d`
      return { type: 'Feature', properties: { label: `${t?.unit ? `#${t.unit}` : t?.driver ?? 'Truck'} · ${p.live ? 'live' : when}`, live: p.live }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }
    }),
  }), [state.positions, state.trucks])
  useEffect(() => { (map?.getSource('trucks') as GeoJSONSource | undefined)?.setData(trucks) }, [map, trucks])
  const lastHover = useRef<number | null>(null)
  useEffect(() => {
    if (!map) return
    if (lastHover.current != null) map.setFeatureState({ source: 'loads', id: lastHover.current }, { hover: false })
    if (hover != null) map.setFeatureState({ source: 'loads', id: hover }, { hover: true })
    lastHover.current = hover
  }, [map, hover])

  const toggle = (s: LoadStatus) => setShow((cur) => { const n = new Set(cur); if (n.has(s)) n.delete(s); else n.add(s); return n })
  const hovered = hover != null ? state.loads.find((l) => l.id === hover) : undefined
  const carrier = (l: Load) => state.carriers.find((c) => c.id === l.carrierId)?.name
  const truck = (l: Load) => { const t = state.trucks.find((x) => x.id === l.truckId); return t ? [t.unit && `#${t.unit}`, t.driver].filter(Boolean).join(' · ') : '' }

  return (
    <div className="bm">
      <div className="bm-head">
        <div>
          <h2>Map</h2>
          <p>{onMap.length} {onMap.length === 1 ? 'load' : 'loads'} on the map{missing > 0 ? ` · ${missing} without City, ST` : ''}{state.positions?.length ? ` · ${state.positions.length} ${state.positions.length === 1 ? 'truck' : 'trucks'} from ${state.eld?.length ? 'your ELD and drivers’ Telegram' : 'drivers’ Telegram'}` : ''}. Click a lane to open the load.</p>
        </div>
        <div className="bm-chips" role="group" aria-label="Statuses shown">
          {STATUSES.map((s) => (
            <button key={s.id} className={show.has(s.id) ? 'on' : ''} aria-pressed={show.has(s.id)} onClick={() => toggle(s.id)}>
              <i style={{ background: STATUS_COLOR[s.id] }} />{s.label}<em>{counts.get(s.id) ?? 0}</em>
            </button>
          ))}
        </div>
      </div>
      <div className="bm-map" ref={el}>
        {failed && <p className="rm-msg">The map could not load. Check the connection and open the tab again.</p>}
        {hovered && (
          <div className="bm-tip">
            <b>{hovered.broker || 'Load'}</b>
            <span>{place(hovered.origin)} → {place(hovered.destination)}</span>
            <span>{usd(gross(hovered))}{hovered.loadedMiles ? ` · ${hovered.loadedMiles.toLocaleString('en-US')} mi` : ''} · {STATUSES.find((s) => s.id === hovered.status)?.label}</span>
          </div>
        )}
      </div>
      {loads.length > 0 ? (
        <ul className="bm-list">
          {loads.slice(0, 60).map((l) => (
            <li key={l.id} className={hover === l.id ? 'on' : ''} onMouseEnter={() => setHover(l.id)} onMouseLeave={() => setHover(null)}>
              <button onClick={() => openLoad(l.id)}>
                <i style={{ background: STATUS_COLOR[l.status] }} />
                <span className="bm-lane"><b>{place(l.origin) || '—'} → {place(l.destination) || '—'}</b><small>{shortDate(l.date)} · {l.broker || 'No broker'}{carrier(l) ? ` · ${carrier(l)}` : ''}{truck(l) ? ` · ${truck(l)}` : ''}</small></span>
                <span className="bm-rate">{usd(gross(l))}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="bm-empty">No loads with these statuses. Pick another status above.</p>
      )}
    </div>
  )
}

/** A gentle curve between two points (so lanes that share a city don't sit on top of each other). */
function arc(a: LngLat, b: LngLat, n = 24): LngLat[] {
  const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
  const c: LngLat = [mx - dy * 0.15, my + dx * 0.15]
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n
    return [(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t ** 2 * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t ** 2 * b[1]] as LngLat
  })
}

/** The broker's tracking map: the lane and where the truck is now (from the driver's Telegram location). */
export function TrackMap({ lane, truck, label }: { lane: LaneResult | null; truck: LngLat | null; label: string }) {
  const draw = (map: MlMap) => {
    const features: GeoJSON.Feature[] = []
    if (lane) {
      features.push({ type: 'Feature', properties: { kind: 'route' }, geometry: { type: 'LineString', coordinates: lane.line } })
      features.push({ type: 'Feature', properties: { kind: 'a' }, geometry: { type: 'Point', coordinates: lane.a } })
      features.push({ type: 'Feature', properties: { kind: 'b' }, geometry: { type: 'Point', coordinates: lane.b } })
    }
    if (truck) features.push({ type: 'Feature', properties: { kind: 'truck', label }, geometry: { type: 'Point', coordinates: truck } })
    const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features }
    const src = map.getSource('track') as GeoJSONSource | undefined
    if (src) src.setData(data)
    else {
      map.addSource('track', { type: 'geojson', data })
      map.addLayer({ id: 'track-line', type: 'line', source: 'track', filter: ['==', ['get', 'kind'], 'route'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#2563eb', 'line-width': 4, 'line-opacity': 0.85 } })
      map.addLayer({ id: 'track-ends', type: 'circle', source: 'track', filter: ['in', ['get', 'kind'], ['literal', ['a', 'b']]], paint: { 'circle-radius': 7, 'circle-color': ['match', ['get', 'kind'], 'a', '#16a34a', '#dc2626'], 'circle-stroke-width': 2.5, 'circle-stroke-color': '#ffffff' } })
      map.addLayer({ id: 'track-truck', type: 'circle', source: 'track', filter: ['==', ['get', 'kind'], 'truck'], paint: { 'circle-radius': 10, 'circle-color': '#0f172a', 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' } })
      map.addLayer({ id: 'track-truck-label', type: 'symbol', source: 'track', filter: ['==', ['get', 'kind'], 'truck'],
        layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, 1.6], 'text-anchor': 'top', 'text-allow-overlap': true },
        paint: { 'text-color': '#0f172a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.8 } })
    }
    const pts = [...(lane ? lane.line : []), ...(truck ? [truck] : [])]
    if (pts.length) fit(map, pts, 50)
  }
  const { el, map, failed } = useMapLibre('light', draw)
  useEffect(() => { if (map) draw(map) }, [map, lane, truck?.[0], truck?.[1], label]) // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="tk-map" ref={el}>{failed && <p className="rm-msg">The map could not load.</p>}</div>
}
