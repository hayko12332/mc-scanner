import { useEffect, useState, type ReactNode } from 'react'
import { track } from '../lib/analytics'
import { Icon, type IconName } from '../components/Icon'
import { ProductShot } from '../components/ProductShot'

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

/** The pains a dispatch office lives with, and what HaulPanel does about each. */
const PAINS: [IconName, string, string, string][] = [
  ['dollar', 'Monday statements take half a day', 'Copying loads into a template for every carrier, working out 8% of the gross, double-checking the math.',
    'Statements are ready every Monday: each carrier’s fee — percent or flat — and a PDF to send.'],
  ['clock', 'Unpaid loads slip through the cracks', 'Invoices sit in email, nobody remembers which broker is 40 days late, and cash flow suffers.',
    'Every invoice is tracked against net-30. Overdue loads turn red on the board and in the totals.'],
  ['file', 'The spreadsheet only one person understands', 'Rate per mile on a calculator, deadhead guessed, numbers that never match between dispatchers.',
    'Miles come from the map, deadhead from the truck’s last drop. RPM, gross and dispatcher pay add up on their own.'],
]

const FAQ: [string, string][] = [
  ['Is HaulPanel really free?', 'Yes. Everything is free for dispatch companies during the beta — no credit card and no limits on loads, carriers or trucks. We will tell you well in advance before any paid plan starts, and you can export all your data at any time.'],
  ['Can I bring my loads from Excel or Google Sheets?', 'Yes. Upload an .xlsx or .csv file, or paste straight from Google Sheets. HaulPanel recognizes the usual columns (date, broker, load #, origin, destination, rate, miles) and shows a preview before importing.'],
  ['Who can see my data?', 'Only your company. Every account’s loads, carriers and statements are private to that account and are never shared or sold.'],
  ['Do I need to install anything?', 'No. HaulPanel runs in the browser on a computer, tablet or phone. Sign up and your board is ready.'],
  ['What is a dispatch fee, and how is it counted?', 'For each carrier you set either a percent of gross (for example 8%) or a flat weekly amount. HaulPanel applies it per week to that carrier’s loads, and puts it on the weekly statement.'],
  ['What data do Lookup and MC leads use?', 'Official FMCSA open data (carrier census, licensing and insurance) with live SAFER checks. HaulPanel is not affiliated with FMCSA or USDOT.'],
]

function Check({ children }: { children: ReactNode }) {
  return <li><Icon name="check" size={15} />{children}</li>
}

/** Primary call to action: solid button with an arrow that moves on hover. */
export function StartButton({ children = 'Start free', big = true }: { children?: ReactNode; big?: boolean }) {
  return <a className={`hp-btn primary ${big ? '' : 'sm'}`} href="#/crm?signup" data-track="start_free">{children}<Icon name="arrow" size={16} /></a>
}
/** The live demo board with sample data: try the product without signing up. */
function LiveDemoButton({ dark = false }: { dark?: boolean }) {
  return <a className={`hp-btn ${dark ? 'dark' : ''}`} href="#/crm?demo=1" data-track="live_demo"><span className="hp-play"><Icon name="play" size={11} /></span>Open the live demo</a>
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

/** Landing page: HaulPanel as a TMS for dispatch companies — the pain, the product, the proof, then the answers. */
export function HomePage({ backendOk }: { backendOk: boolean | null }) {
  void backendOk
  const [video, setVideo] = useState(false)
  const [open, setOpen] = useState<number | null>(0)
  const play = () => { track('demo_video'); setVideo(true) }
  // How far people read the page (once per milestone per visit), to see where they stop.
  useEffect(() => {
    const seen = new Set<number>()
    const onScroll = () => {
      const max = document.scrollingElement!.scrollHeight - innerHeight
      const pct = max > 0 ? (scrollY / max) * 100 : 100
      for (const m of [25, 50, 75, 100]) if (pct >= m - 2 && !seen.has(m)) { seen.add(m); track('home_scroll', { pct: m }) }
    }
    addEventListener('scroll', onScroll, { passive: true })
    return () => removeEventListener('scroll', onScroll)
  }, [])
  return (
    <div className="hp hp3">
      {video && <DemoVideo close={() => setVideo(false)} />}
      <section className="hp3-hero">
        <div className="hp3-hero-text">
          <span className="hp3-chip"><i />Free TMS for truck dispatch companies</span>
          <h1>Your whole dispatch office <span>on one board</span></h1>
          <p className="hp-lead">
            Loads, rate per mile, carrier fees, weekly statements and unpaid invoices — counted for you.
            Stop rebuilding the spreadsheet every Monday.
          </p>
          <div className="hp-cta">
            <StartButton>Start your free TMS</StartButton>
            <a className="hp-btn" href="#/leads?go=1" data-track="get_leads"><span className="hp-play hp-zap"><Icon name="zap" size={12} /></span>Get today’s MC leads</a>
          </div>
          <p className="hp-fine"><Icon name="check" size={14} />Free during beta<Icon name="check" size={14} />No credit card<Icon name="check" size={14} />MC leads without sign-up</p>
        </div>
        {/* The whole picture opens the tour; the play button sits where the eye lands first. */}
        <button type="button" className="hp3-shot" onClick={play} data-track="hero_tour" aria-label="Watch the 90-second tour of HaulPanel">
          <span className="hp3-frame">
            <span className="hp3-bar"><i /><i /><i /><em>haulpanel.com · Dispatch board</em></span>
            <ProductShot />
          </span>
          <span className="hp3-play">
            <span className="hp3-play-btn"><Icon name="play" size={22} /></span>
            <span className="hp3-play-text"><b>Watch the tour</b><small>1:35 · with sound</small></span>
          </span>
        </button>
      </section>

      <section className="hp-section">
        <div className="hp-head">
          <p className="hp-kicker">Sound familiar?</p>
          <h2>Dispatching is hard enough without the paperwork</h2>
          <p>HaulPanel takes the busywork off your dispatchers so they can spend the day booking loads.</p>
        </div>
        <div className="hp3-pains">
          {PAINS.map(([icon, pain, text, fix]) => (
            <div key={pain} className="hp3-pain">
              <span className="hp3-pain-icon"><Icon name={icon} size={18} /></span>
              <h3>{pain}</h3>
              <p>{text}</p>
              <div className="hp3-fix"><Icon name="check" size={15} /><span><b>With HaulPanel:</b> {fix}</span></div>
            </div>
          ))}
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

      <section className="hp-section">
        <div className="hp3-included">
          <div>
            <p className="hp-kicker">Included</p>
            <h2>Free tools that come with your board</h2>
            <p>Open them from the board’s sidebar — no extra accounts, no extra tabs.</p>
          </div>
          <div className="hp3-tools">
            <div><span className="hp3-pain-icon"><Icon name="search" size={18} /></span><b>Company lookup</b><small>Check any carrier or broker by MC, USDOT, email or phone: authority, insurance, live SAFER status, related companies.</small></div>
            <div><span className="hp3-pain-icon"><Icon name="zap" size={18} /></span><b>New MC leads</b><small>Carriers and brokers that just got their FMCSA authority — 150+ a day — with phone and email, ready to export.</small></div>
            <div><span className="hp3-pain-icon"><Icon name="database" size={18} /></span><b>Excel &amp; Sheets import</b><small>Bring your load history in a minute: upload a file or paste from Google Sheets, check the preview, import.</small></div>
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

      <section className="hp-section">
        <div className="hp-head">
          <p className="hp-kicker">Questions</p>
          <h2>Before you sign up</h2>
        </div>
        <div className="hp3-faq">
          {FAQ.map(([q, a], i) => (
            <div key={q} className={`hp3-q ${open === i ? 'open' : ''}`}>
              <button type="button" aria-expanded={open === i} onClick={() => { setOpen(open === i ? null : i); if (open !== i) track('faq_open', { q: q.slice(0, 40) }) }}>
                {q}<Icon name="chevron" size={18} />
              </button>
              {open === i && <p>{a}</p>}
            </div>
          ))}
        </div>
      </section>

      <section className="hp-final">
        <h2>Run next week on HaulPanel</h2>
        <p>Free during beta. Bring your loads from Excel, CSV or Google Sheets.</p>
        <div className="hp-cta center">
          <StartButton>Create a free account</StartButton>
          <LiveDemoButton dark />
        </div>
        <button type="button" className="hp3-final-tour" onClick={play}><Icon name="play" size={12} />Or watch the 90-second tour</button>
      </section>
    </div>
  )
}
