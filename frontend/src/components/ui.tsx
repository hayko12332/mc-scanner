import type { ReactNode } from 'react'

type Tone = 'ok' | 'bad' | 'warn'

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>
}

const AUTHORITY: Record<string, [string, Tone]> = {
  A: ['ACTIVE', 'ok'],
  I: ['INACTIVE', 'bad'],
  P: ['PENDING', 'warn'],
  N: ['NONE', 'bad'],
}

/** Pill for an FMCSA status code (A / I / P / N). */
export function StatusPill({ code }: { code: string | null }) {
  const [label, tone] = AUTHORITY[code ?? ''] ?? [code || '—', 'bad']
  return <Pill tone={tone}>{label}</Pill>
}

/** Definition list that skips empty values. */
export function KeyValues({ items }: { items: [string, ReactNode][] }) {
  const shown = items.filter(([, v]) => v != null && v !== '' && v !== false)
  return (
    <dl className="kv">
      {shown.map(([k, v]) => (
        <div key={k} className="kv-row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function DetailBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="detail-box">
      <h4>{title}</h4>
      {children}
    </section>
  )
}
