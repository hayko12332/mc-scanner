// Demo mode of the dispatch board: the same calls as the server API, kept in this browser only (localStorage),
// seeded with a realistic small dispatch operation so visitors can try everything without an account.

import {
  addDays, today, weekStart,
  type CarrierInput, type CrmCarrier, type CrmState, type Dispatcher, type ImportRow, type Load, type LoadInput, type LoadStatus,
} from './crm'

const KEY = 'leadhaul.dispatchDemo.v1'

interface DemoData { carriers: CrmCarrier[]; dispatchers: Dispatcher[]; loads: Load[]; nextId: number }

const USER = { id: 0, email: 'demo@leadhaul', name: 'Demo dispatcher', picture: '' }

/** Sample loads over the last four weeks, dated relative to today so "this week" always has data. */
function seed(): DemoData {
  const carriers: CrmCarrier[] = [
    { id: 1, name: 'BEKU Trucking', mc: '1234567', dot: '3912345', phone: '(312) 555-0142', email: 'dispatch@bekutrucking.com', notes: '' },
    { id: 2, name: 'Ararat Express', mc: '1187654', dot: '3876543', phone: '(818) 555-0199', email: 'ops@araratexpress.com', notes: '' },
  ]
  const dispatchers: Dispatcher[] = [
    { id: 1, name: 'Sergo', percent: 7 },
    { id: 2, name: 'Yur', percent: 5 },
    { id: 3, name: 'Beku', percent: 6 },
  ]
  const week = weekStart(today())
  const rows: [number, number, number, string, string, string, string, number, LoadStatus][] = [
    // [days from this Monday, carrier, dispatcher, broker, PRO#, origin, destination, rate, status]
    [-20, 1, 1, 'TTS LLC', '16482877', 'Fishersville, VA', 'Willis, TX', 2000, 'paid'],
    [-17, 1, 1, 'Time Logistics INC', 'LD408864', 'Houston, TX', 'Aiken, SC', 2600, 'paid'],
    [-16, 2, 2, 'Arrive Logistics', 'AR-55102', 'Laredo, TX', 'Memphis, TN', 2150, 'paid'],
    [-13, 1, 1, 'MCM Transportation', '95806', 'Loveland, CO', 'Albuquerque, NM', 1600, 'paid'],
    [-12, 1, 2, 'US Logistics', 'U6851249', 'Show Low, AZ', 'Allentown, PA', 3800, 'paid'],
    [-10, 2, 3, 'Echo Global Logistics', 'E-778190', 'Chicago, IL', 'Atlanta, GA', 2350, 'invoiced'],
    [-9, 1, 3, 'Beku Dispatch', 'BD-3700', 'Columbus, OH', 'Dallas, TX', 3700, 'invoiced'],
    [-6, 1, 1, 'DG Global Cargo Inc', 'T882496', 'Red Lion, PA', 'Altoona, IA', 2000, 'delivered'],
    [-5, 2, 2, 'RXO', 'RX-301877', 'Ontario, CA', 'Phoenix, AZ', 1450, 'delivered'],
    [-4, 1, 3, 'Buchanan Logistics', '3443716', 'Timewell, IL', 'Salem, WV', 1500, 'invoiced'],
    [-3, 2, 1, 'Coyote Logistics', '18840221', 'Dallas, TX', 'Atlanta, GA', 2450, 'delivered'],
    [0, 1, 1, 'Steam Logistics, LLC', '2277332', 'Peru, IL', 'San Luis, AZ', 3800, 'in_transit'],
    [1, 2, 2, 'Total Quality Logistics', 'TQL-9921045', 'Nashville, TN', 'Orlando, FL', 2100, 'in_transit'],
    [2, 1, 3, 'C.H. Robinson', 'CHR-5530187', 'Kansas City, MO', 'Denver, CO', 1900, 'booked'],
  ]
  const loads: Load[] = rows
    .filter(([d]) => addDays(week, d) <= today())
    .map(([d, carrierId, dispatcherId, broker, pro, origin, destination, rate, status], i) => ({
      id: i + 1, date: addDays(week, d), carrierId, dispatcherId, broker, pro, origin, destination, rate, notes: '', status,
    }))
  return { carriers, dispatchers, loads, nextId: 100 }
}

function load(): DemoData {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as DemoData
  } catch {
    // storage blocked or unreadable: start from the sample data
  }
  const data = seed()
  save(data)
  return data
}

function save(d: DemoData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d))
  } catch {
    // storage blocked: the demo still works until the page is reloaded
  }
}

let data: DemoData | null = null
const db = () => (data ??= load())
const change = <T>(fn: (d: DemoData) => T): Promise<T> => {
  const d = db()
  const out = fn(d)
  save(d)
  return Promise.resolve(out)
}

export const crmDemo = {
  state: (): Promise<CrmState> => {
    const d = db()
    return Promise.resolve({
      user: USER,
      dispatchers: [...d.dispatchers].sort((a, b) => a.name.localeCompare(b.name)),
      carriers: [...d.carriers].sort((a, b) => a.name.localeCompare(b.name)),
      loads: [...d.loads].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id),
    })
  },
  addLoad: (l: LoadInput) => change((d) => { const load = { ...l, id: d.nextId++ }; d.loads.push(load); return load }),
  updateLoad: (id: number, l: LoadInput) => change((d) => { const i = d.loads.findIndex((x) => x.id === id); if (i >= 0) d.loads[i] = { ...l, id }; return d.loads[i] }),
  removeLoad: (id: number) => change((d) => { d.loads = d.loads.filter((x) => x.id !== id) }),
  addCarrier: (c: CarrierInput) => change((d) => { const x = { ...c, id: d.nextId++ }; d.carriers.push(x); return x }),
  removeCarrier: (id: number) => change((d) => { d.carriers = d.carriers.filter((x) => x.id !== id) }),
  addDispatcher: (x: Omit<Dispatcher, 'id'>) => change((d) => { const n = { ...x, id: d.nextId++ }; d.dispatchers.push(n); return n }),
  updateDispatcher: (x: Dispatcher) => change((d) => { d.dispatchers = d.dispatchers.map((y) => (y.id === x.id ? x : y)); return x }),
  removeDispatcher: (id: number) => change((d) => { d.dispatchers = d.dispatchers.filter((x) => x.id !== id) }),
  importLoads: (rows: ImportRow[]) => change((d) => {
    const find = <T extends { id: number; name: string }>(list: T[], name: string, make: (name: string, id: number) => T) => {
      const key = name.trim().toLowerCase()
      if (!key) return null
      let x = list.find((y) => y.name.toLowerCase() === key)
      if (!x) { x = make(name.trim(), d.nextId++); list.push(x) }
      return x.id
    }
    for (const r of rows) {
      d.loads.push({
        id: d.nextId++, date: r.date, broker: r.broker, pro: r.pro, origin: r.origin, destination: r.destination, rate: r.rate, notes: '', status: 'booked',
        carrierId: find(d.carriers, r.carrier, (name, id) => ({ id, name, mc: '', dot: '', phone: '', email: '', notes: '' })),
        dispatcherId: find(d.dispatchers, r.dispatcher, (name, id) => ({ id, name, percent: 0 })),
      })
    }
    return { imported: rows.length }
  }),
  /** Starts the demo over with the sample data. */
  reset: () => { data = seed(); save(data) },
}
