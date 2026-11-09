import { useEffect, useState, type CSSProperties } from 'react'
import { HUBS, US_DOTS, US_OUTLINE } from './usMap'

const LABELED = new Set(['Seattle', 'Los Angeles', 'Denver', 'Dallas', 'Chicago', 'Atlanta', 'Miami', 'New York'])

const LANES: [string, string][] = [
  ['Los Angeles', 'Dallas'], ['Seattle', 'Denver'], ['Denver', 'Chicago'], ['Chicago', 'New York'],
  ['Dallas', 'Atlanta'], ['Atlanta', 'Miami'], ['Houston', 'Chicago'], ['San Francisco', 'Salt Lake City'],
  ['Kansas City', 'Atlanta'], ['New York', 'Atlanta'], ['Los Angeles', 'Phoenix'], ['Minneapolis', 'Chicago'],
  ['Phoenix', 'Houston'], ['Salt Lake City', 'Denver'], ['Nashville', 'New York'],
]

/** Quadratic arc bowing away from the straight line between two hubs. */
function arc(a: string, b: string) {
  const [x1, y1] = HUBS[a]
  const [x2, y2] = HUBS[b]
  const len = Math.hypot(x2 - x1, y2 - y1)
  const bow = 0.18 * len
  const nx = (y1 - y2) / len
  const ny = (x2 - x1) / len
  // Bow "up" (towards the top of the map) whichever direction the lane goes.
  const s = ny < 0 ? 1 : -1
  const cx = (x1 + x2) / 2 + nx * bow * s
  const cy = (y1 + y2) / 2 + ny * bow * s
  return `M${x1} ${y1} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2} ${y2}`
}

/** Examples of what the scanner finds; names and contacts are masked on purpose. */
const FEED: [string, string, string][] = [
  ['B•••• Express', 'MC-1000012 · TX', '(214) •••-••37'],
  ['S•••• Trucking', 'MC-1000047 · IL', '(773) •••-••91'],
  ['M•••• Logistics', 'MC-1000083 · GA', '(404) •••-••15'],
  ['R•••• Freight', 'MC-1000121 · OH', '(614) •••-••02'],
  ['A•••• Transport', 'MC-1000158 · FL', '(305) •••-••64'],
  ['K•••• Carriers', 'MC-1000190 · CA', '(909) •••-••88'],
]

/**
 * Notification-style feed: every few seconds a new carrier drops in on top and the others glide down;
 * the card that leaves fades out. Cards keep their identity (key) so they move instead of re-rendering.
 */
function LiveFeed() {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = setInterval(() => setTick((n) => n + 1), 3400)
    return () => clearInterval(t)
  }, [])
  const at = (n: number) => FEED[((n % FEED.length) + FEED.length) % FEED.length]
  // Three cards are shown; a new one drops in on top, the others glide down and the fourth fades out.
  const cards = [0, 1, 2, 3].map((i) => ({ id: tick - i, i, data: at(tick - i) }))
  return (
    <div className="feed" aria-label="Example carriers found by a scan (contacts hidden)">
      <div className="feed-head"><span className="pulse" /> Carriers found · live example</div>
      <div className="feed-list">
        {cards.map(({ id, i, data: [name, meta, phone] }) => (
          <div key={id} className={`feed-card ${i === 0 ? 'enter' : ''} ${i === 3 ? 'leave' : ''}`} style={{ '--i': i } as CSSProperties}>
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
    </div>
  )
}

/** Dot-matrix map of the US with glowing freight lanes, pulsing hubs and a live feed of found carriers. */
export function HeroNetwork() {
  return (
    <div className="network">
      <div className="network-glow" aria-hidden="true" />
      <div className="map-window">
      <div className="map-bar">
        <span className="map-title"><span className="pulse" /> Live freight network</span>
        <span className="map-meta">15 hubs · 15 lanes</span>
      </div>
      <svg className="network-map" viewBox="0 0 975 610" role="img" aria-label="Map of freight lanes across the United States">
        <defs>
          <linearGradient id="lane-glow" x1="0" x2="1">
            <stop offset="0" stopColor="#60a5fa" stopOpacity="0" />
            <stop offset="0.5" stopColor="#93c5fd" />
            <stop offset="1" stopColor="#22d3ee" />
          </linearGradient>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <path d={US_OUTLINE} className="us-shape" />
        <path d={US_DOTS} className="us-dots" />
        {LANES.map(([a, b], i) => {
          const d = arc(a, b)
          const style = { '--dur': `${3.4 + (i % 5) * 0.6}s`, '--delay': `${(i * 0.41) % 3}s` } as CSSProperties
          return (
            <g key={a + b}>
              <path d={d} className="lane-base" />
              <path d={d} className="lane-flow" pathLength={100} style={style} filter="url(#glow)" />
            </g>
          )
        })}
        {Object.entries(HUBS).map(([name, [x, y]], i) => (
          <g key={name} style={{ '--delay': `${(i * 0.29) % 2.4}s` } as CSSProperties}>
            <circle cx={x} cy={y} r="14" className="hub-ring" />
            <circle cx={x} cy={y} r="5" className="hub-dot" />
            {LABELED.has(name) && <text x={x + 10} y={y - 10} className="hub-label">{name}</text>}
          </g>
        ))}
      </svg>
      <LiveFeed />
      </div>
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
