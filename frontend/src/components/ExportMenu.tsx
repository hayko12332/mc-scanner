import { useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from './Icon'

export type ExportFormat = 'xlsx' | 'sheets' | 'csv' | 'vcf' | 'print'

const OPTIONS: { id: ExportFormat; icon: IconName; title: string; hint: string }[] = [
  { id: 'xlsx', icon: 'file', title: 'Excel (.xlsx)', hint: 'Formatted sheet with filters' },
  { id: 'sheets', icon: 'database', title: 'Google Sheets', hint: 'Copies the table and opens a new sheet' },
  { id: 'csv', icon: 'download', title: 'CSV', hint: 'For any CRM or dialer' },
  { id: 'vcf', icon: 'phone', title: 'Phone contacts (.vcf)', hint: 'Import all carriers into your phone' },
  { id: 'print', icon: 'copy', title: 'Print / PDF', hint: 'Call sheet with a notes column' },
]

/** "Export ▾" button with a menu of formats. */
export function ExportMenu({ count, onExport }: { count: number; onExport: (f: ExportFormat) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    addEventListener('mousedown', close)
    addEventListener('keydown', close)
    return () => { removeEventListener('mousedown', close); removeEventListener('keydown', close) }
  }, [open])
  return (
    <div className="export" ref={ref}>
      <button className="primary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="download" size={16} />Export {count.toLocaleString('en-US')}<Icon name="chevron" size={14} />
      </button>
      {open && (
        <div className="export-menu" role="menu">
          {OPTIONS.map((o) => (
            <button key={o.id} role="menuitem" onClick={() => { setOpen(false); onExport(o.id) }}>
              <span className="export-ico"><Icon name={o.icon} size={16} /></span>
              <span><b>{o.title}</b><small>{o.hint}</small></span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
