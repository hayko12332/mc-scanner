import type { ReactNode } from 'react'
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

const FEATURES: { icon: IconName; title: string; text: string; points: string[] }[] = [
  {
    icon: 'file', title: 'Load management',
    text: 'Every load from booking to payment on one board, grouped by week.',
    points: ['Broker, load #, lane, truck and driver', 'Loaded and empty miles fill in from the map', 'Rate per mile and all-in RPM on every load', 'Detention, layover, TONU and lumper'],
  },
  {
    icon: 'dollar', title: 'Carrier statements & pay',
    text: 'Bill each carrier its dispatch fee and pay your dispatchers without a calculator.',
    points: ['Percent of gross or a flat weekly fee', 'Weekly statement PDF in one click', 'Dispatcher pay by each one’s percent', 'Factoring company on the statement'],
  },
  {
    icon: 'clock', title: 'Invoices & payments',
    text: 'Know what’s been invoiced, what’s paid and what’s late.',
    points: ['Booked → In transit → Delivered → Invoiced → Paid', 'Net-30 terms tracked from the invoice date', 'Overdue loads flagged on the board', 'Export to Excel any time'],
  },
  {
    icon: 'search', title: 'Carrier & broker lookup',
    text: 'Check any company before you work with it.',
    points: ['Search by MC, USDOT, email or phone', 'Authority, insurance and live SAFER status', 'Fleet, cargo and state registration', 'Other companies sharing the same contact'],
  },
]

const STEPS: [string, string][] = [
  ['Create your account', 'Sign up with your email or Google. Free during beta, no credit card.'],
  ['Add your carriers and trucks', 'Type an MC number — name, USDOT and phone fill in from FMCSA.'],
  ['Run your week', 'Log loads in seconds, send carrier statements every Monday, track payments.'],
]

function Check({ children }: { children: ReactNode }) {
  return <li><Icon name="check" size={15} />{children}</li>
}

/** Landing page: HaulPanel as a TMS for dispatch companies. Light and quiet, with the product itself up front. */
export function HomePage({ backendOk }: { backendOk: boolean | null }) {
  void backendOk
  return (
    <div className="hp">
      <section className="hp-hero">
        <div className="hp-hero-text">
          <p className="hp-eyebrow">TMS for truck dispatch companies</p>
          <h1>Run your dispatch company from <span>one panel</span></h1>
          <p className="hp-lead">
            Loads, trucks and drivers, carrier statements, invoices and payments — in one place built for dispatchers.
            Plus carrier checks by MC or USDOT and new MC leads every day.
          </p>
          <div className="hp-cta">
            <a className="hp-btn primary" href="#/crm?signup">Start free</a>
            <a className="hp-btn" href="#/crm?demo=1">See the demo</a>
          </div>
          <p className="hp-fine">Free during beta · No credit card · Set up in 2 minutes</p>
        </div>
        <ProductShot />
      </section>

      <section className="hp-band">
        <div className="hp-facts">
          <div><b>FMCSA</b><span>official carrier data</span></div>
          <div><b>Live</b><span>SAFER authority checks</span></div>
          <div><b>150+</b><span>new MC numbers a day</span></div>
          <div><b>$0</b><span>during beta</span></div>
        </div>
      </section>

      <section className="hp-section">
        <div className="hp-head">
          <h2>Everything your dispatch office runs on</h2>
          <p>Replace the load spreadsheet, the statement templates and the dozen browser tabs.</p>
        </div>
        <div className="hp-features">
          {FEATURES.map((f) => (
            <article key={f.title} className="hp-feature">
              <div className="hp-feature-icon"><Icon name={f.icon} size={18} /></div>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
              <ul>{f.points.map((p) => <Check key={p}>{p}</Check>)}</ul>
            </article>
          ))}
        </div>
      </section>

      <section className="hp-section hp-split">
        <div>
          <h2>Find your next carrier before anyone else</h2>
          <p>Every day, 150+ carriers get their FMCSA authority — and most don’t have a dispatcher yet. HaulPanel lists them with phone and email, so your team calls them first.</p>
          <ul className="hp-list">
            <Check>New authorities from today, yesterday, or the last 30 days</Check>
            <Check>Phone and email for every carrier, verified on SAFER</Check>
            <Check>Export to Excel, Google Sheets or your phone’s contacts</Check>
          </ul>
          <a className="hp-link" href="#/leads">See today’s new MC leads →</a>
        </div>
        <div className="hp-leads-card">
          <div className="hp-leads-head"><b>New MC leads · Today</b><span>152 carriers</span></div>
          {[['B•••• Express LLC', 'TX', 'MC-1712•••'], ['S•••• Trucking Inc', 'IL', 'MC-1712•••'], ['M•••• Logistics LLC', 'GA', 'MC-1712•••'], ['R•••• Transport', 'OH', 'MC-1712•••']].map(([n, st, mc]) => (
            <div key={n} className="hp-lrow"><span><b>{n}</b><small>{mc} · {st}</small></span><span className="ph">(•••) •••-••••</span><i className="hp-pill paid">Authorized</i></div>
          ))}
        </div>
      </section>

      <section className="hp-section">
        <div className="hp-head">
          <h2>Up and running before your next load</h2>
        </div>
        <ol className="hp-steps">
          {STEPS.map(([title, text], i) => <li key={title}><span>{i + 1}</span><h3>{title}</h3><p>{text}</p></li>)}
        </ol>
      </section>

      <section className="hp-section">
        <div className="hp-head">
          <h2>Built for dispatch companies</h2>
          <p>HaulPanel works today for dispatchers. Accounts for carriers and freight brokers are on the way.</p>
        </div>
        <div className="hp-who">
          <div className="now">
            <span className="hp-tag ok">Available now</span>
            <h3>Dispatch companies</h3>
            <p>Dispatch trucks for several carriers, bill each one its fee and pay your dispatchers — from one board.</p>
          </div>
          <div>
            <span className="hp-tag">Coming soon</span>
            <h3>Carriers & fleets</h3>
            <p>Your own trucks and drivers: settlements, fuel and maintenance, IFTA-ready miles.</p>
          </div>
          <div>
            <span className="hp-tag">Coming soon</span>
            <h3>Freight brokers</h3>
            <p>Carrier vetting, rate confirmations and load tracking for brokerages.</p>
          </div>
        </div>
      </section>

      <section className="hp-final">
        <h2>Start running your dispatch on HaulPanel</h2>
        <p>Free during beta. Bring your loads from Excel, CSV or Google Sheets.</p>
        <div className="hp-cta center">
          <a className="hp-btn primary" href="#/crm?signup">Create a free account</a>
          <a className="hp-btn dark" href="#/crm?demo=1">See the demo</a>
        </div>
      </section>
    </div>
  )
}
