import { Icon, type IconName } from './Icon'

/*
 * DESIGN REFERENCE — the target layout for the real dispatch app (kept on purpose, not used on the site now).
 * The owner wants the app itself to look like this picture: a dark left sidebar (logo, Loads, Statements,
 * Carriers, Trucks, Dispatchers, Lookup, MC leads), status tabs with counts and "+ New load" on top, a KPI row,
 * and the load table grouped by week with green weekly totals. Styles: the .hp-app / .hp-side / .hp-main /
 * .hp-kpis / .hp-table / .hp-week / .hp-pill rules in index.css. It used to be the landing page hero
 * (until 2026-11-14, when a looping video replaced it).
 */

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
export function ProductShot() {
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

