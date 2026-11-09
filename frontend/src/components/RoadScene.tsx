/** Truck in MC Scanner colors; wheels spin while it drives. */
function Truck() {
  return (
    <svg className="truck-svg" viewBox="0 0 150 64" width="150" height="64" aria-hidden="true">
      {/* Trailer */}
      <rect x="2" y="6" width="92" height="40" rx="5" fill="#ffffff" stroke="#cbd5e1" />
      <rect x="2" y="6" width="92" height="7" rx="3" fill="#2563eb" />
      <text x="48" y="36" textAnchor="middle" fontSize="15" fontWeight="800" fill="#1e40af" fontFamily="Inter, Arial, sans-serif">
        MC
      </text>
      {/* Cab */}
      <path d="M98 18h24c4 0 7 2 9 5l11 15c1 2 2 4 2 6v4H98z" fill="#2563eb" />
      <path d="M104 22h16l9 12h-25z" fill="#bfdbfe" />
      <rect x="0" y="46" width="146" height="5" rx="2.5" fill="#334155" />
      {/* Wheels */}
      {[20, 44, 122].map((cx) => (
        <g key={cx} className="wheel" style={{ transformOrigin: `${cx}px 54px` }}>
          <circle cx={cx} cy="54" r="9" fill="#0f172a" />
          <circle cx={cx} cy="54" r="3.5" fill="#cbd5e1" />
          <rect x={cx - 0.75} y="46" width="1.5" height="16" fill="#475569" />
        </g>
      ))}
    </svg>
  )
}

/** Decorative dispatch lane: pickup → delivery with a truck driving between them. */
export function RoadScene() {
  return (
    <div className="road-scene" aria-hidden="true">
      <div className="lane-pin pickup">
        <span className="pin-dot" />
        <span className="pin-label"><b>Pickup</b> Chicago, IL</span>
      </div>
      <div className="lane-pin delivery">
        <span className="pin-dot" />
        <span className="pin-label"><b>Delivery</b> Dallas, TX</span>
      </div>
      <div className="load-tag">Load #4821 · Dry van · 42,000 lb · <b>$2,350</b></div>
      <div className="road">
        <div className="road-lines" />
      </div>
      <div className="truck">
        <Truck />
      </div>
    </div>
  )
}
