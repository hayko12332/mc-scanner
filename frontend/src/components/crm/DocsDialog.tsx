import { useEffect, useRef, useState } from 'react'
import { shortDate, usd, words, isBroker, type CrmState, type DeliveryDoc, type DocMatch, type FileKind, type Load } from '../../lib/crm'
import { prepare } from './LoadDocs'
import { place } from './LoadsTable'

// "BOL / POD": drop a stack of BOLs and PODs (PDFs or phone photos). AI reads each one — reference numbers, lane,
// dates, the receiver's signature, shortage or damage notes — and the board finds the load it belongs to. Nothing is
// saved until "Save": then each document is attached to its load, and signed PODs mark their loads delivered.

interface Item {
  key: string; name: string; blob: Blob | null; state: 'reading' | 'ready' | 'error' | 'saved'; error?: string
  doc?: DeliveryDoc; match?: DocMatch; loadId: string; kind: FileKind; deliver: boolean
}

const open = (l: Load) => l.status === 'booked' || l.status === 'in_transit'

export function DocsDialog({ state, close, read, upload, apply, done }: {
  state: CrmState
  close: () => void
  read: (f: Blob) => Promise<{ doc: DeliveryDoc; match: DocMatch }>
  upload: (loadId: number, f: Blob, name: string, kind: FileKind) => Promise<unknown>
  /** After the uploads: loads to mark delivered, and the receiver's exceptions to keep in each load's notes. */
  apply: (changes: { load: Load; delivered: boolean; note: string }[]) => Promise<unknown>
  done: (note: string) => void
}) {
  const w = words(isBroker(state))
  const [items, setItems] = useState<Item[]>([])
  const [saving, setSaving] = useState(false)
  const [drag, setDrag] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const loadById = new Map(state.loads.map((l) => [l.id, l]))
  const set = (key: string, patch: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [close])

  const add = async (files: File[]) => {
    const fresh: Item[] = files.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, name: f.name, blob: null, state: 'reading', loadId: '', kind: 'other', deliver: false }))
    setItems((xs) => [...xs, ...fresh])
    // Two at a time: quick, without hitting the AI limits.
    let next = 0
    const work = async () => {
      while (next < files.length) {
        const i = next++
        const it = fresh[i]
        try {
          const { blob, name } = await prepare(files[i])
          if (blob.size > 10 * 1024 * 1024) throw new Error('Over 10 MB')
          const r = await read(blob)
          const l = r.match.loadId != null ? loadById.get(r.match.loadId) : undefined
          const kind: FileKind = r.doc.kind === 'pod' ? 'pod' : r.doc.kind === 'bol' ? 'bol' : 'other'
          set(it.key, {
            blob, name, state: 'ready', doc: r.doc, match: r.match, kind,
            loadId: r.match.loadId != null ? String(r.match.loadId) : '', deliver: kind === 'pod' && r.doc.signedByReceiver && !!l && open(l),
          })
        } catch (e) {
          set(it.key, { state: 'error', error: (e as Error).message })
        }
      }
    }
    await Promise.all([work(), work()])
  }

  const ready = items.filter((x) => x.state === 'ready' && x.loadId && x.blob)
  const save = async () => {
    setSaving(true)
    let saved = 0
    const changes = new Map<number, { load: Load; delivered: boolean; note: string }>()
    for (const it of ready) {
      try {
        await upload(Number(it.loadId), it.blob!, it.name, it.kind)
        saved++
        const l = loadById.get(Number(it.loadId))
        if (l) {
          const c = changes.get(l.id) ?? { load: l, delivered: false, note: '' }
          if (it.deliver && open(l)) c.delivered = true
          if (it.doc?.exceptions) c.note = [c.note, `${it.kind === 'pod' ? 'POD' : it.kind.toUpperCase()}: ${it.doc.exceptions}`].filter(Boolean).join(' · ')
          changes.set(l.id, c)
        }
        set(it.key, { state: 'saved' })
      } catch (e) {
        set(it.key, { state: 'error', error: (e as Error).message })
      }
    }
    const todo = [...changes.values()].filter((c) => c.delivered || c.note)
    if (todo.length) await apply(todo).catch(() => undefined)
    const toDeliver = todo.filter((c) => c.delivered)
    const noted = todo.filter((c) => c.note).length
    setSaving(false)
    const left = items.filter((x) => x.state === 'ready' && !x.loadId).length
    done(`${saved} ${saved === 1 ? 'document' : 'documents'} attached${toDeliver.length ? ` · ${toDeliver.length} ${toDeliver.length === 1 ? 'load' : 'loads'} marked delivered` : ''}${noted ? ` · exceptions kept in the notes` : ''}${left ? ` · ${left} without a load left out` : ''}`)
  }

  const label = (l: Load) => `${shortDate(l.date)} · ${l.broker || `No ${w.customerLower}`}${l.pro ? ` #${l.pro}` : ''} · ${place(l.origin) || '—'} → ${place(l.destination) || '—'}`
  const recent = [...state.loads].filter((l) => l.id > 0).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 300)

  return (
    <div className="ld-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <aside className="ld dd" role="dialog" aria-label="Add BOL and POD">
        <header className="ld-head">
          <div>
            <small>Documents</small>
            <h2>Add BOLs and PODs</h2>
            <p>AI reads each one and finds its load. You check, then save.</p>
          </div>
          <button className="ld-x" aria-label="Close" onClick={close}>×</button>
        </header>
        <div className="ld-body">
          <button type="button" className={`dd-drop ${drag ? 'on' : ''}`} onClick={() => picker.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) void add([...e.dataTransfer.files]) }}>
            <b>Drop BOLs and PODs here</b>
            <small>PDFs or phone photos · as many as you have · nothing is saved until you press Save</small>
          </button>
          <input ref={picker} type="file" hidden multiple accept="application/pdf,image/*"
            onChange={(e) => { if (e.target.files?.length) void add([...e.target.files]); e.target.value = '' }} />

          {items.map((it) => {
            const l = it.loadId ? loadById.get(Number(it.loadId)) : undefined
            const cands = (it.match?.candidates ?? []).map((c) => loadById.get(c.loadId)).filter((x): x is Load => !!x)
            const d = it.doc
            return (
              <div key={it.key} className={`dd-item ${it.state}`}>
                <div className="dd-top">
                  <b title={it.name}>{it.name}</b>
                  {it.state === 'reading' && <span className="dd-tag">Reading…</span>}
                  {it.state === 'saved' && <span className="dd-tag ok">✓ Saved</span>}
                  {it.state === 'error' && <span className="dd-tag bad">{it.error}</span>}
                  {it.state !== 'reading' && it.state !== 'saved' && <button className="dc-x" aria-label={`Remove ${it.name}`} onClick={() => setItems((xs) => xs.filter((x) => x.key !== it.key))}>×</button>}
                </div>
                {d && it.state !== 'error' && (
                  <>
                    <p className="dd-read">
                      {[d.references.slice(0, 4).join(', '), (d.origin || d.destination) && `${d.origin || '—'} → ${d.destination || '—'}`,
                        d.deliveryDate && `delivered ${shortDate(d.deliveryDate)}`, d.pieces, d.weight].filter(Boolean).join(' · ') || 'Nothing legible on it'}
                    </p>
                    {d.kind === 'pod' && <p className={d.signedByReceiver ? 'dd-ok' : 'dd-warn'}>{d.signedByReceiver ? `✓ Signed by the receiver${d.receiver ? ` (${d.receiver})` : ''}` : '⚠ No receiver signature found'}</p>}
                    {d.exceptions && <p className="dd-warn">⚠ {d.exceptions} <small>— goes into the load’s notes</small></p>}
                    <div className="dd-row">
                      <select aria-label="Document type" value={it.kind} disabled={it.state === 'saved'} onChange={(e) => set(it.key, { kind: e.target.value as FileKind, deliver: e.target.value === 'pod' && !!l && open(l) && !!d.signedByReceiver })}>
                        <option value="bol">BOL</option><option value="pod">POD</option><option value="other">Other</option>
                      </select>
                      <select aria-label="Load" className={it.loadId ? '' : 'dd-need'} value={it.loadId} disabled={it.state === 'saved'}
                        onChange={(e) => { const nl = loadById.get(Number(e.target.value)); set(it.key, { loadId: e.target.value, deliver: it.kind === 'pod' && !!nl && open(nl) && !!d.signedByReceiver }) }}>
                        <option value="">— Pick the load —</option>
                        {cands.length > 0 && <optgroup label="Best matches">{cands.map((c) => <option key={c.id} value={c.id}>{label(c)}</option>)}</optgroup>}
                        <optgroup label="All loads">{recent.filter((x) => !cands.includes(x)).map((x) => <option key={x.id} value={x.id}>{label(x)}</option>)}</optgroup>
                      </select>
                    </div>
                    <small className="dd-why">{it.loadId && it.match?.loadId === Number(it.loadId) ? it.match.why : it.loadId ? 'Picked by you' : it.match?.why}{l ? ` · ${usd(l.rate)}` : ''}</small>
                    {it.kind === 'pod' && l && open(l) && it.state !== 'saved' && (
                      <label className="iv-remind"><input type="checkbox" checked={it.deliver} onChange={(e) => set(it.key, { deliver: e.target.checked })} />Mark this load delivered</label>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
        <footer className="ld-foot">
          <button className="ghost" onClick={close}>Close</button>
          <button className="primary" disabled={saving || !ready.length || items.some((x) => x.state === 'reading')} onClick={() => void save()}>
            {saving ? 'Saving…' : ready.length ? `Save ${ready.length} ${ready.length === 1 ? 'document' : 'documents'}` : 'Save'}
          </button>
        </footer>
      </aside>
    </div>
  )
}
