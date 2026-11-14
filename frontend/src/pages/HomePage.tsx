import { useEffect, useState, type ReactNode } from 'react'
import { track } from '../lib/analytics'
import { Icon } from '../components/Icon'

/**
 * First-screen picture: a short silent loop of the real board (adding a load, miles filling in) in an app frame,
 * with a play button that opens the full narrated tour. Reduced-motion users see the still frame.
 */
function HeroVideo({ onPlay }: { onPlay: () => void }) {
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  return (
    <button type="button" className="hp-hero-video" onClick={onPlay} aria-label="Watch the 90-second tour of HaulPanel">
      <span className="hp-hero-video-bar"><i /><i /><i /><em>haulpanel.com · Dispatch</em></span>
      <video src={still ? undefined : '/hero-loop.mp4'} poster="/hero-loop.jpg" autoPlay={!still} muted loop playsInline preload="auto" aria-hidden="true" />
      <span className="hp-hero-play">
        <span className="hp-hero-play-btn"><Icon name="play" size={22} /></span>
        <span className="hp-hero-play-text"><b>Watch the tour</b><small>1:35 · with sound</small></span>
      </span>
    </button>
  )
}

/** Visual for the load row: one load opened, the way the load panel shows it. */
function LoadVisual() {
  return (
    <div className="hv-card">
      <div className="hv-card-head"><div><small>Nov 13 · # LS-77001</small><b>Landstar</b><span>Aurora, CO → Dallas, TX</span></div><i className="hp-pill booked">Booked</i></div>
      <div className="hv-kpis"><div><span>Gross</span><b>$2,550</b></div><div><span>RPM</span><b>$3.29</b></div><div><span>All-in RPM</span><b>$3.26</b></div></div>
      <div className="hv-lines">
        <div><span>Truck</span><b>#101 · Arman K.</b></div>
        <div><span>Loaded miles</span><b>775 mi <em>from the map</em></b></div>
        <div><span>Empty miles</span><b>6 mi <em>from last drop in Denver</em></b></div>
        <div><span>Linehaul + detention</span><b>$2,400 + $150</b></div>
      </div>
    </div>
  )
}

/** Visual for statements: the weekly statement a carrier receives. */
function StatementVisual() {
  return (
    <div className="hv-card hv-doc">
      <div className="hv-doc-head"><div><b>Dispatch statement</b><small>Nov 2 – Nov 8, 2026</small></div><div className="r"><small>To</small><b>BEKU Trucking</b><small>MC-1188808</small></div></div>
      <table>
        <thead><tr><th>Date</th><th>Broker</th><th>Lane</th><th className="r">Gross</th></tr></thead>
        <tbody>
          <tr><td>Nov 3</td><td>DG Global</td><td>Red Lion, PA → Altoona, IA</td><td className="r">$2,500</td></tr>
          <tr><td>Nov 5</td><td>Buchanan</td><td>Timewell, IL → Salem, WV</td><td className="r">$1,700</td></tr>
          <tr><td>Nov 6</td><td>Coyote</td><td>Dallas, TX → Atlanta, GA</td><td className="r">$2,450</td></tr>
        </tbody>
      </table>
      <div className="hv-doc-sum"><div><span>Gross · 3 loads</span><b>$6,650</b></div><div><span>Dispatch fee · 8%</span><b>$532.00</b></div><div className="due"><span>Amount due</span><b>$532.00</b></div></div>
      <span className="hv-chip"><Icon name="download" size={13} />Statement PDF</span>
    </div>
  )
}

/** Visual for payments: unpaid money by age, the overdue load on top. */
function PaymentsVisual() {
  return (
    <div className="hv-card">
      <div className="hv-aging">
        <div><span>Not invoiced</span><b>$19,050</b></div>
        <div className="ok"><span>On time</span><b>$10,450</b></div>
        <div className="warn"><span>1–30 days late</span><b>$1,350</b></div>
        <div><span>30+ days late</span><b>$0</b></div>
      </div>
      <div className="hv-rows">
        <div><span><b>Swift Logistics</b><small>Invoiced Oct 3</small></span><em className="late">12 days late</em><b>$1,350</b><i className="hv-btn">Mark paid</i></div>
        <div><span><b>US Logistics</b><small>Invoiced Nov 1</small></span><em>due in 17 days</em><b>$4,900</b><i className="hv-btn">Mark paid</i></div>
        <div><span><b>Echo Global</b><small>Invoiced Nov 2</small></span><em>due in 18 days</em><b>$2,350</b><i className="hv-btn">Mark paid</i></div>
      </div>
    </div>
  )
}

/** Visual for lookup: the company card a search returns. */
function LookupVisual() {
  return (
    <div className="hv-card">
      <div className="hv-search"><Icon name="search" size={15} /><span>MC 1188808</span><i>MC · USDOT · email · phone</i></div>
      <div className="hv-company">
        <div className="hv-company-head"><div><b>UZLAND LLC</b><small>USDOT 3550347 · MC-1188808 · Cincinnati, OH</small></div><i className="hp-pill paid">Authorized</i></div>
        <div className="hv-badges">
          <span><Icon name="shield" size={13} />SAFER: active</span><span><Icon name="file" size={13} />BIPD $750,000 on file</span><span><Icon name="truck" size={13} />2 power units</span>
        </div>
        <div className="hv-lines">
          <div><span>Phone</span><b>(513) 913-2999</b></div>
          <div><span>Authority granted</span><b>Mar 2024</b></div>
          <div><span>Same phone used by</span><b>1 other company</b></div>
        </div>
      </div>
    </div>
  )
}

const ROWS: { eyebrow: string; title: string; text: string; points: string[]; visual: ReactNode }[] = [
  {
    eyebrow: 'Load management', title: 'Every load, from booking to payment',
    text: 'One board for the whole office, grouped by week. Miles fill in from the map, deadhead is counted from the truck’s last drop, and RPM is on every load.',
    points: ['Broker, load #, lane, truck and driver', 'Detention, layover, TONU and lumper', 'Import your history from Excel or CSV'], visual: <LoadVisual />,
  },
  {
    eyebrow: 'Carrier statements', title: 'Bill every carrier in one click',
    text: 'Set each carrier’s fee once — a percent of gross or a flat weekly amount. Every Monday the statement is ready to send as a PDF, and each dispatcher’s pay is counted.',
    points: ['Percent or flat weekly fee per carrier', 'Accessorials and lumper handled correctly', 'Factoring company printed on the statement'], visual: <StatementVisual />,
  },
  {
    eyebrow: 'Invoices & payments', title: 'Know who owes you, and how late',
    text: 'Net-30 terms are tracked from the invoice date. Unpaid money is grouped by age, overdue loads are flagged on the board, and marking a load paid takes one click.',
    points: ['Booked → In transit → Delivered → Invoiced → Paid', 'Aging: on time, 1–30 and 30+ days late', 'Export to Excel for your accountant'], visual: <PaymentsVisual />,
  },
  {
    eyebrow: 'Carrier & broker lookup', title: 'Check any company before you work with it',
    text: 'Search by MC, USDOT, email or phone. See operating authority, insurance on file, live SAFER status and fleet — and other companies using the same contact.',
    points: ['Authority and insurance history', 'State registration, liens and courts', 'Shared phones and emails exposed'], visual: <LookupVisual />,
  },
]

const STEPS: [string, string][] = [
  ['Create your account', 'Sign up with your work email. Free during beta, no credit card.'],
  ['Add carriers and trucks', 'Type an MC number — name, USDOT and phone fill in from FMCSA.'],
  ['Run your week', 'Log loads in seconds, send statements on Monday, track payments.'],
]

const PLAN = [
  'Unlimited loads, carriers, trucks and dispatchers', 'Weekly carrier statements (PDF) and dispatcher pay', 'Invoices, payments and overdue tracking',
  'Company lookup by MC, USDOT, email or phone', 'New MC leads every day with phone and email', 'Import from Excel, CSV or Google Sheets',
]

function Check({ children }: { children: ReactNode }) {
  return <li><Icon name="check" size={15} />{children}</li>
}

/** Primary call to action: solid button with an arrow that moves on hover. */
export function StartButton({ children = 'Start free', big = true }: { children?: ReactNode; big?: boolean }) {
  return <a className={`hp-btn primary ${big ? '' : 'sm'}`} href="#/crm?signup" data-track="start_free">{children}<Icon name="arrow" size={16} /></a>
}
function DemoButton({ dark = false, onPlay }: { dark?: boolean; onPlay: () => void }) {
  return <button type="button" className={`hp-btn ${dark ? 'dark' : ''}`} onClick={onPlay}><span className="hp-play"><Icon name="play" size={11} /></span>See the demo</button>
}

/** The 90-second product tour, in a window over the page; from there, the live demo or sign-up. */
function DemoVideo({ close }: { close: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [close])
  return (
    <div className="hp-video" role="dialog" aria-modal="true" aria-label="HaulPanel demo video" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="hp-video-box">
        <button className="hp-video-x" aria-label="Close" onClick={close}>×</button>
        <video src="/haulpanel-demo.mp4" poster="/haulpanel-demo.jpg" controls autoPlay playsInline preload="auto"
          onEnded={() => track('demo_video_end')}
          onPause={(e) => { const v = e.currentTarget; if (!v.ended) track('demo_video_pause', { at: Math.round(v.currentTime) }) }} />
        <div className="hp-video-foot">
          <div><b>HaulPanel in 90 seconds</b><span>Loads, statements, payments, company lookup and new MC leads.</span></div>
          <div className="hp-video-cta">
            <a className="hp-btn sm" href="#/crm?demo=1" data-track="live_demo_from_video">Try the live demo</a>
            <StartButton big={false} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Landing page: HaulPanel as a TMS for dispatch companies. Light and quiet, with the product itself up front. */
export function HomePage({ backendOk }: { backendOk: boolean | null }) {
  void backendOk
  const [video, setVideo] = useState(false)
  const play = () => { track('demo_video'); setVideo(true) }
  return (
    <div className="hp">
      {video && <DemoVideo close={() => setVideo(false)} />}
      <section className="hp-hero">
        <div className="hp-hero-text">
          <a className="hp-eyebrow" href="#/leads?go=1" data-track="leads_chip"><span>⚡ New MC leads</span>Carriers that got authority today, with phone &amp; email<Icon name="arrow" size={14} /></a>
          <h1>Run your dispatch company from <span>one panel</span></h1>
          <p className="hp-lead">
            Loads, trucks and drivers, carrier statements, invoices and payments — in one place built for dispatchers.
            Plus carrier checks by MC or USDOT and new MC leads every day.
          </p>
          <div className="hp-cta">
            <StartButton />
            <a className="hp-btn" href="#/leads?go=1" data-track="get_leads"><span className="hp-play hp-zap"><Icon name="zap" size={12} /></span>Get today’s MC leads</a>
          </div>
          <p className="hp-fine"><Icon name="check" size={14} />Free during beta<Icon name="check" size={14} />No credit card<Icon name="check" size={14} />MC leads without sign-up</p>
        </div>
        <HeroVideo onPlay={play} />
      </section>

      <section className="hp-band">
        <div className="hp-facts">
          <div><span className="hp-fact-icon"><Icon name="database" size={18} /></span><div><b>Official FMCSA data</b><small>carrier census, licensing &amp; insurance</small></div></div>
          <div><span className="hp-fact-icon"><Icon name="shield" size={18} /></span><div><b>Live SAFER checks</b><small>authority verified in real time</small></div></div>
          <div><span className="hp-fact-icon"><Icon name="zap" size={18} /></span><div><b>150+ new MC a day</b><small>with phone and email</small></div></div>
          <div><span className="hp-fact-icon"><Icon name="dollar" size={18} /></span><div><b>$0 during beta</b><small>no credit card needed</small></div></div>
        </div>
      </section>

      <section className="hp-section">
        <div className="hp-head">
          <p className="hp-kicker">Platform</p>
          <h2>Everything your dispatch office runs on</h2>
          <p>Replace the load spreadsheet, the statement templates and the dozen browser tabs.</p>
        </div>
        <div className="hp-rows">
          {ROWS.map((r, i) => (
            <div key={r.title} className={`hp-row ${i % 2 ? 'flip' : ''}`}>
              <div className="hp-row-text">
                <p className="hp-kicker">{r.eyebrow}</p>
                <h3>{r.title}</h3>
                <p>{r.text}</p>
                <ul className="hp-list">{r.points.map((p) => <Check key={p}>{p}</Check>)}</ul>
              </div>
              <div className="hp-row-visual">{r.visual}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="hp-section hp-leadband">
        <div className="hp-split">
          <div>
            <p className="hp-kicker">New MC leads</p>
            <h2>Find your next carrier before anyone else</h2>
            <p>Every day 150+ carriers get their FMCSA authority — and most don’t have a dispatcher yet. HaulPanel lists them with phone and email, so your team calls them first.</p>
            <ul className="hp-list">
              <Check>New authorities from today, yesterday, or the last 30 days</Check>
              <Check>Phone and email for every carrier, verified on SAFER</Check>
              <Check>Export to Excel, Google Sheets or your phone’s contacts</Check>
            </ul>
            <a className="hp-btn" href="#/leads" data-track="leads_section">See today’s new MC leads<Icon name="arrow" size={16} /></a>
          </div>
          <div className="hp-leads-card">
            <div className="hp-leads-head"><b><span className="hv-bolt"><Icon name="zap" size={13} /></span>New MC leads · Today</b><span>152 carriers</span></div>
            {[['B•••• Express LLC', 'TX', '2 trucks'], ['S•••• Trucking Inc', 'IL', '1 truck'], ['M•••• Logistics LLC', 'GA', '3 trucks'], ['R•••• Transport', 'OH', '1 truck']].map(([n, st, tr]) => (
              <div key={n} className="hp-lrow"><span><b>{n}</b><small>MC-1712••• · {st} · {tr}</small></span><span className="ph">(•••) •••-••••</span><i className="hp-pill paid">Authorized</i></div>
            ))}
          </div>
        </div>
      </section>

      <section className="hp-section">
        <div className="hp-head">
          <p className="hp-kicker">Getting started</p>
          <h2>Up and running before your next load</h2>
        </div>
        <ol className="hp-timeline">
          {STEPS.map(([title, text], i) => <li key={title}><span>{i + 1}</span><h3>{title}</h3><p>{text}</p></li>)}
        </ol>
      </section>

      <section className="hp-section">
        <div className="hp-plan">
          <div className="hp-plan-text">
            <p className="hp-kicker">Pricing</p>
            <h2>Free while we’re in beta</h2>
            <p>Everything in HaulPanel is free for dispatch companies during the beta. No credit card, no limits on loads or carriers. Accounts for carriers and freight brokers are coming next.</p>
          </div>
          <div className="hp-plan-card">
            <div className="hp-plan-top"><span>Dispatch company</span><b>$0</b><small>per month during beta</small></div>
            <ul className="hp-list">{PLAN.map((p) => <Check key={p}>{p}</Check>)}</ul>
            <StartButton>Create your free account</StartButton>
          </div>
        </div>
      </section>

      <section className="hp-final">
        <h2>Start running your dispatch on HaulPanel</h2>
        <p>Free during beta. Bring your loads from Excel, CSV or Google Sheets.</p>
        <div className="hp-cta center">
          <StartButton>Create a free account</StartButton>
          <DemoButton dark onPlay={play} />
        </div>
      </section>
    </div>
  )
}
