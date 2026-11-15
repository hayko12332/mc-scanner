import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type Ref } from 'react'
import { crm, looksLikePlace } from '../../lib/crm'

const cache = new Map<string, string[]>()

/** US cities that start with what is typed, from the server's place list (asked once per text). */
async function lookup(q: string): Promise<string[]> {
  const k = q.trim().toLowerCase()
  if (cache.has(k)) return cache.get(k)!
  const hits = await crm.places(k).catch(() => [] as string[])
  cache.set(k, hits)
  return hits
}

/**
 * A "City, ST" field that suggests places while you type, like a maps search box: the cities from your
 * earlier loads first, then any US city. Arrows move, Enter or a click picks, Escape closes the list.
 */
export function PlaceInput({ value, onChange, onPick, onBlur, recent = [], placeholder = 'City, ST', inputRef }: {
  value: string
  onChange: (v: string) => void
  /** A suggestion was chosen (the value is final). */
  onPick?: (v: string) => void
  onBlur?: () => void
  recent?: string[]
  placeholder?: string
  inputRef?: Ref<HTMLInputElement>
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [remote, setRemote] = useState<string[]>([])
  const q = value.trim().toLowerCase()

  useEffect(() => {
    if (!open || q.length < 2) return setRemote([])
    let stale = false
    const t = setTimeout(() => { void lookup(q).then((r) => { if (!stale) setRemote(r) }) }, 120)
    return () => { stale = true; clearTimeout(t) }
  }, [q, open])

  const mine = q ? recent.filter((p) => p.toLowerCase().startsWith(q)).slice(0, 3) : []
  const seen = new Set(mine.map((p) => p.toLowerCase()))
  const list = [...mine, ...remote.filter((p) => !seen.has(p.toLowerCase()))].slice(0, 8)
    // Nothing to suggest once the field already holds exactly the one place.
    .filter((p, _, all) => !(all.length === 1 && p.toLowerCase() === q))
  const shown = open && list.length > 0

  const pick = (p: string) => {
    onChange(p)
    setOpen(false)
    setActive(-1)
    onPick?.(p)
  }
  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!shown) {
      if (e.key === 'ArrowDown' && list.length) { setOpen(true); e.preventDefault() }
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = list.length
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n))
    } else if (e.key === 'Enter' && (active >= 0 || !looksLikePlace(value))) {
      // Pick (the highlighted one, or the first for a half-typed city), and don't let the form take this Enter as "save".
      e.preventDefault(); e.stopPropagation()
      pick(list[Math.max(0, active)])
    } else if (e.key === 'Escape') {
      // Close only the list, not the panel around it.
      e.preventDefault(); e.stopPropagation(); e.nativeEvent.stopImmediatePropagation()
      setOpen(false)
    } else if (e.key === 'Tab' && active >= 0) {
      pick(list[active])
    }
  }

  const typed = value.trim()
  return (
    <div className="pi">
      <div className="ld-input">
        <input ref={inputRef} value={value} placeholder={placeholder} autoComplete="off" spellCheck={false}
          role="combobox" aria-expanded={shown} aria-autocomplete="list"
          onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1) }}
          onFocus={() => setOpen(true)}
          onBlur={() => { setOpen(false); setActive(-1); onBlur?.() }}
          onKeyDown={onKey} />
      </div>
      {shown && (
        <ul className="pi-list" role="listbox">
          {list.map((p, i) => {
            const head = p.toLowerCase().startsWith(typed.toLowerCase()) ? p.slice(0, typed.length) : ''
            const [city, st] = [p.slice(head.length).replace(/, [A-Z]{2}$/, ''), p.match(/, ([A-Z]{2})$/)?.[1] ?? '']
            return (
              <li key={p} role="option" aria-selected={i === active} className={i === active ? 'on' : ''}
                onMouseDown={(e) => { e.preventDefault(); pick(p) }}
                onMouseEnter={() => setActive(i)}>
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="12" cy="9.5" r="2.4" fill="currentColor" /></svg>
                <span><b>{head}</b>{city}</span>
                {st && <em>{st}</em>}
                {i < mine.length && <small>recent</small>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
