import { useEffect, useRef, useState, type DragEvent } from 'react'
import { FILE_KINDS, shortDate, type CrmFile, type CrmState, type FileKind, type InvoiceSend, type Load } from '../../lib/crm'

export interface DocsApi {
  uploadFile: (loadId: number, file: Blob, name: string, kind: FileKind) => Promise<CrmFile>
  fileUrl: (id: number) => string
  setFileKind: (id: number, kind: FileKind) => Promise<unknown>
  removeFile: (id: number) => Promise<unknown>
  invoicePdfUrl: (loadId: number, attach: number[]) => string
  sendInvoice: (loadId: number, v: InvoiceSend) => Promise<{ number: string }>
  setInvoiceReminders: (loadId: number, remind: boolean) => Promise<unknown>
}

const kindLabel = (k: FileKind) => FILE_KINDS.find(([id]) => id === k)?.[1] ?? 'Other'
const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

/** Guess what a document is from its file name. */
export function guessKind(name: string): FileKind {
  if (/\bpod\b|proof|deliver|signed/i.test(name)) return 'pod'
  if (/\bbol\b|lading|\bb\.o\.l/i.test(name)) return 'bol'
  if (/rate|confirm|\brc\b|tender/i.test(name)) return 'ratecon'
  if (/lumper|receipt/i.test(name)) return 'other'
  return 'other'
}

/** PDFs as they are; photos made small enough to email (JPEG, longest side 2200 px). */
async function prepare(file: File): Promise<{ blob: Blob; name: string }> {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return { blob: file, name: file.name }
  if (!file.type.startsWith('image/')) throw new Error('Attach a PDF or a photo (JPEG or PNG)')
  if ((file.type === 'image/jpeg' || file.type === 'image/png') && file.size < 2_500_000) return { blob: file, name: file.name }
  const bmp = await createImageBitmap(file).catch(() => { throw new Error('This photo format can’t be read here — save it as JPEG or PDF') })
  const scale = Math.min(1, 2200 / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob>((ok, bad) => canvas.toBlob((b) => (b ? ok(b) : bad(new Error('Could not read the photo'))), 'image/jpeg', 0.82))
  return { blob, name: file.name.replace(/\.[^.]+$/, '') + '.jpg' }
}

/**
 * Documents of a load — rate con, BOL, POD — kept with the load; and its invoice: preview the PDF, email it to the
 * broker with the documents in the same PDF, and let the board remind the broker while it stays unpaid.
 */
export function LoadDocs({ load, state, api, toast, changed, demo }: {
  load: Load; state: CrmState; api: DocsApi; toast: (m: string) => void; changed: () => void; demo: boolean
}) {
  const files = (state.files ?? []).filter((f) => f.loadId === load.id)
  const sent = state.invoices?.find((i) => i.loadId === load.id)
  const [busy, setBusy] = useState('')
  const [drag, setDrag] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const nextKind = useRef<FileKind | null>(null)

  const add = async (list: FileList | File[], kind: FileKind | null) => {
    for (const f of [...list]) {
      setBusy(`Uploading ${f.name}…`)
      try {
        const { blob, name } = await prepare(f)
        if (blob.size > 10 * 1024 * 1024) throw new Error(`${f.name} is over 10 MB`)
        await api.uploadFile(load.id, blob, name, kind ?? guessKind(f.name))
      } catch (e) {
        toast((e as Error).message)
      }
    }
    setBusy('')
    changed()
  }
  const pick = (kind: FileKind | null) => { nextKind.current = kind; picker.current?.click() }
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) void add(e.dataTransfer.files, null) }

  return (
    <>
      <section>
        <h3>Documents</h3>
        <div className={`dc-drop ${drag ? 'on' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
          {files.length > 0 && (
            <ul className="dc-list">
              {files.map((f) => (
                <li key={f.id}>
                  <span className={`dc-ico ${f.mime === 'application/pdf' ? 'pdf' : 'img'}`}>{f.mime === 'application/pdf' ? 'PDF' : 'IMG'}</span>
                  <a href={api.fileUrl(f.id)} target="_blank" rel="noopener" className="dc-name" title={f.name}>{f.name}</a>
                  <small>{size(f.size)} · {shortDate(f.createdAt.slice(0, 10))}</small>
                  <select aria-label="Document type" value={f.kind} onChange={(e) => void api.setFileKind(f.id, e.target.value as FileKind).then(changed)}>
                    {FILE_KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                  <button className="dc-x" title="Delete" aria-label={`Delete ${f.name}`}
                    onClick={() => { if (confirm(`Delete ${f.name}?`)) void api.removeFile(f.id).then(changed) }}>×</button>
                </li>
              ))}
            </ul>
          )}
          <div className="dc-add">
            {(['ratecon', 'bol', 'pod'] as FileKind[]).map((k) => (
              <button key={k} type="button" disabled={!!busy} onClick={() => pick(k)}>+ {kindLabel(k)}{files.some((f) => f.kind === k) ? ' ✓' : ''}</button>
            ))}
            <span className="dc-hint">{busy || (demo ? 'Sign in to keep documents with your loads' : 'or drop PDFs and photos here')}</span>
          </div>
          <input ref={picker} type="file" hidden multiple accept="application/pdf,image/*"
            onChange={(e) => { if (e.target.files?.length) void add(e.target.files, nextKind.current); e.target.value = '' }} />
        </div>
      </section>
      <InvoiceBox load={load} state={state} files={files} sent={sent} api={api} toast={toast} changed={changed} demo={demo} />
    </>
  )
}

function InvoiceBox({ load, state, files, sent, api, toast, changed, demo }: {
  load: Load; state: CrmState; files: CrmFile[]; sent: NonNullable<CrmState['invoices']>[number] | undefined
  api: DocsApi; toast: (m: string) => void; changed: () => void; demo: boolean
}) {
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState(() => sent?.sentTo ?? state.brokerEmails?.[load.broker.trim().toLowerCase()] ?? '')
  const [attach, setAttach] = useState<Set<number>>(() => new Set(files.filter((f) => f.kind !== 'invoice' && f.kind !== 'other').map((f) => f.id)))
  const [remind, setRemind] = useState(true)
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  // Newly added rate con, BOL and POD are attached by default.
  const known = useRef(new Set(files.map((f) => f.id)))
  useEffect(() => {
    const fresh = files.filter((f) => !known.current.has(f.id))
    fresh.forEach((f) => known.current.add(f.id))
    if (fresh.length) setAttach((s) => new Set([...s, ...fresh.filter((f) => f.kind !== 'invoice' && f.kind !== 'other').map((f) => f.id)]))
  }, [files])
  const chosen = files.filter((f) => attach.has(f.id)).map((f) => f.id)
  const missing = !files.some((f) => f.kind === 'pod')

  const send = async () => {
    if (!/^\S+@\S+\.\S{2,}$/.test(to.trim())) return toast('Enter the broker’s billing email')
    setSending(true)
    try {
      const r = await api.sendInvoice(load.id, { to: to.trim(), attach: chosen, remind, note: note.trim() || undefined })
      toast(`Invoice ${r.number} sent to ${to.trim()}`)
      setOpen(false)
      changed()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  return (
    <section>
      <h3>Invoice</h3>
      {sent && (
        <p className="iv-sent">
          ✓ <b>{sent.number}</b> sent to {sent.sentTo} on {shortDate(sent.sentAt.slice(0, 10))}
          {sent.reminders > 0 && ` · ${sent.reminders} ${sent.reminders === 1 ? 'reminder' : 'reminders'} sent`}
          <label className="iv-remind">
            <input type="checkbox" checked={sent.remind} onChange={(e) => void api.setInvoiceReminders(load.id, e.target.checked).then(changed)} />
            Remind the broker while unpaid
          </label>
        </p>
      )}
      <div className="iv-actions">
        <a className={`btn ${demo ? 'disabled' : ''}`} href={demo ? undefined : api.invoicePdfUrl(load.id, chosen)} target="_blank" rel="noopener"
          onClick={(e) => { if (demo) { e.preventDefault(); toast('Sign in to make invoices') } }}>Preview PDF</a>
        <button className="primary" onClick={() => (demo ? toast('Sign in to email invoices to brokers') : setOpen((x) => !x))}>
          {sent ? 'Send again' : 'Email invoice to broker'}
        </button>
      </div>
      {open && (
        <div className="iv-form">
          <label className="ld-field">
            <span>Broker billing email</span>
            <div className="ld-input"><input type="email" value={to} placeholder="ap@broker.com" onChange={(e) => setTo(e.target.value)} autoFocus /></div>
          </label>
          <div className="iv-attach">
            <span>Attach in the same PDF</span>
            {files.length ? files.map((f) => (
              <label key={f.id}>
                <input type="checkbox" checked={attach.has(f.id)} onChange={(e) => setAttach((s) => { const n = new Set(s); if (e.target.checked) n.add(f.id); else n.delete(f.id); return n })} />
                {kindLabel(f.kind)} · {f.name}
              </label>
            )) : <small>No documents yet — add the POD above, brokers usually pay only with it.</small>}
            {files.length > 0 && missing && <small className="warn">No POD among the documents — most brokers won’t pay without it.</small>}
          </div>
          <label className="ld-field">
            <span>Note (optional)</span>
            <textarea className="ld-notes" rows={2} value={note} placeholder="Anything for the broker’s accounting" onChange={(e) => setNote(e.target.value)} />
          </label>
          <label className="iv-remind">
            <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} />
            Remind the broker if unpaid after 30 days (up to 3 polite emails, a week apart; replies come to you)
          </label>
          <div className="iv-actions">
            <button className="ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button className="primary" disabled={sending} onClick={() => void send()}>{sending ? 'Sending…' : 'Send invoice'}</button>
          </div>
          <small className="iv-small">Sent from HaulPanel in {state.carriers.find((c) => c.id === load.carrierId)?.name ?? 'your company'}’s name; the broker’s replies go to {state.user.email}. The load is marked invoiced.</small>
        </div>
      )}
    </section>
  )
}
