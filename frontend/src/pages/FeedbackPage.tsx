import { useState } from 'react'
import { api } from '../api'
import { currentVisitorId } from '../lib/analytics'
import { telegramInitData } from '../lib/telegram'

const MAX = 3000

export function FeedbackPage() {
  const [message, setMessage] = useState('')
  const [contact, setContact] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState('')

  const submit = async (e: { preventDefault(): void }) => {
    e.preventDefault()
    if (message.trim().length < 3) return setError('Please write a few words.')
    setStatus('sending')
    setError('')
    try {
      await api.feedback({
        message: message.trim(),
        contact: contact.trim(),
        page: location.hash || '#/',
        visitorId: currentVisitorId(),
        tgInitData: telegramInitData(),
      })
      setStatus('sent')
      setMessage('')
    } catch (err) {
      setStatus('idle')
      setError((err as Error).message)
    }
  }

  return (
    <>
      <p className="sub">
        Tell us what would make MC Scanner more useful — a missing filter, data you need, or what the dispatcher
        CRM should do. We read every suggestion.
      </p>
      <form className="panel feedback" onSubmit={submit}>
        <label className="field">
          What would you like to see?
          <textarea
            value={message}
            maxLength={MAX}
            rows={6}
            placeholder="e.g. Filter by state and truck count, export to Google Sheets, CRM: notes and follow-up reminders for each carrier…"
            onChange={(e) => {
              setMessage(e.target.value)
              if (status === 'sent') setStatus('idle')
            }}
          />
        </label>
        <label className="field">
          Your email or Telegram (optional — if you’d like a reply)
          <input value={contact} maxLength={200} onChange={(e) => setContact(e.target.value)} placeholder="name@company.com or @username" />
        </label>
        <div className="controls">
          <button className="primary" type="submit" disabled={status === 'sending'}>
            {status === 'sending' ? 'Sending…' : 'Send suggestion'}
          </button>
          <span className="muted small-text">{message.length} / {MAX}</span>
        </div>
        {status === 'sent' && <p className="ok-text">Thank you! Your suggestion has been saved.</p>}
        {error && <p className="error">{error}</p>}
      </form>
    </>
  )
}
