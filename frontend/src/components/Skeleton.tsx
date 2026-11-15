import type { CSSProperties, ReactNode } from 'react'

/*
 * Loading placeholders: grey shapes of what is coming, with a soft shimmer (like Linear, Stripe, Notion),
 * instead of "Loading…" text. Screen readers hear one short status message instead of the shapes.
 */

/** One grey bar or block. Width/height in px or any CSS length. */
export function Sk({ w = '100%', h = 12, r, style, className = '' }: { w?: number | string; h?: number | string; r?: number; style?: CSSProperties; className?: string }) {
  return <span className={`sk ${className}`} style={{ width: w, height: h, borderRadius: r, ...style }} aria-hidden="true" />
}

/** A few lines of text, the last one shorter. */
export function SkLines({ lines = 3, gap = 8 }: { lines?: number; gap?: number }) {
  return (
    <span className="sk-lines" style={{ gap }} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => <Sk key={i} w={i === lines - 1 ? '62%' : '100%'} h={11} />)}
    </span>
  )
}

/** Wrapper that tells screen readers what is loading. */
export function Loading({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`sk-wrap ${className}`} role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

/** The dispatch board while it opens: sidebar, status tabs, KPI tiles and table rows. */
export function BoardSkeleton({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <div className={`work app theme-${theme}`}>
      <aside className="w-side">
        <span className="w-side-logo"><img src="/logo.svg" alt="" width="24" height="24" /><b>HaulPanel</b></span>
        <div className="w-org sk-dark"><Sk w={32} h={32} r={8} /><span className="w-org-text"><Sk w="70%" h={11} /><Sk w="45%" h={9} style={{ marginTop: 6 }} /></span></div>
        <div className="w-nav sk-dark">
          {[70, 88, 64, 54, 84].map((w, i) => <span key={i} className="sk-nav"><Sk w={16} h={16} r={4} /><Sk w={w} h={11} /></span>)}
        </div>
      </aside>
      <main className="w-main">
        <Loading label="Opening your dispatch board…" className="w-body">
          <div className="sk-row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
            <span className="sk-row">{[40, 70, 80, 76, 70, 50].map((w, i) => <Sk key={i} w={w} h={12} />)}</span>
            <span className="sk-row"><Sk w={84} h={32} r={7} /><Sk w={84} h={32} r={7} /><Sk w={110} h={32} r={7} /></span>
          </div>
          <div className="sk-row" style={{ marginBottom: 12 }}><Sk w={300} h={32} r={7} /><Sk w={160} h={32} r={7} /><Sk w={160} h={32} r={7} /></div>
          <div className="sk-kpis">
            {Array.from({ length: 5 }, (_, i) => <div key={i}><Sk w="45%" h={10} /><Sk w="60%" h={20} style={{ margin: '10px 0 8px' }} /><Sk w="75%" h={9} /></div>)}
          </div>
          <TableSkeleton rows={8} />
        </Loading>
      </main>
    </div>
  )
}

/** Table rows: two-line cells like the load board. */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="sk-table">
      <div className="sk-tr sk-th">{[50, 90, 120, 90, 50, 60].map((w, i) => <Sk key={i} w={w} h={10} />)}</div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="sk-tr">
          {[[44, 26], [120, 70], [190, 80], [110, 70], [60, 40], [74, 0]].map(([a, b], j) => (
            <span key={j} className="sk-cell">
              {j === 5 ? <Sk w={a} h={22} r={99} /> : <><Sk w={a} h={11} /><Sk w={b} h={9} /></>}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}

/** A company card while a lookup runs. */
export function CompanySkeleton() {
  return (
    <Loading label="Searching FMCSA…" className="sk-card">
      <div className="sk-row" style={{ justifyContent: 'space-between' }}>
        <span style={{ display: 'grid', gap: 8, flex: 1 }}><Sk w="38%" h={18} /><Sk w="55%" h={11} /></span>
        <Sk w={92} h={24} r={99} />
      </div>
      <div className="sk-row" style={{ margin: '18px 0' }}><Sk w={130} h={26} r={99} /><Sk w={150} h={26} r={99} /><Sk w={110} h={26} r={99} /></div>
      <div className="sk-grid3">
        {Array.from({ length: 6 }, (_, i) => <span key={i} style={{ display: 'grid', gap: 7 }}><Sk w="40%" h={9} /><Sk w="70%" h={12} /></span>)}
      </div>
    </Loading>
  )
}

/** Lead rows while the first results come in. */
export function LeadRowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Loading label="Loading new leads…">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="sk-lead">
          <span className="sk-cell"><Sk w={220} h={13} /><span className="sk-row"><Sk w={86} h={20} r={6} /><Sk w={100} h={20} r={6} /></span></span>
          <span className="sk-cell"><Sk w={130} h={11} /><Sk w={170} h={11} /></span>
          <span className="sk-cell"><Sk w={110} h={11} /><Sk w={80} h={9} /></span>
          <span className="sk-cell"><Sk w={60} h={11} /><Sk w={80} h={9} /></span>
        </div>
      ))}
    </Loading>
  )
}
