import type { ReactNode } from 'react'
import { Icon, type IconName } from '../components/Icon'

const LOADS: [string, string, string, string, string, string, string, string][] = [
  ['Nov 13', 'Landstar', '# LS-77001', 'Aurora, CO → Dallas, TX', '775 mi', '$2,400', '$3.10/mi', 'booked'],
  ['Nov 11', 'C.H. Robinson', '# CHR-5530187', 'Kansas City, MO → Denver, CO', '606 mi', '$1,900', '$3.14/mi', 'transit'],
  ['Nov 10', 'Total Quality Logistics', '# TQL-9921045', 'Nashville, TN → Orlando, FL', '686 mi', '$2,100', '$3.06/mi', 'delivered'],
  ['Nov 9', 'Steam Logistics', '# 2277332', 'Peru, IL → San Luis, AZ', '1,921 mi', '$4,300', '$2.24/mi', 'paid'],
]
const STATUS: Record<string, string> = { booked: 'Booked', transit: 'In transit', delivered: 'Delivered', paid: 'Paid' }

/** A small, faithful picture of the load board, so the first screen shows the product itself. */
function ProductShot() {
  return (
    <div className="lp-shot" aria-label="HaulPanel load board">
      <div className="lp-shot-bar">
        <i /><i /><i />
        <span>haulpanel.com · Dispatch</span>
      </div>
      <div className="lp-shot-tabs">
        <b>Loads</b><span>Statements</span><span>Carriers</span><span>Trucks</span><span>Dispatchers</span>
      </div>
      <div className="lp-shot-kpis">
        <div><span>Gross this week</span><b>$10,700</b><small className="up">▲ 12% vs last week</small></div>
        <div><span>Rate per mile</span><b>$2.68</b><small>3,988 loaded mi</small></div>
        <div><span>Dispatch fees</span><b>$856</b><small>owed by carriers</small></div>
        <div><span>Not paid yet</span><b>$28,450</b><small className="down">1 overdue</small></div>
      </div>
      <div className="lp-shot-table">
        {LOADS.map(([date, broker, pro, lane, miles, rate, rpm, st]) => (
          <div key={pro} className="lp-shot-row">
            <span className="d">{date}</span>
            <span><b>{broker}</b><small>{pro}</small></span>
            <span className="lane"><b>{lane}</b><small>{miles}</small></span>
            <span className="r"><b>{rate}</b><small>{rpm}</small></span>
            <span><i className={`lp-pill ${st}`}>{STATUS[st]}</i></span>
          </div>
        ))}
      </div>
    </div>
  )
}

const FEATURES: { icon: IconName; title: string; text: string; visual: ReactNode }[] = [
  {
    icon: 'file',
    title: 'Dispatch board',
    text: 'Every load from booking to payment: broker and load #, lane with loaded and empty miles, truck and driver, rate per mile. Overdue invoices are flagged for you.',
    visual: (
      <div className="lp-flow">
        {['Booked', 'In transit', 'Delivered', 'Invoiced', 'Paid'].map((s, i) => (
          <span key={s} className={`lp-pill ${['booked', 'transit', 'delivered', 'invoiced', 'paid'][i]}`}>{s}</span>
        ))}
      </div>
    ),
  },
  {
    icon: 'dollar',
    title: 'Carrier statements & pay',
    text: 'Set each carrier’s fee — percent of gross or a flat weekly amount. One click makes the weekly statement PDF; every dispatcher’s pay is counted too.',
    visual: (
      <div className="lp-kv">
        <div><span>BEKU Trucking · 4 loads</span><b>$8,350</b></div>
        <div><span>Dispatch fee · 8% of gross</span><b>$668</b></div>
        <div className="due"><span>Amount due</span><b>$668.00</b></div>
      </div>
    ),
  },
  {
    icon: 'search',
    title: 'Company lookup',
    text: 'Check any carrier or broker by MC, USDOT, email or phone: operating authority, insurance, live SAFER status, fleet — and other companies sharing the same contact.',
    visual: (
      <div className="lp-search">
        <span><Icon name="search" size={14} />MC 1188808</span>
        <div><b>UZLAND LLC</b><i className="lp-pill paid">Authorized</i></div>
        <small>USDOT 3550347 · Insurance on file · 2 trucks</small>
      </div>
    ),
  },
  {
    icon: 'zap',
    title: 'New MC leads',
    text: 'Carriers that got their authority today, with phone and email — your next customers. Copy, call, or export to Excel, Google Sheets and your phone.',
    visual: (
      <div className="lp-leads">
        {['B•••• Express LLC · TX', 'S•••• Trucking Inc · IL', 'M•••• Logistics LLC · GA'].map((n) => (
          <div key={n}><b>{n}</b><span>(•••) •••-••12</span></div>
        ))}
      </div>
    ),
  },
]

const STEPS: [string, string][] = [
  ['Create your account', 'Sign up with your email or Google account. Free during beta — no credit card.'],
  ['Add your carriers', 'Type an MC number and the company name, USDOT and phone fill in from FMCSA. Add trucks and drivers.'],
  ['Run your week', 'Log loads in seconds — miles and RPM calculate themselves. Send carrier statements every Monday.'],
]

/** Landing page: HaulPanel as a TMS for dispatch companies, with company lookup and new MC leads alongside. */
export function HomePage({ backendOk }: { backendOk: boolean | null }) {
  void backendOk
  return (
    <>
      <section className="lp-hero">
        <div className="wrap lp-hero-grid">
          <div className="lp-hero-text">
            <span className="lp-chip"><i>Beta</i>Free TMS for truck dispatchers</span>
            <h1>Run your dispatch company <span>from one panel</span></h1>
            <p>
              Loads, trucks and drivers, rate per mile, carrier fees and weekly statements, invoices and payments — in one place.
              Plus company checks by MC or USDOT and new MC leads every day.
            </p>
            <div className="lp-cta">
              <a className="btn primary big" href="#/crm?signup">Start free<Icon name="arrow" size={16} /></a>
              <a className="btn big ghost" href="#/crm?demo=1">See the demo</a>
            </div>
            <ul className="lp-fine">
              <li><Icon name="check" size={14} />Free during beta</li>
              <li><Icon name="check" size={14} />No credit card</li>
              <li><Icon name="check" size={14} />Set up in 2 minutes</li>
            </ul>
          </div>
          <ProductShot />
        </div>
        <div className="wrap lp-trust">
          <span>Built on official data</span>
          <b><Icon name="database" size={15} />FMCSA open data</b>
          <b><Icon name="shield" size={15} />Live SAFER checks</b>
          <b><Icon name="pin" size={15} />Driving miles from the map</b>
          <b><Icon name="refresh" size={15} />Updated daily</b>
        </div>
      </section>

      <section className="lp-section">
        <div className="lp-head">
          <span className="lp-eyebrow">One panel</span>
          <h2>Everything your dispatch office runs on</h2>
          <p>Replace the load spreadsheet, the statement templates and the dozen SAFER tabs.</p>
        </div>
        <div className="lp-features">
          {FEATURES.map((f) => (
            <article key={f.title} className="lp-card">
              <div className="lp-card-icon"><Icon name={f.icon} size={18} /></div>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
              <div className="lp-card-visual">{f.visual}</div>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-section">
        <div className="lp-head">
          <span className="lp-eyebrow">Getting started</span>
          <h2>Up and running before your next load</h2>
        </div>
        <ol className="lp-steps">
          {STEPS.map(([title, text], i) => (
            <li key={title}><span>{i + 1}</span><h3>{title}</h3><p>{text}</p></li>
          ))}
        </ol>
      </section>

      <section className="lp-section">
        <div className="lp-head">
          <span className="lp-eyebrow">Who it’s for</span>
          <h2>Built for dispatchers first</h2>
          <p>HaulPanel works today for dispatch companies. Accounts for carriers and freight brokers are on the way.</p>
        </div>
        <div className="lp-who">
          <div className="now">
            <span className="lp-tag ok">Available now</span>
            <h3>Dispatch companies</h3>
            <p>Dispatch trucks for several carriers, bill each one its fee and pay your dispatchers — from one board.</p>
            <a href="#/crm?signup">Start free →</a>
          </div>
          <div>
            <span className="lp-tag">Coming soon</span>
            <h3>Carriers & fleets</h3>
            <p>Your own trucks and drivers: settlements, fuel and maintenance, IFTA-ready miles.</p>
          </div>
          <div>
            <span className="lp-tag">Coming soon</span>
            <h3>Freight brokers</h3>
            <p>Carrier vetting, rate confirmations and load tracking for brokerages.</p>
          </div>
        </div>
      </section>

      <section className="lp-final">
        <h2>Start running your dispatch on HaulPanel</h2>
        <p>Free during beta. Bring your loads from Google Sheets in one paste.</p>
        <div className="lp-cta center">
          <a className="btn primary big" href="#/crm?signup">Create a free account<Icon name="arrow" size={16} /></a>
          <a className="btn big ghost" href="#/crm?demo=1">See the demo</a>
        </div>
      </section>
    </>
  )
}
