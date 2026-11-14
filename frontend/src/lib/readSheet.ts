// Reads a spreadsheet file in the browser into rows of text cells: Excel .xlsx (unzipped with the browser's own
// DecompressionStream, sheet XML read with DOMParser), CSV / TSV / TXT. Nothing is uploaded.

export type Rows = string[][]

export const ACCEPT = '.xlsx,.csv,.tsv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export async function readSheetFile(file: File): Promise<Rows> {
  const name = file.name.toLowerCase()
  if (file.size > 15 * 1024 * 1024) throw new Error('The file is larger than 15 MB — export only the loads table')
  if (name.endsWith('.xls')) throw new Error('This is an old Excel file (.xls). In Excel choose File → Save As → Excel Workbook (.xlsx), or CSV, and upload that.')
  if (name.endsWith('.numbers')) throw new Error('Numbers files can’t be read — in Numbers choose File → Export To → Excel or CSV.')
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) return readXlsx(await file.arrayBuffer())
  return parseDelimited(await file.text())
}

/** Rows → tab-separated text, the format the paste importer reads. */
export const toTsv = (rows: Rows) => rows.map((r) => r.map((c) => c.replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n')

// ---------- CSV / TSV ----------

/** CSV with quotes ("a, b" and "" escapes); the delimiter (tab, comma or semicolon) is taken from the first lines. */
export function parseDelimited(text: string): Rows {
  const sample = text.slice(0, 4000)
  const count = (ch: string) => sample.split(ch).length
  const delim = count('\t') > 1 && count('\t') >= count(',') ? '\t' : count(';') > count(',') ? ';' : ','
  const rows: Rows = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const t = text.replace(/^﻿/, '')
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === delim) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

// ---------- XLSX ----------

interface Entry { name: string; method: number; size: number; offset: number }

function zipEntries(buf: ArrayBuffer): Map<string, Entry> {
  const v = new DataView(buf)
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('This file is not a valid Excel workbook')
  const total = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  const dec = new TextDecoder()
  const out = new Map<string, Entry>()
  for (let n = 0; n < total; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break
    const method = v.getUint16(p + 10, true)
    const size = v.getUint32(p + 20, true)
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true)
    const local = v.getUint32(p + 42, true)
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen))
    const dataAt = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true)
    out.set(name, { name, method, size, offset: dataAt })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

async function unzipText(buf: ArrayBuffer, e: Entry | undefined): Promise<string> {
  if (!e) return ''
  const data = new Uint8Array(buf, e.offset, e.size)
  if (e.method === 0) return new TextDecoder().decode(data)
  if (e.method !== 8) throw new Error('This Excel file uses a compression the browser can’t read — save it as CSV')
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Response(stream).text()
}

const xml = (s: string) => new DOMParser().parseFromString(s, 'application/xml')
const els = (d: Document | Element, tag: string) => Array.from(d.getElementsByTagNameNS('*', tag))

/** Built-in Excel number formats that are dates (14–22, 45–47), plus custom ones with d/m/y outside quotes. */
function dateStyles(stylesXml: string): Set<number> {
  const dates = new Set<number>()
  if (!stylesXml) return dates
  const d = xml(stylesXml)
  const custom = new Map<number, string>()
  for (const f of els(d, 'numFmt')) custom.set(Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') ?? '')
  const isDate = (id: number) => (id >= 14 && id <= 22) || (id >= 45 && id <= 47)
    || (custom.has(id) && /[dmy]/i.test(custom.get(id)!.replace(/"[^"]*"|\[[^\]]*\]/g, '')))
  const xfs = els(d, 'cellXfs')[0]
  if (xfs) els(xfs, 'xf').forEach((xf, i) => { if (isDate(Number(xf.getAttribute('numFmtId') ?? 0))) dates.add(i) })
  return dates
}

/** Excel serial day → YYYY-MM-DD (1900 date system). */
const serialDate = (n: number) => new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10)
const colIndex = (ref: string) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1

export async function readXlsx(buf: ArrayBuffer): Promise<Rows> {
  const files = zipEntries(buf)
  const book = xml(await unzipText(buf, files.get('xl/workbook.xml')))
  const rels = xml(await unzipText(buf, files.get('xl/_rels/workbook.xml.rels')))
  // The first sheet in the workbook's order.
  const first = els(book, 'sheet')[0]
  const rid = first?.getAttribute('r:id') ?? first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
  const target = els(rels, 'Relationship').find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target') ?? 'worksheets/sheet1.xml'
  const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
  const sheet = xml(await unzipText(buf, files.get(sheetPath) ?? files.get('xl/worksheets/sheet1.xml')))
  const shared = els(xml(await unzipText(buf, files.get('xl/sharedStrings.xml')) || '<sst/>'), 'si').map((si) => els(si, 't').map((t) => t.textContent ?? '').join(''))
  const dates = dateStyles(await unzipText(buf, files.get('xl/styles.xml')))

  const rows: Rows = []
  for (const r of els(sheet, 'row')) {
    const idx = Number(r.getAttribute('r') ?? rows.length + 1) - 1
    const row: string[] = []
    for (const c of els(r, 'c')) {
      const type = c.getAttribute('t')
      const raw = els(c, 'v')[0]?.textContent ?? ''
      let val = raw
      if (type === 's') val = shared[Number(raw)] ?? ''
      else if (type === 'inlineStr') val = els(c, 't').map((t) => t.textContent ?? '').join('')
      else if (type === 'b') val = raw === '1' ? 'TRUE' : 'FALSE'
      else if (raw && !type && dates.has(Number(c.getAttribute('s') ?? -1)) && Number(raw) > 0) val = serialDate(Number(raw))
      row[colIndex(c.getAttribute('r') ?? 'A')] = val
    }
    rows[idx] = Array.from(row, (x) => x ?? '')
  }
  return Array.from(rows, (x) => x ?? [])
}
