import { useEffect, useRef, useState, type FormEvent } from 'react'

type Turn = { role: 'user' | 'assistant'; text: string }

const EXAMPLES = [
  'What was our gross last week, and per dispatcher?',
  'Which invoices are overdue and how much is owed?',
  'Which broker paid us the best rate per mile this month?',
  'How many empty miles did truck #101 run this month?',
]

/**
 * "Ask AI": questions about your own board in plain words — answered by Claude from the board's data
 * (an invited dispatcher's answers only use their own loads). The conversation lives only in this panel.
 */
export function AskPanel({ ask, close }: { ask: (q: string, history: Turn[]) => Promise<{ answer: string }>; close: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [close])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [turns, busy])

  const send = async (text: string) => {
    const question = text.trim()
    if (!question || busy) return
    const history = turns
    setTurns([...history, { role: 'user', text: question }])
    setQ('')
    setBusy(true)
    try {
      const r = await ask(question, history)
      setTurns((t) => [...t, { role: 'assistant', text: r.answer }])
    } catch (e) {
      setTurns((t) => [...t, { role: 'assistant', text: `⚠ ${(e as Error).message}` }])
    } finally {
      setBusy(false)
      input.current?.focus()
    }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); void send(q) }

  return (
    <div className="ld-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <aside className="ld ask" role="dialog" aria-label="Ask AI about your board">
        <header className="ld-head">
          <div>
            <small>Answers from your board’s data</small>
            <h2><span className="ai-spark" aria-hidden="true">✦</span> Ask AI</h2>
          </div>
          <button className="ld-x" aria-label="Close" onClick={close}>×</button>
        </header>
        <div className="ld-body ask-body" aria-live="polite">
          {!turns.length && (
            <div className="ask-examples">
              <p>Ask about your loads, money, carriers, trucks and dispatchers — in any language.</p>
              {EXAMPLES.map((x) => <button key={x} onClick={() => void send(x)}>{x}</button>)}
            </div>
          )}
          {turns.map((t, i) => <div key={i} className={`ask-msg ${t.role}`}>{t.text}</div>)}
          {busy && <div className="ask-msg assistant ask-busy"><i /><i /><i /></div>}
          <div ref={end} />
        </div>
        <form className="ld-foot ask-form" onSubmit={submit}>
          <textarea ref={input} rows={2} value={q} placeholder="e.g. Who are our top 5 brokers this month?" onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(q) } }} />
          <button className="primary" disabled={busy || !q.trim()}>Ask</button>
        </form>
      </aside>
    </div>
  )
}
