// Small map math for the fleet map and the tracking page: distances, where a truck is along a route, ETA with
// the driver's hours of service. Points are [lon, lat] like GeoJSON.

export type LngLat = [number, number]

const rad = (d: number) => (d * Math.PI) / 180

/** Great-circle miles between two points. */
export function milesBetween(a: LngLat, b: LngLat): number {
  const h = Math.sin(rad(b[1] - a[1]) / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2
  return 2 * 3958.8 * Math.asin(Math.sqrt(h))
}

export function lineMiles(line: LngLat[]): number {
  let m = 0
  for (let i = 1; i < line.length; i++) m += milesBetween(line[i - 1], line[i])
  return m
}

/**
 * Where a point is along a route: the route split at the nearest spot into the part already driven and the part
 * ahead, the share of the route still ahead (0..1), and how far the point is from the road.
 */
export function splitRoute(line: LngLat[], p: LngLat): { done: LngLat[]; ahead: LngLat[]; leftShare: number; offMiles: number } {
  if (line.length < 2) return { done: [], ahead: line, leftShare: 1, offMiles: 0 }
  const k = Math.cos(rad(p[1]))
  let best = { i: 1, t: 0, d: Infinity }
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = [line[i - 1][0] * k, line[i - 1][1]], [bx, by] = [line[i][0] * k, line[i][1]], [px, py] = [p[0] * k, p[1]]
    const dx = bx - ax, dy = by - ay
    const len = dx * dx + dy * dy
    const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0
    const d = (ax + t * dx - px) ** 2 + (ay + t * dy - py) ** 2
    if (d < best.d) best = { i, t, d }
  }
  const a = line[best.i - 1], b = line[best.i]
  const at: LngLat = [a[0] + (b[0] - a[0]) * best.t, a[1] + (b[1] - a[1]) * best.t]
  const done = [...line.slice(0, best.i), at]
  const ahead = [at, ...line.slice(best.i)]
  const total = lineMiles(line) || 1
  return { done, ahead, leftShare: Math.max(0, Math.min(1, lineMiles(ahead) / total)), offMiles: milesBetween(at, p) }
}

/** "I-35 N, 12 mi NE of Ardmore, OK" / "1200 Main St, Fresno, CA 93721" → "Ardmore, OK" / "Fresno, CA" (the last City, ST). */
export function cityOf(address: string): string {
  // Only capitalised words make a city name, so "12 mi NE of Ardmore, OK" gives "Ardmore, OK".
  const all = [...address.matchAll(/((?:[A-Z][A-Za-z.'-]*\s)*[A-Z][A-Za-z.'-]*), ([A-Z]{2})\b/g)]
  const m = all[all.length - 1]
  return m ? `${m[1].trim()}, ${m[2]}` : ''
}

export interface Hos { status: string; driveLeftMin: number | null; shiftLeftMin: number | null; cycleLeftMin: number | null; breakLeftMin: number | null }

/**
 * Hours until delivery for `drive` hours of driving left, counting the driver's legal limits: the 30-minute break
 * after 8 hours of driving and a 10-hour reset when today's drive or shift time runs out (11 h a day after that).
 */
export function etaHours(drive: number, hos: Hos | null | undefined): { hours: number; rest: boolean } {
  if (drive <= 0) return { hours: 0, rest: false }
  const left = (m: number | null | undefined, max: number) => (m == null ? max : Math.max(0, m / 60))
  let today = hos && hos.status !== 'off_duty' && hos.status !== 'sleeper' ? Math.min(left(hos.driveLeftMin, 11), left(hos.shiftLeftMin, 14)) : 11
  let brk = hos ? left(hos.breakLeftMin, 8) : 8
  let need = drive, hours = 0, rest = false
  while (need > 0.01) {
    if (today <= 0.01) { hours += 10; rest = true; today = 11; brk = 8; continue }
    const run = Math.min(need, today, brk)
    hours += run; need -= run; today -= run; brk -= run
    if (need > 0.01 && brk <= 0.01 && today > 0.01) { hours += 0.5; brk = 8 }
  }
  return { hours, rest }
}

/** "8:40 PM" today, "Thu 6:10 AM" another day. */
export function clockAt(ms: number): string {
  const d = new Date(ms)
  const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return new Date().toDateString() === d.toDateString() ? t : `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${t}`
}

/** "just now", "4 min ago", "3 h ago". */
export function agoText(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
export const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]
