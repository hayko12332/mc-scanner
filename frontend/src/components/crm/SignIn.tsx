import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { api } from '../../api'
import {
  crm, type AuthResult, type Company, type CrmConfig, type CrmUser, type SignUpInput,
} from '../../lib/crm'
import { track } from '../../lib/analytics'
import { formatPhone } from '../../lib/format'
import { Icon, type IconName } from '../Icon'
import { ProductShot } from '../ProductShot'

interface GoogleId {
  initialize(o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string }): void
  renderButton(el: HTMLElement, o: Record<string, unknown>): void
}
declare global {
  interface Window { google?: { accounts: { id: GoogleId } } }
}

const GSI = 'https://accounts.google.com/gsi/client?hl=en'

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

const SIDE_POINTS: [IconName, string, string][] = [
  ['file', 'Every load on one board', 'Broker, lane, miles, truck, rate per mile and status — grouped by week.'],
  ['dollar', 'Carrier statements in one click', 'Percent or flat weekly fees, PDF statements, dispatcher pay.'],
  ['search', 'Check any company', 'MC, USDOT, email or phone lookup and new MC leads every day.'],
]

/**
 * Account pages, laid out like the sign-up pages of professional TMSs: the form on a clean white side,
 * the product itself on the dark side (a picture of the board and what you get).
 */
function AuthLayout({ top, children, foot }: { top?: ReactNode; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="au3">
      <section className="au3-main">
        <header className="au3-top">
          <a href="#/" className="au3-logo"><img src="/logo.svg" alt="" width="28" height="28" /><b>HaulPanel</b></a>
          {top}
        </header>
        <div className="au3-form">{children}</div>
        <footer className="au3-foot">
          {foot}
          <span>© {new Date().getFullYear()} HaulPanel · <a href="mailto:support@haulpanel.com">support@haulpanel.com</a></span>
        </footer>
      </section>
      <aside className="au3-side" aria-hidden="true">
        <div className="au3-side-in">
          <span className="au3-kicker">TMS for dispatch companies</span>
          <h2>Run your whole dispatch company from one panel</h2>
          <div className="au3-shot"><ProductShot /></div>
          <ul className="au3-points">
            {SIDE_POINTS.map(([icon, title, text]) => (
              <li key={title}><span><Icon name={icon} size={16} /></span><div><b>{title}</b><small>{text}</small></div></li>
            ))}
          </ul>
          <p className="au3-trust"><Icon name="shield" size={14} />Free during beta · No credit card · Your data is private to your company</p>
        </div>
      </aside>
    </div>
  )
}

/**
 * Sign-up and log-in, the way TMSs do it: create an account for your dispatch company (name, company, MC filled
 * from FMCSA, password), confirm the email with a 6-digit code; log in with email and password or Google;
 * "Forgot password?" emails a reset code. HaulPanel serves dispatch companies for now.
 */
/** Sign-up asks what the business is: a dispatch service (loads from brokers for its carriers) or a freight broker. */
function BusinessType({ value, onChange }: { value: string; onChange: (t: 'dispatch' | 'broker') => void }) {
  const opts = [
    ['dispatch', 'Dispatch service', 'I dispatch trucks for carriers — loads from brokers, a fee from carriers'],
    ['broker', 'Freight broker', 'I broker loads — customers pay me, I pay carriers'],
  ] as const
  return (
    <div className="au-types two" role="radiogroup" aria-label="Your business">
      {opts.map(([id, title, sub]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} className={value === id ? 'on' : ''} onClick={() => onChange(id)}>
          <b>{title}</b><small>{sub}</small>
        </button>
      ))}
    </div>
  )
}

export interface InviteInfo { token: string; email: string; company: string; dispatcher: string }

export function SignIn({ config, onSignedIn, onDemo, initial = 'signup', invite }: {
  config: CrmConfig; onSignedIn: (u: CrmUser) => void; onDemo: () => void; initial?: 'signup' | 'login'
  /** Opened from an invite link: one step (no company of their own), email fixed to the invited one. */
  invite?: InviteInfo
}) {
  const [screen, setScreen] = useState<Screen>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [email, setEmail] = useState(invite?.email ?? '')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [v, setV] = useState<SignUpInput>({ name: '', email: invite?.email ?? '', password: '', company: '', companyType: 'dispatch', mc: '', dot: '', phone: '', fleetSize: '' })
  const [mcDot, setMcDot] = useState('')
  /** Sign-up in two short steps: you, then your company. */
  const [step, setStep] = useState<1 | 2>(1)
  const { note, fill } = useFmcsaFill((p) => setV((x) => ({ ...x, ...p, phone: x.phone || p.phone })))
  const google = useRef<HTMLDivElement>(null)
  const inTelegram = document.documentElement.classList.contains('in-telegram')
  const emailAuth = config.emailAuth !== false

  const go = (s: Screen) => { setScreen(s); setError(''); setInfo(''); setCode(''); setStep(1) }
  // Funnel: which account screen people reach (sign-up, log-in, code, reset).
  useEffect(() => { track('auth_view', { screen: screen === 'signup' && step === 2 ? 'signup_company' : screen }) }, [screen, step])

  useEffect(() => {
    if (!config.googleClientId || inTelegram || !google.current || (screen !== 'signup' && screen !== 'login') || step !== 1) return
    let live = true
    loadGsi().then((g) => {
      if (!live || !google.current) return
      g.initialize({
        client_id: config.googleClientId,
        callback: ({ credential }) => crm.google(credential).then((r) => onSignedIn(r.user), (e: Error) => setError(e.message)),
      })
      g.renderButton(google.current, {
        theme: 'outline', size: 'large', shape: 'rectangular', text: screen === 'signup' ? 'signup_with' : 'continue_with', width: 380, locale: 'en',
      })
    }, (e: Error) => setError(e.message))
    return () => { live = false }
  }, [config.googleClientId, inTelegram, onSignedIn, screen, step])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
      track('auth_error', { screen, error: (e as Error).message.slice(0, 90) })
    } finally {
      setBusy(false)
    }
  }
  const after = (r: AuthResult) => {
    if (r.user) return onSignedIn(r.user)
    if (screen === 'signup') track('crm_signup', { company: v.company.slice(0, 60), mc: (v.mc || mcDot).replace(/\D/g, '').slice(0, 10) })
    setEmail(r.email)
    go('verify')
    setInfo(`We sent a 6-digit code to ${r.email}`)
  }

  const signUp = (e: FormEvent) => {
    e.preventDefault()
    if (invite) return void run(async () => after(await crm.signUp({ ...v, email: invite.email, invite: invite.token })))
    if (step === 1) { setStep(2); setError(''); return }
    const typed = mcDot.replace(/\D/g, '')
    void run(async () => after(await crm.signUp({ ...v, companyType: v.companyType || 'dispatch', mc: v.mc || (v.dot === typed ? '' : typed) })))
  }
  const logIn = (e: FormEvent) => { e.preventDefault(); void run(async () => after(await crm.login(email, password))) }
  const verify = (e: FormEvent) => { e.preventDefault(); void run(async () => { const r = await crm.verify(email, code); track('crm_verified'); onSignedIn(r.user) }) }
  const forgot = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => { await crm.forgot(email); track('password_forgot'); go('reset'); setInfo(`If ${email} has an account, a reset code is on its way.`) })
  }
  const reset = (e: FormEvent) => { e.preventDefault(); void run(async () => { const r = await crm.reset(email, code, password); track('password_reset'); onSignedIn(r.user) }) }
  const resend = (purpose: 'verify' | 'reset') => void run(async () => { await crm.resend(email, purpose); setInfo(`A new code is on its way to ${email}`) })

  const googleBlock = config.googleClientId && !inTelegram ? (
    <>
      <div ref={google} className="au-google" />
      {emailAuth && <div className="au-or"><span>or</span></div>}
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
        {!invite && <div className="au3-steps" aria-label={`Step ${step} of 2`}>
          <span className={step === 1 ? 'on' : 'done'}><i>{step === 1 ? 1 : <Icon name="check" size={12} />}</i>Your account</span>
          <em />
          <span className={step === 2 ? 'on' : ''}><i>2</i>Your company</span>
        </div>}
        <h2>{invite ? `Join ${invite.company || 'your team'}` : step === 1 ? 'Create your free account' : 'Tell us about your company'}</h2>
        <p className="au-sub">{invite ? `You were invited to ${invite.company ? `${invite.company}’s` : 'a'} dispatch board${invite.dispatcher ? ` as ${invite.dispatcher}` : ''}. Create your account with ${invite.email} to start — you’ll see your own loads, documents and pay.` : step === 1
          ? 'Set up your board in a few minutes. Free during beta, no credit card.'
          : 'What your business does, then your MC number — we fill in the rest from FMCSA.'}</p>
        {step === 1 && googleBlock}
        {emailAuth ? (
          <form onSubmit={signUp} className="au-form">
            {step === 1 ? (
              <>
                <Field label="Full name"><input required autoComplete="name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoFocus placeholder="John Smith" /></Field>
                <Field label="Work email"><input type="email" required autoComplete="email" value={v.email} readOnly={!!invite} onChange={(e) => setV({ ...v, email: e.target.value })} placeholder="you@company.com" /></Field>
                <Field label="Password" hint="At least 8 characters"><PasswordInput value={v.password} onChange={(x) => setV({ ...v, password: x })} autoComplete="new-password" /></Field>
                <button className="primary au-submit">{invite ? 'Create account & join' : 'Continue'}<Icon name="arrow" size={15} /></button>
              </>
            ) : (
              <>
                <BusinessType value={v.companyType} onChange={(t) => setV({ ...v, companyType: t })} />
                <Field label="MC number" hint={note || 'Optional — company name and phone fill in from FMCSA'}>
                  <div className="au-inline">
                    <input inputMode="numeric" value={mcDot} onChange={(e) => setMcDot(e.target.value)} placeholder="e.g. 1234567" autoFocus
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void fill(mcDot) } }} />
                    <button type="button" className="ghost" onClick={() => { track('mc_fill'); void fill(mcDot) }}>Find</button>
                  </div>
                </Field>
                <Field label="Company name"><input required autoComplete="organization" value={v.company} onChange={(e) => setV({ ...v, company: e.target.value })} placeholder={v.companyType === 'broker' ? 'Acme Logistics LLC' : 'Acme Dispatch LLC'} /></Field>
                <Field label="Phone"><input type="tel" autoComplete="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} placeholder="Optional" /></Field>
                <div className="au3-actions">
                  <button type="button" className="ghost" onClick={() => setStep(1)}>Back</button>
                  <button className="primary au-submit" disabled={busy}>{busy ? 'Creating your account…' : 'Create account'}</button>
                </div>
                <p className="au3-legal">We’ll email you a 6-digit code to confirm your address. By creating an account you agree to the <a href="/terms.html" target="_blank" rel="noopener">Terms</a> and <a href="/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.</p>
              </>
            )}
          </form>
        ) : !googleBlock && <p className="crm-note">Sign-up opens very soon — meanwhile try the demo.</p>}
      </>
    )
  } else if (screen === 'login') {
    body = (
      <>
        <h2>Log in to HaulPanel</h2>
        <p className="au-sub">Welcome back.</p>
        {googleBlock}
        {emailAuth && (
          <form onSubmit={logIn} className="au-form">
            <Field label="Email"><input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
            <div className="au-field">
              <span className="au-label-row">Password<button type="button" className="au-link" onClick={() => go('forgot')}>Forgot password?</button></span>
              <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" />
            </div>
            <button className="primary au-submit" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
          </form>
        )}
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

  const top = screen === 'signup'
    ? <span className="au3-switch">Already have an account? <button type="button" onClick={() => go('login')}>Log in</button></span>
    : screen === 'login'
      ? <span className="au3-switch">New to HaulPanel? <button type="button" onClick={() => go('signup')}>Create an account</button></span>
      : undefined

  return (
    <AuthLayout top={top} foot={<button type="button" className="au3-demo" onClick={onDemo}><Icon name="play" size={12} />Just looking? Open the demo board</button>}>
      {inTelegram && <p className="crm-note">Google sign-in doesn’t work inside Telegram — use your email, or open <b>{location.host}</b> in a browser.</p>}
      {info && !error && <p className="au-info">{info}</p>}
      {error && <p className="au-error" role="alert">{error}</p>}
      {body}
      {config.devLogin && (
        <button className="crm-dev" onClick={() => crm.devLogin('Test dispatcher').then((r) => onSignedIn(r.user), (e: Error) => setError(e.message))}>
          Test login (local only)
        </button>
      )}
    </AuthLayout>
  )
}

/** After a Google sign-up, the company step other TMSs ask for: the dispatch company's name, MC and phone. */
export function CompanySetup({ user, onDone }: { user: CrmUser; onDone: (c: Company) => void }) {
  const [c, setC] = useState<Company>({ name: '', type: 'dispatch', mc: '', dot: '', phone: '', fleetSize: '' })
  const [mcDot, setMcDot] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { note, fill } = useFmcsaFill((p) => setC((x) => ({ ...x, name: p.company, dot: p.dot, mc: p.mc, phone: x.phone || p.phone })))
  const save = (e: FormEvent) => {
    e.preventDefault()
    const typed = mcDot.replace(/\D/g, '')
    setBusy(true)
    crm.setCompany({ ...c, type: c.type || 'dispatch', mc: c.mc || (c.dot === typed ? '' : typed) }).then(onDone, (er: Error) => { setError(er.message); setBusy(false) })
  }
  return (
    <AuthLayout>
          <h2>Welcome, {user.name.split(' ')[0] || 'there'}!</h2>
          <p className="au-sub">One last step: tell us about your company.</p>
          {error && <p className="au-error" role="alert">{error}</p>}
          <form onSubmit={save} className="au-form">
            <BusinessType value={c.type} onChange={(t) => setC({ ...c, type: t })} />
            <Field label="MC number" hint={note || 'Optional — we fill in your company from FMCSA'}>
              <div className="au-inline">
                <input inputMode="numeric" value={mcDot} onChange={(e) => setMcDot(e.target.value)} placeholder="e.g. 1234567" />
                <button type="button" className="ghost" onClick={() => { track('mc_fill'); void fill(mcDot) }}>Find</button>
              </div>
            </Field>
            <Field label="Company name"><input required value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field>
            <Field label="Phone"><input type="tel" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} placeholder="Optional" /></Field>
            <button className="primary au-submit" disabled={busy}>{busy ? 'Saving…' : 'Open my board'}</button>
          </form>
          <p className="au-switch">Signed in as {user.email}. <button type="button" onClick={() => void crm.logout().then(() => location.reload())}>Not you? Sign out</button></p>
    </AuthLayout>
  )
}

/** The company's details later on (the sidebar's company card): business type, name, MC and phone. */
export function CompanyEdit({ company, close, saved }: { company: Company; close: () => void; saved: (c: Company) => void }) {
  const [c, setC] = useState<Company>({ ...company, type: company.type || 'dispatch' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    crm.setCompany(c).then((r) => { track('company_edit', { type: r.type }); saved(r) }, (er: Error) => { setError(er.message); setBusy(false) })
  }
  return (
    <div className="ld-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <aside className="ld ce" role="dialog" aria-label="Company">
        <header className="ld-head">
          <div><small>Settings</small><h2>Your company</h2><p>A freight broker’s board counts customers, carrier pay and margin.</p></div>
          <button className="ld-x" aria-label="Close" onClick={close}>×</button>
        </header>
        <form className="ld-body au-form" onSubmit={save}>
          {error && <p className="au-error" role="alert">{error}</p>}
          <BusinessType value={c.type} onChange={(t) => setC({ ...c, type: t })} />
          <Field label="Company name"><input required value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field>
          <Field label="MC number"><input inputMode="numeric" value={c.mc} onChange={(e) => setC({ ...c, mc: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="Phone"><input type="tel" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} /></Field>
          <div className="au3-actions">
            <button type="button" className="ghost" onClick={close}>Cancel</button>
            <button className="primary au-submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </aside>
    </div>
  )
}
