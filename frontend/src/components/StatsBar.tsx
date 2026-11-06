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
    ['Current MC', p.current],
    ['MCs checked', p.checked.toLocaleString('en-US')],
    ['Found', p.found.toLocaleString('en-US')],
    ['With phone', p.withPhone.toLocaleString('en-US')],
    ['Rejected by SAFER', p.saferRejected.toLocaleString('en-US')],
    ['Speed', `${p.rate} MC/s`],
  ]
  return (
    <div className="panel stats">
      {stats.map(([label, value]) => (
        <div key={label}>
          {label}: <b>{value}</b>
        </div>
      ))}
    </div>
  )
}
