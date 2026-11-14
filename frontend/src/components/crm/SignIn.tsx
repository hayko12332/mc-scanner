import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { api } from '../../api'
import {
  COMPANY_TYPES, crm, FLEET_SIZES, type AuthResult, type Company, type CompanyType, type CrmConfig, type CrmUser, type SignUpInput,
} from '../../lib/crm'
import { formatPhone } from '../../lib/format'
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
  ['calendar', 'Loads, trucks and drivers in one board, grouped by week'],
  ['dollar', 'Gross, RPM, dispatch fees and weekly carrier statements'],
  ['search', 'Check any company by MC, USDOT, email or phone'],
  ['zap', 'New MC leads every day, with phone and email'],
]

type Screen = 'signup' | 'login' | 'verify' | 'forgot' | 'reset'

/** A labelled input with the error-friendly defaults every auth form needs. */
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="au-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}

function PasswordInput({ value, onChange, autoComplete }: { value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="au-pass">
      <input type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} required minLength={8} />
      <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? 'Hide' : 'Show'}</button>
    </div>
  )
}

/** "Your business" choice, shared by sign-up and the company step after Google sign-in. */
function TypePicker({ value, onChange }: { value: CompanyType | ''; onChange: (t: CompanyType) => void }) {
  return (
    <div className="au-types" role="radiogroup" aria-label="Your business">
      {COMPANY_TYPES.map(([id, label, sub]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} className={value === id ? 'on' : ''} onClick={() => onChange(id)}>
          <b>{label}</b><small>{sub}</small>
        </button>
      ))}
    </div>
  )
}

/** MC/USDOT lookup that fills the company name and phone from FMCSA. */
function useFmcsaFill(set: (patch: { company: string; dot: string; mc: string; phone: string }) => void) {
  const [note, setNote] = useState('')
  const fill = async (number: string) => {
    const n = number.replace(/\D/g, '')
    if (!n) return setNote('Enter your MC or USDOT number')
    setNote('Looking it up on FMCSA…')
    try {
      let r = await api.lookup(n, 'mc')
      if (!r.profiles[0]) r = await api.lookup(n, 'dot')
      const c = r.profiles[0]
      if (!c) return setNote('Not found on FMCSA — type your company name')
      set({ company: c.legalName, dot: c.dot, mc: c.mc ? String(c.mc) : '', phone: formatPhone(c.phone || c.cellPhone) })
      setNote(`Found on FMCSA: ${c.legalName}`)
    } catch (e) {
      setNote((e as Error).message)
    }
  }
  return { note, fill }
}

/**
 * Sign-up and log-in, the way TMSs do it: create an account with your name, company, what the company does,
 * MC/USDOT and a password, confirm the email with a 6-digit code; log in with email and password or Google;
 * "Forgot password?" emails a reset code.
 */
export function SignIn({ config, onSignedIn, onDemo }: { config: CrmConfig; onSignedIn: (u: CrmUser) => void; onDemo: () => void }) {
  const [screen, setScreen] = useState<Screen>('signup')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [v, setV] = useState<SignUpInput>({ name: '', email: '', password: '', company: '', companyType: '', mc: '', dot: '', phone: '', fleetSize: '' })
  const [mcDot, setMcDot] = useState('')
  const { note, fill } = useFmcsaFill((p) => setV((x) => ({ ...x, ...p, phone: x.phone || p.phone })))
  const google = useRef<HTMLDivElement>(null)
  const inTelegram = document.documentElement.classList.contains('in-telegram')
  const emailAuth = config.emailAuth !== false

  const go = (s: Screen) => { setScreen(s); setError(''); setInfo(''); setCode('') }

  useEffect(() => {
    if (!config.googleClientId || inTelegram || !google.current || (screen !== 'signup' && screen !== 'login')) return
    let live = true
    loadGsi().then((g) => {
      if (!live || !google.current) return
      g.initialize({
        client_id: config.googleClientId,
        callback: ({ credential }) => crm.google(credential).then((r) => onSignedIn(r.user), (e: Error) => setError(e.message)),
      })
      g.renderButton(google.current, {
        theme: 'outline', size: 'large', shape: 'rectangular', text: screen === 'signup' ? 'signup_with' : 'continue_with', width: 340,
      })
    }, (e: Error) => setError(e.message))
    return () => { live = false }
  }, [config.googleClientId, inTelegram, onSignedIn, screen])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const after = (r: AuthResult) => {
    if (r.user) return onSignedIn(r.user)
    setEmail(r.email)
    go('verify')
    setInfo(`We sent a 6-digit code to ${r.email}`)
  }

  const signUp = (e: FormEvent) => {
    e.preventDefault()
    if (!v.companyType) return setError('Choose what your company does')
    const typed = mcDot.replace(/\D/g, '')
    void run(async () => after(await crm.signUp({ ...v, mc: v.mc || (v.dot === typed ? '' : typed) })))
  }
  const logIn = (e: FormEvent) => { e.preventDefault(); void run(async () => after(await crm.login(email, password))) }
  const verify = (e: FormEvent) => { e.preventDefault(); void run(async () => onSignedIn((await crm.verify(email, code)).user)) }
  const forgot = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => { await crm.forgot(email); go('reset'); setInfo(`If ${email} has an account, a reset code is on its way.`) })
  }
  const reset = (e: FormEvent) => { e.preventDefault(); void run(async () => onSignedIn((await crm.reset(email, code, password)).user)) }
  const resend = (purpose: 'verify' | 'reset') => void run(async () => { await crm.resend(email, purpose); setInfo(`A new code is on its way to ${email}`) })

  const googleBlock = config.googleClientId && !inTelegram ? (
    <>
      <div ref={google} className="au-google" />
      {emailAuth && <div className="au-or"><span>or with email</span></div>}
    </>
  ) : null
  const codeInput = (
    <Field label="6-digit code">
      <input className="au-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="••••••" required pattern="\d{6}"
        value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} autoFocus />
    </Field>
  )

  let body: ReactNode
  if (screen === 'signup') {
    body = (
      <>
        <h2>Create your free account</h2>
        <p className="au-sub">Set up your board in a minute. No credit card.</p>
        {googleBlock}
        {emailAuth ? (
          <form onSubmit={signUp} className="au-form">
            <Field label="Your business"><TypePicker value={v.companyType} onChange={(t) => setV((x) => ({ ...x, companyType: t }))} /></Field>
            <div className="au-row">
              <Field label="Full name"><input required autoComplete="name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
              <Field label="Phone"><input type="tel" autoComplete="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} placeholder="(555) 123-4567" /></Field>
            </div>
            <Field label="Work email"><input type="email" required autoComplete="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
            <Field label="Password" hint="At least 8 characters"><PasswordInput value={v.password} onChange={(x) => setV({ ...v, password: x })} autoComplete="new-password" /></Field>
            <Field label="MC or USDOT number (optional)" hint={note || 'We fill in your company from FMCSA'}>
              <div className="au-inline">
                <input inputMode="numeric" value={mcDot} onChange={(e) => setMcDot(e.target.value)} placeholder="e.g. 1234567"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void fill(mcDot) } }} />
                <button type="button" className="ghost" onClick={() => void fill(mcDot)}>Find</button>
              </div>
            </Field>
            <div className="au-row">
              <Field label="Company name"><input required autoComplete="organization" value={v.company} onChange={(e) => setV({ ...v, company: e.target.value })} /></Field>
              <Field label={v.companyType === 'broker' ? 'Carriers you work with' : 'Trucks you run'}>
                <select value={v.fleetSize} onChange={(e) => setV({ ...v, fleetSize: e.target.value })}>
                  <option value="">Choose</option>
                  {FLEET_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>
            <button className="primary au-submit" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
          </form>
        ) : !googleBlock && <p className="crm-note">Sign-up opens very soon — meanwhile try the demo.</p>}
        <p className="au-switch">Already have an account? <button type="button" onClick={() => go('login')}>Log in</button></p>
      </>
    )
  } else if (screen === 'login') {
    body = (
      <>
        <h2>Log in</h2>
        <p className="au-sub">Welcome back.</p>
        {googleBlock}
        {emailAuth && (
          <form onSubmit={logIn} className="au-form">
            <Field label="Email"><input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
            <Field label="Password"><PasswordInput value={password} onChange={setPassword} autoComplete="current-password" /></Field>
            <button type="button" className="au-link" onClick={() => go('forgot')}>Forgot password?</button>
            <button className="primary au-submit" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
          </form>
        )}
        <p className="au-switch">New here? <button type="button" onClick={() => go('signup')}>Create a free account</button></p>
      </>
    )
  } else if (screen === 'verify') {
    body = (
      <>
        <h2>Check your email</h2>
        <p className="au-sub">Enter the code we sent to <b>{email}</b>. It can take a minute — check spam too.</p>
        <form onSubmit={verify} className="au-form">
          {codeInput}
          <button className="primary au-submit" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Confirm email'}</button>
        </form>
        <p className="au-switch">
          <button type="button" onClick={() => resend('verify')} disabled={busy}>Send a new code</button>
          {' · '}
          <button type="button" onClick={() => go('signup')}>Use another email</button>
        </p>
      </>
    )
  } else if (screen === 'forgot') {
    body = (
      <>
        <h2>Reset your password</h2>
        <p className="au-sub">We’ll email you a code to set a new password.</p>
        <form onSubmit={forgot} className="au-form">
          <Field label="Email"><input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
          <button className="primary au-submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset code'}</button>
        </form>
        <p className="au-switch"><button type="button" onClick={() => go('login')}>Back to log in</button></p>
      </>
    )
  } else {
    body = (
      <>
        <h2>Set a new password</h2>
        <p className="au-sub">Enter the code from the email and your new password.</p>
        <form onSubmit={reset} className="au-form">
          {codeInput}
          <Field label="New password" hint="At least 8 characters"><PasswordInput value={password} onChange={setPassword} autoComplete="new-password" /></Field>
          <button className="primary au-submit" disabled={busy || code.length !== 6}>{busy ? 'Saving…' : 'Save and log in'}</button>
        </form>
        <p className="au-switch">
          <button type="button" onClick={() => resend('reset')} disabled={busy}>Send a new code</button>
          {' · '}
          <button type="button" onClick={() => go('login')}>Back to log in</button>
        </p>
      </>
    )
  }

  return (
    <div className="au">
      <aside className="au-pitch">
        <span className="badge">Free TMS</span>
        <h1>Run your dispatch business in one place</h1>
        <p>Loads, trucks, carrier statements and company checks — for dispatchers, carriers and brokers.</p>
        <ul className="crm-points">
          {POINTS.map(([icon, text]) => <li key={text}><span><Icon name={icon as 'calendar'} size={16} /></span>{text}</li>)}
        </ul>
        <button className="crm-demo-btn" onClick={onDemo}><Icon name="zap" size={15} />Try the demo first — no sign-up</button>
      </aside>
      <section className="au-card panel">
        {inTelegram && <p className="crm-note">Google sign-in doesn’t work inside Telegram — use your email, or open <b>{location.host}</b> in a browser.</p>}
        {info && !error && <p className="au-info">{info}</p>}
        {error && <p className="au-error" role="alert">{error}</p>}
        {body}
        {config.devLogin && (
          <button className="crm-dev" onClick={() => crm.devLogin('Test dispatcher').then((r) => onSignedIn(r.user), (e: Error) => setError(e.message))}>
            Test login (local only)
          </button>
        )}
        <p className="crm-privacy">Your data is private to your company. We never share your contacts.</p>
      </section>
    </div>
  )
}

/** After a Google sign-up, the company step other TMSs ask for: what the company does, its name and MC/USDOT. */
export function CompanySetup({ user, onDone }: { user: CrmUser; onDone: (c: Company) => void }) {
  const [c, setC] = useState<Company>({ name: '', type: '', mc: '', dot: '', phone: '', fleetSize: '' })
  const [mcDot, setMcDot] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { note, fill } = useFmcsaFill((p) => setC((x) => ({ ...x, name: p.company, dot: p.dot, mc: p.mc, phone: x.phone || p.phone })))
  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!c.type) return setError('Choose what your company does')
    const typed = mcDot.replace(/\D/g, '')
    setBusy(true)
    crm.setCompany({ ...c, mc: c.mc || (c.dot === typed ? '' : typed) }).then(onDone, (er: Error) => { setError(er.message); setBusy(false) })
  }
  return (
    <div className="au au-single">
      <section className="au-card panel">
        <h2>Welcome, {user.name.split(' ')[0] || 'there'}!</h2>
        <p className="au-sub">Tell us about your company to set up your board.</p>
        {error && <p className="au-error" role="alert">{error}</p>}
        <form onSubmit={save} className="au-form">
          <Field label="Your business"><TypePicker value={c.type} onChange={(t) => setC({ ...c, type: t })} /></Field>
          <Field label="MC or USDOT number (optional)" hint={note || 'We fill in your company from FMCSA'}>
            <div className="au-inline">
              <input inputMode="numeric" value={mcDot} onChange={(e) => setMcDot(e.target.value)} placeholder="e.g. 1234567" />
              <button type="button" className="ghost" onClick={() => void fill(mcDot)}>Find</button>
            </div>
          </Field>
          <div className="au-row">
            <Field label="Company name"><input required value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field>
            <Field label="Phone"><input type="tel" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} /></Field>
          </div>
          <Field label={c.type === 'broker' ? 'Carriers you work with' : 'Trucks you run'}>
            <select value={c.fleetSize} onChange={(e) => setC({ ...c, fleetSize: e.target.value })}>
              <option value="">Choose</option>
              {FLEET_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <button className="primary au-submit" disabled={busy}>{busy ? 'Saving…' : 'Open my board'}</button>
        </form>
        <p className="au-switch">Signed in as {user.email}. <button type="button" onClick={() => void crm.logout().then(() => location.reload())}>Not you? Sign out</button></p>
      </section>
    </div>
  )
}
