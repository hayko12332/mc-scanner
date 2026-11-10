import type { ScannedCarrier } from '../types'
import { authorityLabel } from './carrier'
import { formatDate, formatMoney, formatPhone } from './format'
import { telegramApp } from './telegram'
import { buildXlsx, type Cell } from './xlsx'

const yesNo = (v: string) => (v === 'Y' ? 'Yes' : v === 'N' ? 'No' : '')

const HEADER = ['MC', 'USDOT', 'Legal Name', 'DBA', 'Phone', 'Cell Phone', 'Fax', 'Email', 'Authority', 'Authority Granted',
  'SAFER Verified', 'USDOT Status', 'Officers', 'Address', 'State', 'Power Units', 'Drivers', 'BIPD Required',
  'BIPD On File', 'Cargo On File', 'Bond On File', 'Cargo Types', 'Safety Rating', 'MCS-150 Date', 'USDOT Added']

function rowOf(c: ScannedCarrier): Cell[] {
  return [
    `MC-${c.mc}`, c.dot, c.legalName, c.dbaName, formatPhone(c.phone), formatPhone(c.cellPhone), formatPhone(c.fax),
    c.email, authorityLabel(c), formatDate(c.grantedOn ?? null), c.safer ? formatDate(c.safer.checkedAt) : 'no',
    c.safer?.usdotStatus ?? c.usdotStatus, c.officers.join('; '), c.physicalAddress, c.state, c.powerUnits, c.drivers,
    formatMoney(c.authority.bipdRequired), formatMoney(c.authority.bipdOnFile), yesNo(c.authority.cargoOnFile),
    yesNo(c.authority.bondOnFile), c.cargo.join('; '), c.safetyRating, formatDate(c.mcs150Date), formatDate(c.addedOn),
  ]
}

/** File name base: new-mc-leads_<from>_to_<to> for leads, fmcsa_MC<from>-<to> for a scan. */
function baseName(carriers: ScannedCarrier[]) {
  const granted = carriers.map((c) => c.grantedOn).filter(Boolean).sort() as string[]
  if (granted.length) return `new-mc-leads_${granted[0]}_to_${granted[granted.length - 1]}`
  const mcs = carriers.map((c) => c.mc)
  return `fmcsa_MC${Math.min(...mcs)}-${Math.max(...mcs)}`
}

function save(blob: Blob, name: string) {
  if (telegramApp()) return void saveInTelegram(blob, name)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** Telegram's in-app browser can't save a file built by the page: upload it and let Telegram download it from a link. */
async function saveInTelegram(blob: Blob, name: string) {
  const app = telegramApp()!
  try {
    const res = await fetch(`/api/export?name=${encodeURIComponent(name)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: blob,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const url = location.origin + ((await res.json()) as { path: string }).path
    if (app.downloadFile && app.isVersionAtLeast('8.0')) app.downloadFile({ url, file_name: name })
    else app.openLink(url)
  } catch {
    exportNotice('Could not export here — open the website in a browser and try again')
  }
}

/** Lets the page show export problems (set by the page that owns the toast). */
export let exportNotice: (message: string) => void = () => {}
export const onExportNotice = (fn: (message: string) => void) => { exportNotice = fn }

const csvCell = (v: Cell) => {
  const s = String(v ?? '')
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function downloadCsv(carriers: ScannedCarrier[]) {
  const lines = [HEADER, ...carriers.map(rowOf)].map((r) => r.map(csvCell).join(','))
  save(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }), `${baseName(carriers)}.csv`)
}

export function downloadXlsx(carriers: ScannedCarrier[]) {
  const rows = carriers.map((c) => rowOf(c).map((v, i) => (HEADER[i] === 'Power Units' || HEADER[i] === 'Drivers' ? (v ?? null) : v)))
  save(buildXlsx(carriers.some((c) => c.grantedOn) ? 'New MC leads' : 'Carriers', HEADER, rows), `${baseName(carriers)}.xlsx`)
}

/** Copies the table as tab-separated text, which pastes into Google Sheets or Excel as columns. */
export async function copyForSheets(carriers: ScannedCarrier[]) {
  const tsv = [HEADER, ...carriers.map(rowOf)]
    .map((r) => r.map((v) => String(v ?? '').replace(/[\t\n\r]+/g, ' ')).join('\t'))
    .join('\n')
  await navigator.clipboard.writeText(tsv)
}

/** One vCard per carrier: import into phone or Google contacts to call from the dialer. */
export function downloadVcf(carriers: ScannedCarrier[]) {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/[,;]/g, (m) => '\\' + m).replace(/\n/g, '\\n')
  const cards = carriers.map((c) => [
    'BEGIN:VCARD', 'VERSION:3.0',
    `FN:${esc(c.legalName)}`, `ORG:${esc(c.legalName)}`,
    c.phone && `TEL;TYPE=WORK,VOICE:${formatPhone(c.phone)}`,
    c.cellPhone && c.cellPhone !== c.phone && `TEL;TYPE=CELL:${formatPhone(c.cellPhone)}`,
    c.email && `EMAIL;TYPE=WORK:${c.email}`,
    c.physicalAddress && `ADR;TYPE=WORK:;;${esc(c.physicalAddress)};;;;`,
    `NOTE:${esc(`MC-${c.mc} · USDOT ${c.dot}${c.grantedOn ? ` · authority granted ${c.grantedOn}` : ''} · ${c.state}`)}`,
    'CATEGORIES:LeadHaul',
    'END:VCARD',
  ].filter(Boolean).join('\r\n'))
  save(new Blob([cards.join('\r\n')], { type: 'text/vcard;charset=utf-8' }), `${baseName(carriers)}.vcf`)
}

/** Printable call sheet (the browser's print dialog can also save it as PDF). */
export function printCallSheet(carriers: ScannedCarrier[]) {
  const h = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const title = carriers.some((c) => c.grantedOn) ? 'New MC leads' : 'Carriers'
  const rows = carriers.map((c, i) => `<tr>
    <td>${i + 1}</td>
    <td><b>${h(c.legalName)}</b><br><span>MC-${c.mc} · USDOT ${h(c.dot)}${c.grantedOn ? ` · granted ${h(c.grantedOn)}` : ''}</span></td>
    <td>${h(formatPhone(c.phone))}${c.cellPhone && c.cellPhone !== c.phone ? `<br><span>cell ${h(formatPhone(c.cellPhone))}</span>` : ''}</td>
    <td>${h(c.email)}</td><td>${h(c.state)}</td><td>${h(c.powerUnits ?? '')}</td>
    <td class="note"></td></tr>`).join('')
  if (telegramApp()) return exportNotice('Printing works on the website — open it in a browser')
  const w = window.open('', '_blank')
  if (!w) return exportNotice('Allow pop-ups for this site to print')
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title} — LeadHaul</title><style>
    body{font:12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:24px}
    h1{font-size:18px;margin:0 0 2px} p{color:#64748b;margin:0 0 14px}
    table{width:100%;border-collapse:collapse} th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e2e8f0;vertical-align:top}
    th{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;border-bottom:2px solid #0f172a}
    span{color:#64748b;font-size:11px} td.note{width:22%} tr{break-inside:avoid} td:nth-child(3){white-space:nowrap}
  </style></head><body><h1>${title} · ${carriers.length} carriers</h1>
  <p>LeadHaul · ${new Date().toLocaleDateString('en-US', { dateStyle: 'medium' })} · mc-scanner-6nao.onrender.com</p>
  <table><thead><tr><th>#</th><th>Carrier</th><th>Phone</th><th>Email</th><th>State</th><th>Trucks</th><th>Notes</th></tr></thead>
  <tbody>${rows}</tbody></table><script>onload=()=>setTimeout(()=>print(),300)</script></body></html>`)
  w.document.close()
}
