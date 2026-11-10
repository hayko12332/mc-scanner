import type { ScannedCarrier } from '../types'

export interface Filters {
  skipCarrierBroker: boolean
  onlyActive: boolean
  onlyWithPhone: boolean
}

export const carrierKey = (c: { mc: number; dot: string }) => `${c.mc}|${c.dot}`

const ENTITY: Record<string, string> = {
  C: 'Carrier', B: 'Broker', S: 'Shipper', F: 'Freight forwarder', R: 'Registrant', T: 'Cargo tank',
  I: 'Intermodal equipment provider',
}

/** Census entity codes ("C;B") -> "Carrier + Broker". */
export const entityLabel = (codes: string) =>
  codes.split(/[;,\s]+/).filter(Boolean).map((c) => ENTITY[c] ?? c).join(' + ')

export const isBroker = (c: ScannedCarrier) =>
  c.safer ? c.safer.broker : c.authority.broker === 'A' || c.entityTypes.includes('B')

const isActive = (c: ScannedCarrier) => (c.safer ? c.safer.usdotStatus === 'ACTIVE' : c.usdotStatus === 'A')

export function passesFilters(c: ScannedCarrier, f: Filters): boolean {
  if (f.skipCarrierBroker && isBroker(c)) return false
  if (f.onlyActive && !isActive(c)) return false
  if (f.onlyWithPhone && !c.phone && !c.cellPhone) return false
  return true
}

export function authorityLabel(c: ScannedCarrier): string {
  if (c.safer) {
    return c.safer.authorizedFor
      .map((t) => t.replace(/ \(Except Household Goods\)/, '').replace(/^Motor Carrier of /, ''))
      .join(' + ')
  }
  const a = c.authority
  return [a.common === 'A' && 'Common', a.contract === 'A' && 'Contract', a.broker === 'A' && 'Broker']
    .filter(Boolean)
    .join(' + ')
}
