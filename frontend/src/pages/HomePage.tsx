import { useEffect, useState, type ReactNode } from 'react'
import { track } from '../lib/analytics'
import { Icon, type IconName } from '../components/Icon'

type St = 'booked' | 'transit' | 'delivered' | 'invoiced' | 'paid'
const STATUS: Record<St, string> = { booked: 'Booked', transit: 'In transit', delivered: 'Delivered', invoiced: 'Invoiced', paid: 'Paid' }
const LOADS: { date: string; broker: string; pro: string; from: string; to: string; mi: string; carrier: string; truck: string; rate: string; rpm: string; disp: string; st: St }[] = [
  { date: 'Nov 13', broker: 'Landstar', pro: 'LS-77001', from: 'Aurora, CO', to: 'Dallas, TX', mi: '775 mi', carrier: 'BEKU Trucking', truck: '#101 · Arman K.', rate: '$2,400', rpm: '$3.10', disp: 'Beku', st: 'booked' },
  { date: 'Nov 11', broker: 'C.H. Robinson', pro: 'CHR-5530187', from: 'Kansas City, MO', to: 'Denver, CO', mi: '606 mi', carrier: 'BEKU Trucking', truck: '#101 · Arman K.', rate: '$1,900', rpm: '$3.14', disp: 'Beku', st: 'transit' },
  { date: 'Nov 10', broker: 'Total Quality Logistics', pro: 'TQL-9921045', from: 'Nashville, TN', to: 'Orlando, FL', mi: '686 mi', carrier: 'Ararat Express', truck: '#7 · Levon A.', rate: '$2,100', rpm: '$3.06', disp: 'Yur', st: 'transit' },
  { date: 'Nov 9', broker: 'Steam Logistics', pro: '2277332', from: 'Peru, IL', to: 'San Luis, AZ', mi: '1,921 mi', carrier: 'BEKU Trucking', truck: '#102 · David M.', rate: '$4,300', rpm: '$2.24', disp: 'Sergo', st: 'delivered' },
  { date: 'Nov 6', broker: 'Coyote Logistics', pro: '18840221', from: 'Dallas, TX', to: 'Atlanta, GA', mi: '781 mi', carrier: 'Ararat Express', truck: '#7 · Levon A.', rate: '$2,450', rpm: '$3.14', disp: 'Sergo', st: 'invoiced' },
  { date: 'Nov 5', broker: 'Buchanan Logistics', pro: '3443716', from: 'Timewell, IL', to: 'Salem, WV', mi: '642 mi', carrier: 'BEKU Trucking', truck: '#101 · Arman K.', rate: '$1,700', rpm: '$2.65', disp: 'Beku', st: 'paid' },
]
const NAV: [IconName, string, boolean][] = [
  ['file', 'Loads', true], ['dollar', 'Statements', false], ['building', 'Carriers', false], ['truck', 'Trucks', false],
  ['calendar', 'Dispatchers', false], ['search', 'Lookup', false], ['zap', 'MC leads', false],
]

/** A faithful picture of the app — sidebar, toolbar, KPIs and the load board — so the first screen shows the product. */
function ProductShot() {
  return (
    <div className="hp-app" aria-label="HaulPanel dispatch board">
      <aside className="hp-side">
        <div className="hp-side-logo"><img src="/logo.svg" alt="" width="22" height="22" /><b>HaulPanel</b></div>
        {NAV.map(([icon, label, on]) => <div key={label} className={on ? 'on' : ''}><Icon name={icon} size={14} />{label}</div>)}
      </aside>
      <div className="hp-main">
        <div className="hp-top">
          <div className="hp-tabs"><b>All 16</b><span>Booked 1</span><span>In transit 2</span><span>Delivered 5</span><span>Invoiced 4</span><span>Paid 4</span><em>Overdue 1</em></div>
          <span className="hp-new">+ New load</span>
        </div>
        <div className="hp-kpis">
          <div><span>Gross</span><b>$40,250</b><small className="up">▲ 12% vs last week</small></div>
          <div><span>Rate per mile</span><b>$2.72</b><small>14,792 loaded mi</small></div>
          <div><span>Dispatch fees</span><b>$3,560</b><small>owed by carriers</small></div>
          <div><span>Not paid yet</span><b>$30,850</b><small className="down">1 overdue · $1,350</small></div>
        </div>
        <div className="hp-table">
          <div className="hp-tr hp-th"><span>Pickup</span><span>Broker · load #</span><span>Lane · miles</span><span>Carrier · truck</span><span className="r">Rate</span><span>Status</span></div>
          <div className="hp-week"><b>This week · Nov 9 – Nov 15</b><span>4 loads · 3,988 mi</span><em>$10,700</em></div>
          {LOADS.map((l, i) => (
            <div key={l.pro}>
              {i === 4 && <div className="hp-week"><b>Week of Nov 2 – Nov 8</b><span>4 loads · 2,746 mi</span><em>$8,350</em></div>}
              <div className="hp-tr">
                <span className="d">{l.date}</span>
                <span><b>{l.broker}</b><small># {l.pro}</small></span>
                <span><b>{l.from} → {l.to}</b><small>{l.mi}</small></span>
                <span><b>{l.carrier}</b><small>{l.truck}</small></span>
                <span className="r"><b>{l.rate}</b><small>{l.rpm}/mi</small></span>
                <span><i className={`hp-pill ${l.st}`}>{STATUS[l.st]}</i></span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
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
  return <a className={`hp-btn primary ${big ? '' : 'sm'}`} href="#/crm?signup">{children}<Icon name="arrow" size={16} /></a>
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
          onEnded={() => track('demo_video_end')} />
        <div className="hp-video-foot">
          <div><b>HaulPanel in 90 seconds</b><span>Loads, statements, payments, company lookup and new MC leads.</span></div>
          <div className="hp-video-cta">
            <a className="hp-btn sm" href="#/crm?demo=1">Try the live demo</a>
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
          <p className="hp-eyebrow"><span>New</span>The TMS for truck dispatch companies</p>
          <h1>Run your dispatch company from <span>one panel</span></h1>
          <p className="hp-lead">
            Loads, trucks and drivers, carrier statements, invoices and payments — in one place built for dispatchers.
            Plus carrier checks by MC or USDOT and new MC leads every day.
          </p>
          <div className="hp-cta">
            <StartButton />
            <DemoButton onPlay={play} />
          </div>
          <p className="hp-fine"><Icon name="check" size={14} />Free during beta<Icon name="check" size={14} />No credit card<Icon name="check" size={14} />Set up in 2 minutes</p>
        </div>
        <ProductShot />
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
            <a className="hp-btn" href="#/leads">See today’s new MC leads<Icon name="arrow" size={16} /></a>
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
