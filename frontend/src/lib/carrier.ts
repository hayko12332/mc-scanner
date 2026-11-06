import type { ScannedCarrier } from '../types'
import { formatDate, formatMoney, formatPhone } from './format'

export interface Filters {
  skipCarrierBroker: boolean
  onlyActive: boolean
  onlyWithPhone: boolean
}

export const carrierKey = (c: { mc: number; dot: string }) => `${c.mc}|${c.dot}`

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

const yesNo = (v: string) => (v === 'Y' ? 'Yes' : v === 'N' ? 'No' : '')

function csvCell(value: unknown): string {
  const s = String(value ?? '')
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function downloadCsv(carriers: ScannedCarrier[]): void {
  const header = ['MC', 'USDOT', 'Legal Name', 'DBA', 'Phone', 'Cell Phone', 'Fax', 'Email', 'Authority', 'SAFER Verified',
    'USDOT Status', 'Officers', 'Address', 'State', 'Power Units', 'Drivers', 'BIPD Required', 'BIPD On File',
    'Cargo On File', 'Bond On File', 'Cargo Types', 'Safety Rating', 'MCS-150 Date', 'Added']
  const lines = carriers.map((c) => [
    `MC-${c.mc}`, c.dot, c.legalName, c.dbaName, formatPhone(c.phone), formatPhone(c.cellPhone), formatPhone(c.fax),
    c.email, authorityLabel(c), c.safer ? formatDate(c.safer.checkedAt) : 'no', c.safer?.usdotStatus ?? c.usdotStatus,
    c.officers.join('; '), c.physicalAddress, c.state, c.powerUnits, c.drivers,
    formatMoney(c.authority.bipdRequired), formatMoney(c.authority.bipdOnFile), yesNo(c.authority.cargoOnFile),
    yesNo(c.authority.bondOnFile), c.cargo.join('; '), c.safetyRating, formatDate(c.mcs150Date), formatDate(c.addedOn),
  ].map(csvCell).join(','))
  const blob = new Blob(['﻿' + [header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
  const mcs = carriers.map((c) => c.mc)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `fmcsa_MC${Math.min(...mcs)}-${Math.max(...mcs)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}
