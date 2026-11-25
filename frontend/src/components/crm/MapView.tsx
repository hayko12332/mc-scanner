import { useEffect, useRef, useState } from 'react'
import type * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl'
import type * as GeoJSON from 'geojson'
import { looksLikePlace, type LaneResult, type LoadStatus } from '../../lib/crm'
import { splitRoute } from '../../lib/geo'
import { place } from './LoadsTable'

// Maps: MapLibre with free OpenStreetMap tiles from OpenFreeMap (no key). The library (~250 KB gzip) loads only
// when a map is first shown, so the site itself stays light.

export type Theme = 'light' | 'dark'
type LngLat = [number, number]

export const STATUS_COLOR: Record<LoadStatus, string> = {
  booked: '#3b82f6', in_transit: '#eab308', delivered: '#8b5cf6', invoiced: '#f97316', paid: '#22c55e',
}
/** Normal map colors (green land, blue water, roads) in both themes — a dark or grey map reads badly for trucking. */
const styleUrl = (_theme: Theme) => 'https://tiles.openfreemap.org/styles/liberty'
const US_BOUNDS: [LngLat, LngLat] = [[-125, 24], [-66, 49.5]]

let lib: Promise<typeof import('maplibre-gl')> | null = null
export const loadLib = () => (lib ??= Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]).then(([m]) => m))

/** Creates a map in the element once the library is loaded; `ready` runs when the style is in, with the map. */
export function useMapLibre(theme: Theme, ready: (map: MlMap) => void, opts: { app?: boolean } = {}) {
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
        // A small map inside a page needs Ctrl/two fingers to zoom (so the page scrolls); the fleet map is the page.
        m = new ml.Map({
          container: el.current, style: styleUrl(theme), bounds: US_BOUNDS, fitBoundsOptions: { padding: 20 },
          attributionControl: { compact: true }, cooperativeGestures: !opts.app, dragRotate: false, pitchWithRotate: false,
        })
      } catch {
        // No WebGL (an old browser, or too many maps open at once).
        return setFailed(true)
      }
      m.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right')
      if (opts.app) m.addControl(new ml.FullscreenControl(), 'top-right')
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

export const fit = (map: MlMap, pts: LngLat[], padding = 40) => {
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

// Fleet layers shared by the fleet map and the broker's tracking page. Kinds of features:
//   done  – the part of the load's road already driven (grey)      ahead – the road still to drive (blue)
//   plan  – a booked load's road, not started (dashed blue)         dead  – empty miles to the pickup (dashed grey)
//   trail – where the truck really drove, from GPS (violet)         pickup / drop – the load's stops (green / red)
// A feature with `dim: true` belongs to a truck that isn't selected and is drawn faint.

export const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const isDim: maplibregl.ExpressionSpecification = ['==', ['get', 'dim'], true]

export function addFleetLayers(map: MlMap, src: string) {
  map.addSource(src, { type: 'geojson', data: EMPTY })
  const op = (on: number, off: number): maplibregl.ExpressionSpecification => ['case', isDim, off, on]
  const line = (id: string, kinds: string[], paint: maplibregl.LineLayerSpecification['paint']) => map.addLayer({
    id: `${src}-${id}`, type: 'line', source: src, filter: ['in', ['get', 'kind'], ['literal', kinds]],
    layout: { 'line-cap': 'round', 'line-join': 'round' }, paint,
  })
  line('casing', ['ahead', 'plan'], { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': op(0.95, 0.35) })
  line('done', ['done'], { 'line-color': '#94a3b8', 'line-width': 5, 'line-opacity': op(0.95, 0.4) })
  line('dead', ['dead'], { 'line-color': '#475569', 'line-width': 3, 'line-dasharray': [1, 1.8], 'line-opacity': op(0.9, 0.35) })
  line('plan', ['plan'], { 'line-color': '#2563eb', 'line-width': 4.5, 'line-dasharray': [2, 1.5], 'line-opacity': op(0.95, 0.35) })
  line('ahead', ['ahead'], { 'line-color': '#2563eb', 'line-width': 5.5, 'line-opacity': op(1, 0.4) })
  line('trail', ['trail'], { 'line-color': '#7c3aed', 'line-width': 3.5, 'line-opacity': 0.9 })
  map.addLayer({
    id: `${src}-stops`, type: 'circle', source: src, filter: ['in', ['get', 'kind'], ['literal', ['pickup', 'drop']]],
    paint: { 'circle-radius': op(7.5, 5), 'circle-color': ['match', ['get', 'kind'], 'pickup', '#16a34a', '#dc2626'], 'circle-stroke-width': 2.5, 'circle-stroke-color': '#ffffff', 'circle-opacity': op(1, 0.5), 'circle-stroke-opacity': op(1, 0.5) },
  })
  map.addLayer({
    id: `${src}-stop-label`, type: 'symbol', source: src, filter: ['all', ['in', ['get', 'kind'], ['literal', ['pickup', 'drop']]], ['!', isDim]],
    layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, 1.2], 'text-anchor': 'top' },
    paint: { 'text-color': '#0f172a', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
  })
}

export const lineFeature = (kind: string, coordinates: LngLat[], dim = false): GeoJSON.Feature =>
  ({ type: 'Feature', properties: { kind, dim }, geometry: { type: 'LineString', coordinates } })
export const pointFeature = (kind: string, coordinates: LngLat, label: string, dim = false): GeoJSON.Feature =>
  ({ type: 'Feature', properties: { kind, label, dim }, geometry: { type: 'Point', coordinates } })

export interface TruckLook { color: string; heading: number | null; moving: boolean; label: string; selected?: boolean; stale?: boolean }

/** A truck on the map: a colored disc (status) with an arrow pointing where it drives, and its unit number under it. */
export function truckMarkerEl(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'fm'
  el.innerHTML = '<div class="fm-dot"><svg class="fm-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 19.5 20.5 12 16.2 4.5 20.5Z"/></svg><i class="fm-stop"></i></div><span class="fm-tag"></span>'
  return el
}

export function setTruckMarker(el: HTMLElement, t: TruckLook) {
  el.style.setProperty('--c', t.color)
  el.style.setProperty('--h', `${t.heading ?? 0}deg`)
  el.classList.toggle('moving', t.moving && t.heading != null)
  el.classList.toggle('sel', !!t.selected)
  el.classList.toggle('stale', !!t.stale)
  el.querySelector('.fm-tag')!.textContent = t.label
  el.setAttribute('aria-label', t.label)
}

/** The broker's tracking map: the load's road (driven part grey, the rest blue), the GPS trail and the truck. */
export function TrackMap({ lane, truck, trail }: { lane: LaneResult | null; truck: (TruckLook & { at: LngLat }) | null; trail: LngLat[] }) {
  const marker = useRef<maplibregl.Marker | null>(null)
  const draw = (map: MlMap) => {
    if (!map.getSource('track')) addFleetLayers(map, 'track')
    const features: GeoJSON.Feature[] = []
    if (lane) {
      if (truck) {
        const s = splitRoute(lane.line, truck.at)
        features.push(lineFeature('done', s.done), lineFeature('ahead', s.ahead))
      } else features.push(lineFeature('ahead', lane.line))
      features.push(pointFeature('pickup', lane.a, 'Pickup'), pointFeature('drop', lane.b, 'Delivery'))
    }
    if (trail.length > 1) features.push(lineFeature('trail', trail))
    ;(map.getSource('track') as GeoJSONSource).setData({ type: 'FeatureCollection', features })
    const pts = [...(lane ? lane.line : []), ...(truck ? [truck.at] : [])]
    if (pts.length) fit(map, pts, 60)
  }
  const { el, map, failed } = useMapLibre('light', draw)
  useEffect(() => { if (map) draw(map) }, [map, lane, truck?.at[0], truck?.at[1], trail.length]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!map) return
    if (!truck) { marker.current?.remove(); marker.current = null; return }
    void loadLib().then((ml) => {
      if (!marker.current) marker.current = new ml.Marker({ element: truckMarkerEl() }).setLngLat(truck.at).addTo(map)
      marker.current.setLngLat(truck.at)
      setTruckMarker(marker.current.getElement(), { ...truck, selected: true })
    })
  }, [map, truck])
  useEffect(() => () => { marker.current?.remove() }, [])
  return <div className="tk-map" ref={el}>{failed && <p className="rm-msg">The map could not load.</p>}</div>
}
