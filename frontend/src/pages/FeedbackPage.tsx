import { useState } from 'react'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { currentVisitorId } from '../lib/analytics'
import posthog, { isPostHogConfigured } from '../lib/posthog'
import { telegramInitData } from '../lib/telegram'

const MAX = 3000

/** One-tap starters that are appended to the message. */
const IDEAS = [
  'Filter by state',
  'Filter by truck count',
  'Export to Google Sheets',
  'CRM: notes & follow-ups',
  'Call reminders',
  'Load board integration',
]

export function FeedbackPage({ groupUrl, supportUrl }: { groupUrl: string; supportUrl: string }) {
  const [message, setMessage] = useState('')
  const [contact, setContact] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState('')

  const addIdea = (idea: string) => {
    setStatus('idle')
    setMessage((m) => (m.trim() ? `${m.trim()}\n• ${idea}` : `• ${idea}`).slice(0, MAX))
  }

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
      if (isPostHogConfigured()) posthog.capture('feedback_submitted')
      setStatus('sent')
      setMessage('')
    } catch (err) {
      setStatus('idle')
      setError((err as Error).message)
    }
  }

  return (
    <>
      <section className="hero-band ideas-band">
        <div className="wrap lookup-hero">
          <span className="eyebrow dark">Ideas</span>
          <h1>Help us build the <span className="hl">dispatcher CRM</span></h1>
          <p className="hero-sub">
            A missing filter, data you need, or what the CRM should do — tell us. We read every suggestion and the most
            requested features ship first.
          </p>
        </div>
      </section>

      <div className="ideas-grid">
        <form className="panel idea-form" onSubmit={submit}>
          <div className="scan-head">
            <div className="tile-icon"><Icon name="bulb" /></div>
            <div className="scan-title">
              <h2>Suggest a feature</h2>
              <p>Takes 30 seconds. No account needed.</p>
            </div>
          </div>

          {status === 'sent' ? (
            <div className="idea-sent">
              <div className="sent-check"><Icon name="check" size={30} /></div>
              <h3>Thank you — your idea is saved!</h3>
              <p>We review every suggestion. If you left a contact, we may reach out with questions.</p>
              <button type="button" onClick={() => setStatus('idle')}>Suggest another</button>
            </div>
          ) : (
            <>
              <div className="idea-chips">
                <span>Quick ideas:</span>
                {IDEAS.map((idea) => (
                  <button key={idea} type="button" className="chip" onClick={() => addIdea(idea)}>+ {idea}</button>
                ))}
              </div>
              <label className="idea-field">
                <span>What would you like to see?</span>
                <textarea
                  value={message}
                  maxLength={MAX}
                  rows={7}
                  placeholder="e.g. Filter carriers by state and truck count, export straight to Google Sheets, CRM notes and follow-up reminders for each carrier…"
                  onChange={(e) => setMessage(e.target.value)}
                />
                <small>{message.length} / {MAX}</small>
              </label>
              <label className="idea-field">
                <span>Your email or Telegram <em>(optional — if you’d like a reply)</em></span>
                <div className="input-icon">
                  <Icon name="send" size={16} />
                  <input value={contact} maxLength={200} onChange={(e) => setContact(e.target.value)} placeholder="name@company.com or @username" />
                </div>
              </label>
              {error && <p className="error">{error}</p>}
              <button className="primary big glow idea-submit" type="submit" disabled={status === 'sending'}>
                {status === 'sending' ? <><span className="spinner" /> Sending…</> : <>Send suggestion<Icon name="arrow" size={16} /></>}
              </button>
            </>
          )}
        </form>

        <aside className="ideas-side">
          {supportUrl && (
            <div className="side-card help">
              <div className="tile-icon"><Icon name="lifebuoy" /></div>
              <h3>Need help or have a question?</h3>
              <p>Write to support in Telegram — a real person answers right in the chat.</p>
              <a className="btn" href={supportUrl} target="_blank" rel="noopener"><Icon name="send" size={16} />Message support</a>
            </div>
          )}
          {groupUrl && (
            <div className="side-card">
              <div className="tile-icon"><Icon name="bot" /></div>
              <h3>Join the community</h3>
              <p>Discuss ideas with other dispatchers and get updates first.</p>
              <a className="btn" href={groupUrl} target="_blank" rel="noopener">Join Telegram group<Icon name="arrow" size={16} /></a>
            </div>
          )}
          <div className="side-card">
            <h3>What happens next</h3>
            <ol className="next-steps">
              <li><b>We read every idea</b> — usually the same day.</li>
              <li><b>Most requested ships first</b> — in the scanner and the upcoming CRM.</li>
              <li><b>We reply</b> if you left an email or Telegram.</li>
            </ol>
          </div>
        </aside>
      </div>
    </>
  )
}
