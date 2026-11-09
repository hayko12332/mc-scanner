interface Props {
  current: string
  checked: number
  found: number
  withPhone: number
  saferRejected: number
  rate: number
}

export function StatsBar(p: Props) {
  const stats: [string, string][] = [
    ['Carriers found', p.found.toLocaleString('en-US')],
    ['With phone', p.withPhone.toLocaleString('en-US')],
    ['MCs checked', p.checked.toLocaleString('en-US')],
    ['Rejected by SAFER', p.saferRejected.toLocaleString('en-US')],
    ['Speed', `${p.rate} MC/s`],
    ['Now at', p.current.split(' … ')[0]],
  ]
  return (
    <div className="stats panel">
      {stats.map(([label, value]) => (
        <div key={label} className="stat">
          <span>{label}</span>
          <b>{value}</b>
        </div>
      ))}
    </div>
  )
}
