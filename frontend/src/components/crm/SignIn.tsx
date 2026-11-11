import { useEffect, useRef, useState } from 'react'
import { crm, type CrmConfig, type CrmUser } from '../../lib/crm'
import { Icon } from '../Icon'

interface GoogleId {
  initialize(o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string }): void
  renderButton(el: HTMLElement, o: Record<string, unknown>): void
}
declare global {
  interface Window { google?: { accounts: { id: GoogleId } } }
}

const GSI = 'https://accounts.google.com/gsi/client'

function loadGsi(): Promise<GoogleId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id)
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = GSI
    s.async = true
    s.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('Google sign-in did not load')))
    s.onerror = () => reject(new Error('Google sign-in did not load'))
    document.head.appendChild(s)
  })
}

const POINTS: [string, string][] = [
  ['calendar', 'Every load in one place, grouped by week'],
  ['dollar', 'Weekly gross and each dispatcher’s pay, counted for you'],
  ['truck', 'Add carriers by MC — details filled from FMCSA'],
  ['download', 'Import your Google Sheet, export to Excel'],
]

/** Sign-in card for the CRM: "Sign in with Google" (and a local-only test login in development). */
export function SignIn({ config, onSignedIn }: { config: CrmConfig; onSignedIn: (u: CrmUser) => void }) {
  const button = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  const inTelegram = document.documentElement.classList.contains('in-telegram')

  useEffect(() => {
    if (!config.googleClientId || inTelegram) return
    let live = true
    loadGsi().then((g) => {
      if (!live || !button.current) return
      g.initialize({
        client_id: config.googleClientId,
        callback: ({ credential }) => crm.google(credential).then((r) => onSignedIn(r.user), (e: Error) => setError(e.message)),
      })
      g.renderButton(button.current, { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', width: 280 })
    }, (e: Error) => setError(e.message))
    return () => { live = false }
  }, [config.googleClientId, inTelegram, onSignedIn])

  return (
    <div className="crm-signin panel">
      <span className="badge">Beta · free</span>
      <h1>Dispatch board</h1>
      <p className="muted">Replace your load spreadsheet: log loads, see weekly gross per carrier and what each dispatcher earned — a free TMS for dispatchers.</p>
      <ul className="crm-points">
        {POINTS.map(([icon, text]) => <li key={text}><span><Icon name={icon as 'calendar'} size={16} /></span>{text}</li>)}
      </ul>
      {inTelegram ? (
        <p className="crm-note">Google sign-in doesn’t work inside Telegram. Open <b>{location.host}</b> in your browser to use the dispatch board.</p>
      ) : config.googleClientId ? (
        <div ref={button} className="crm-google" />
      ) : (
        <p className="crm-note">Google sign-in is being set up — check back soon.</p>
      )}
      {config.devLogin && (
        <button className="crm-dev" onClick={() => crm.devLogin('Test dispatcher').then((r) => onSignedIn(r.user), (e: Error) => setError(e.message))}>
          Test login (local only)
        </button>
      )}
      {error && <p className="error">{error}</p>}
      <p className="crm-privacy">Your loads are private to your account. We only use your Google name and email to sign you in.</p>
    </div>
  )
}
