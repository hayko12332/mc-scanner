import { useEffect, useState, type CSSProperties } from 'react'

/** Freight hubs placed by longitude/latitude (projected into a 600×380 box) so the network reads as the US. */
const CITIES: Record<string, [number, number]> = {
  Seattle: [47.6, -122.3], 'San Francisco': [37.8, -122.4], 'Los Angeles': [34.05, -118.2], Phoenix: [33.4, -112.1],
  'Salt Lake City': [40.8, -111.9], Denver: [39.7, -105], Dallas: [32.8, -96.8], Houston: [29.8, -95.4],
  'Kansas City': [39.1, -94.6], Minneapolis: [44.98, -93.3], Chicago: [41.9, -87.6], Nashville: [36.2, -86.8],
  Atlanta: [33.7, -84.4], Miami: [25.8, -80.2], 'New York': [40.7, -74],
}
const LABELED = new Set(['Seattle', 'Los Angeles', 'Denver', 'Dallas', 'Chicago', 'Atlanta', 'Miami', 'New York'])

const LANES: [string, string][] = [
  ['Los Angeles', 'Dallas'], ['Seattle', 'Denver'], ['Denver', 'Chicago'], ['Chicago', 'New York'],
  ['Dallas', 'Atlanta'], ['Atlanta', 'Miami'], ['Houston', 'Chicago'], ['San Francisco', 'Salt Lake City'],
  ['Kansas City', 'Atlanta'], ['New York', 'Atlanta'], ['Los Angeles', 'Phoenix'], ['Minneapolis', 'Chicago'],
  ['Phoenix', 'Houston'], ['Salt Lake City', 'Denver'], ['Nashville', 'New York'],
]

const xy = ([lat, lon]: [number, number]): [number, number] => [((lon + 125) / 58) * 560 + 20, ((49 - lat) / 24) * 340 + 20]

/** Quadratic arc bowing "upwards" between two hubs. */
function arc(a: string, b: string) {
  const [x1, y1] = xy(CITIES[a])
  const [x2, y2] = xy(CITIES[b])
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const len = Math.hypot(x2 - x1, y2 - y1)
  const cx = mx + ((y1 - y2) / len) * len * 0.22
  const cy = my - (Math.abs(x2 - x1) / len) * len * 0.22
  return `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`
}

/** Examples of what the scanner finds; names and contacts are masked on purpose. */
const FEED: [string, string, string][] = [
  ['B•••• Express LLC', 'MC-1000012 · TX · 6 trucks', '(214) •••-••37'],
  ['S•••• Trucking Inc', 'MC-1000047 · IL · 3 trucks', '(773) •••-••91'],
  ['M•••• Logistics LLC', 'MC-1000083 · GA · 12 trucks', '(404) •••-••15'],
  ['R•••• Freight Co', 'MC-1000121 · OH · 4 trucks', '(614) •••-••02'],
  ['A•••• Transport LLC', 'MC-1000158 · FL · 9 trucks', '(305) •••-••64'],
  ['K•••• Carriers Inc', 'MC-1000190 · CA · 21 trucks', '(909) •••-••88'],
]

/** Live-looking feed: every few seconds a new verified carrier slides in on top. */
function LiveFeed() {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = setInterval(() => setTick((n) => n + 1), 2600)
    return () => clearInterval(t)
  }, [])
  const items = [0, 1, 2].map((i) => ({ key: tick - i, data: FEED[(((tick - i) % FEED.length) + FEED.length) % FEED.length], i }))
  return (
    <div className="feed" aria-label="Example carriers found by a scan (contacts hidden)">
      <div className="feed-head"><span className="pulse" /> Live scan · example</div>
      {items.map(({ key, data: [name, meta, phone], i }) => (
        <div key={key} className={`feed-card pos-${i}`}>
          <span className="feed-check">✓</span>
          <div className="feed-body">
            <b>{name}</b>
            <span>{meta}</span>
          </div>
          <div className="feed-side">
            <span className="feed-pill">SAFER ✓</span>
            <span className="feed-phone">{phone}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Animated US freight network: lanes draw with moving light, hubs pulse, a live feed of found carriers floats on top. */
export function HeroNetwork() {
  return (
    <div className="network" aria-hidden="false">
      <svg className="network-map" viewBox="0 0 600 380" role="img" aria-label="Freight lanes between US cities">
        <defs>
          <linearGradient id="lane-glow" x1="0" x2="1">
            <stop offset="0" stopColor="#60a5fa" stopOpacity="0" />
            <stop offset="0.5" stopColor="#93c5fd" />
            <stop offset="1" stopColor="#22d3ee" />
          </linearGradient>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {LANES.map(([a, b], i) => {
          const d = arc(a, b)
          const style = { '--dur': `${3.2 + (i % 5) * 0.55}s`, '--delay': `${(i * 0.37) % 3}s` } as CSSProperties
          return (
            <g key={a + b}>
              <path d={d} className="lane-base" />
              <path d={d} className="lane-flow" pathLength={100} style={style} filter="url(#glow)" />
            </g>
          )
        })}
        {Object.entries(CITIES).map(([name, ll], i) => {
          const [x, y] = xy(ll)
          return (
            <g key={name} className="hub" style={{ '--delay': `${(i * 0.29) % 2.4}s` } as CSSProperties}>
              <circle cx={x} cy={y} r="9" className="hub-ring" />
              <circle cx={x} cy={y} r="3.4" className="hub-dot" />
              {LABELED.has(name) && <text x={x + 7} y={y - 7} className="hub-label">{name}</text>}
            </g>
          )
        })}
      </svg>
      <LiveFeed />
    </div>
  )
}

/** Numbers that count up once when they scroll into view. */
export function CountUp({ to, suffix = '', prefix = '' }: { to: number; suffix?: string; prefix?: string }) {
  const [value, setValue] = useState(0)
  const [el, setEl] = useState<HTMLSpanElement | null>(null)
  useEffect(() => {
    if (!el) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
      setValue(to)
      return
    }
    let raf = 0
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return
      io.disconnect()
      const start = performance.now()
      const step = (now: number) => {
        const p = Math.min(1, (now - start) / 1400)
        setValue(Math.round(to * (1 - Math.pow(1 - p, 3))))
        if (p < 1) raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
    }, { threshold: 0.4 })
    io.observe(el)
    return () => { io.disconnect(); cancelAnimationFrame(raf) }
  }, [el, to])
  return <span ref={setEl}>{prefix}{value.toLocaleString('en-US')}{suffix}</span>
}
