// Demo mode of the dispatch board: the same calls as the server API, kept in this browser only (localStorage),
// seeded with a realistic small dispatch operation so visitors can try everything without an account.

import {
  addDays, crm, LOAD_EXTRAS, today, weekStart,
  type CarrierInput, type CrmCarrier, type CrmState, type Dispatcher, type ImportRow, type Load, type LoadInput, type LoadStatus, type Truck,
  type TruckInput,
} from './crm'

const KEY = 'leadhaul.dispatchDemo.v2'

interface DemoData { carriers: CrmCarrier[]; dispatchers: Dispatcher[]; trucks: Truck[]; loads: Load[]; nextId: number }

const USER = { id: 0, email: 'demo@leadhaul', name: 'Demo dispatcher', picture: '' }

type Row = [number, number, number, number, string, string, string, string, number, number, LoadStatus, Partial<Load>]

/** Sample loads over the last six weeks, dated relative to today so "this week" always has data. */
function seed(): DemoData {
  const carriers: CrmCarrier[] = [
    { id: 1, name: 'BEKU Trucking', mc: '1234567', dot: '3912345', phone: '(312) 555-0142', email: 'dispatch@bekutrucking.com', notes: '', feeType: 'percent', fee: 8, factoring: 'RTS Financial' },
    { id: 2, name: 'Ararat Express', mc: '1187654', dot: '3876543', phone: '(818) 555-0199', email: 'ops@araratexpress.com', notes: '', feeType: 'flat', fee: 300, factoring: '' },
  ]
  const dispatchers: Dispatcher[] = [
    { id: 1, name: 'Sergo', percent: 7 },
    { id: 2, name: 'Yur', percent: 5 },
    { id: 3, name: 'Beku', percent: 6 },
  ]
  const trucks: Truck[] = [
    { id: 1, carrierId: 1, unit: '101', driver: 'Arman K.', phone: '(312) 555-0110' },
    { id: 2, carrierId: 1, unit: '102', driver: 'David M.', phone: '(312) 555-0111' },
    { id: 3, carrierId: 2, unit: '7', driver: 'Levon A.', phone: '(818) 555-0170' },
  ]
  const week = weekStart(today())
  const rows: Row[] = [
    // [days from this Monday, carrier, truck, dispatcher, broker, PRO#, origin, destination, rate, loaded miles, status, extras]
    [-40, 1, 1, 1, 'Swift Logistics', 'SW-118230', 'Joliet, IL', 'Columbus, OH', 1350, 355, 'invoiced', { invoicedOn: addDays(week, -37) }],
    [-20, 1, 1, 1, 'TTS LLC', '16482877', 'Fishersville, VA', 'Willis, TX', 2900, 1330, 'paid', { detention: 150, invoicedOn: addDays(week, -18), paidOn: addDays(week, -1) }],
    [-17, 1, 2, 1, 'Time Logistics INC', 'LD408864', 'Houston, TX', 'Aiken, SC', 2600, 1003, 'paid', { invoicedOn: addDays(week, -15), paidOn: addDays(week, -3) }],
    [-16, 2, 3, 2, 'Arrive Logistics', 'AR-55102', 'Laredo, TX', 'Memphis, TN', 2150, 868, 'paid', { invoicedOn: addDays(week, -14), paidOn: addDays(week, -2) }],
    [-13, 1, 1, 1, 'MCM Transportation', '95806', 'Loveland, CO', 'Albuquerque, NM', 1600, 478, 'paid', { emptyMiles: 40, invoicedOn: addDays(week, -11), paidOn: week }],
    [-12, 1, 2, 2, 'US Logistics', 'U6851249', 'Show Low, AZ', 'Allentown, PA', 4900, 2245, 'invoiced', { lumper: 120, invoicedOn: addDays(week, -8) }],
    [-10, 2, 3, 3, 'Echo Global Logistics', 'E-778190', 'Chicago, IL', 'Atlanta, GA', 2350, 716, 'invoiced', { invoicedOn: addDays(week, -7) }],
    [-9, 1, 1, 3, 'Beku Dispatch', 'BD-3700', 'Columbus, OH', 'Dallas, TX', 3200, 1063, 'invoiced', { invoicedOn: addDays(week, -6) }],
    [-6, 1, 2, 1, 'DG Global Cargo Inc', 'T882496', 'Red Lion, PA', 'Altoona, IA', 2500, 1001, 'delivered', { emptyMiles: 65 }],
    [-5, 2, 3, 2, 'RXO', 'RX-301877', 'Ontario, CA', 'Phoenix, AZ', 1450, 322, 'delivered', { layover: 250 }],
    [-4, 1, 1, 3, 'Buchanan Logistics', '3443716', 'Timewell, IL', 'Salem, WV', 1700, 642, 'delivered', {}],
    [-3, 2, 3, 1, 'Coyote Logistics', '18840221', 'Dallas, TX', 'Atlanta, GA', 2450, 781, 'delivered', { emptyMiles: 30 }],
    [0, 1, 2, 1, 'Steam Logistics, LLC', '2277332', 'Peru, IL', 'San Luis, AZ', 4300, 1921, 'in_transit', { emptyMiles: 85 }],
    [1, 2, 3, 2, 'Total Quality Logistics', 'TQL-9921045', 'Nashville, TN', 'Orlando, FL', 2100, 686, 'in_transit', {}],
    [2, 1, 1, 3, 'C.H. Robinson', 'CHR-5530187', 'Kansas City, MO', 'Denver, CO', 1900, 606, 'booked', { emptyMiles: 45 }],
  ]
  const loads: Load[] = rows
    .filter(([d]) => addDays(week, d) <= today())
    .map(([d, carrierId, truckId, dispatcherId, broker, pro, origin, destination, rate, loadedMiles, status, extra], i) => ({
      ...LOAD_EXTRAS, id: i + 1, date: addDays(week, d), carrierId, truckId, dispatcherId, broker, pro, origin, destination, rate, loadedMiles,
      notes: '', status, ...extra,
    }))
  return { carriers, dispatchers, trucks, loads, nextId: 100 }
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
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)

export const crmDemo = {
  state: (): Promise<CrmState> => {
    const d = db()
    return Promise.resolve({
      user: USER,
      dispatchers: [...d.dispatchers].sort(byName),
      carriers: [...d.carriers].sort(byName),
      trucks: [...d.trucks].sort((a, b) => a.unit.localeCompare(b.unit, undefined, { numeric: true })),
      loads: [...d.loads].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id),
    })
  },
  addLoad: (l: LoadInput) => change((d) => { const load = { ...l, id: d.nextId++ }; d.loads.push(load); return load }),
  updateLoad: (id: number, l: LoadInput) => change((d) => { const i = d.loads.findIndex((x) => x.id === id); if (i >= 0) d.loads[i] = { ...l, id }; return d.loads[i] }),
  removeLoad: (id: number) => change((d) => { d.loads = d.loads.filter((x) => x.id !== id) }),
  addCarrier: (c: CarrierInput) => change((d) => { const x = { ...c, id: d.nextId++ }; d.carriers.push(x); return x }),
  updateCarrier: (id: number, c: CarrierInput) => change((d) => { const x = { ...c, id }; d.carriers = d.carriers.map((y) => (y.id === id ? x : y)); return x }),
  removeCarrier: (id: number) => change((d) => { d.carriers = d.carriers.filter((x) => x.id !== id) }),
  addTruck: (t: TruckInput) => change((d) => { const x = { ...t, id: d.nextId++ }; d.trucks.push(x); return x }),
  updateTruck: (id: number, t: TruckInput) => change((d) => { const x = { ...t, id }; d.trucks = d.trucks.map((y) => (y.id === id ? x : y)); return x }),
  removeTruck: (id: number) => change((d) => { d.trucks = d.trucks.filter((x) => x.id !== id) }),
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
        ...LOAD_EXTRAS, id: d.nextId++, date: r.date, broker: r.broker, pro: r.pro, origin: r.origin, destination: r.destination, rate: r.rate,
        loadedMiles: r.loadedMiles, notes: '', status: 'booked',
        carrierId: find(d.carriers, r.carrier, (name, id) => ({ id, name, mc: '', dot: '', phone: '', email: '', notes: '', feeType: 'percent', fee: 0, factoring: '' })),
        dispatcherId: find(d.dispatchers, r.dispatcher, (name, id) => ({ id, name, percent: 0 })),
      })
    }
    return { imported: rows.length }
  }),
  /** Mileage comes from the real map service; it needs no account. */
  miles: crm.miles,
  /** Starts the demo over with the sample data. */
  reset: () => { data = seed(); save(data) },
}
