import { BadRequestException } from '@nestjs/common';
import type { CarrierInput, LoadInput, TruckInput } from './crm.store.js';
import { FEE_TYPES, LOAD_STATUSES, type FeeType, type ImportRow, type LoadStatus } from './crm.types.js';

const text = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const money = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && Math.abs(n) < 1e9 ? Math.round(n * 100) / 100 : 0;
};
/** Non-negative money amount. */
const amount = (v: unknown) => Math.max(0, money(v));
const miles = (v: unknown) => Math.min(20000, Math.max(0, Math.round(money(v))));
const id = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null);

export function isoDate(v: unknown): string | null {
  const s = text(v, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

function loadStatus(v: unknown): LoadStatus {
  if (v === undefined || v === null || v === '') return 'booked';
  if (!(LOAD_STATUSES as readonly unknown[]).includes(v)) throw new BadRequestException(`Status must be one of: ${LOAD_STATUSES.join(', ')}`);
  return v as LoadStatus;
}

export function loadInput(b: Record<string, unknown> = {}): LoadInput {
  const date = isoDate(b.date);
  if (!date) throw new BadRequestException('Date must be YYYY-MM-DD');
  return {
    date,
    carrierId: id(b.carrierId),
    dispatcherId: id(b.dispatcherId),
    broker: text(b.broker),
    pro: text(b.pro, 60),
    origin: text(b.origin),
    destination: text(b.destination),
    rate: money(b.rate),
    notes: text(b.notes, 1000),
    status: loadStatus(b.status),
    truckId: id(b.truckId),
    loadedMiles: miles(b.loadedMiles),
    emptyMiles: miles(b.emptyMiles),
    detention: amount(b.detention),
    layover: amount(b.layover),
    tonu: amount(b.tonu),
    other: amount(b.other),
    lumper: amount(b.lumper),
    invoicedOn: isoDate(b.invoicedOn),
    paidOn: isoDate(b.paidOn),
  };
}

function feeType(v: unknown): FeeType {
  return (FEE_TYPES as readonly unknown[]).includes(v) ? (v as FeeType) : 'percent';
}

export function carrierInput(b: Record<string, unknown> = {}): CarrierInput {
  const name = text(b.name);
  if (!name) throw new BadRequestException('Carrier name is required');
  const type = feeType(b.feeType);
  const fee = amount(b.fee);
  if (type === 'percent' && fee > 100) throw new BadRequestException('Fee percent must be between 0 and 100');
  return {
    name, mc: text(b.mc, 20), dot: text(b.dot, 20), phone: text(b.phone, 40), email: text(b.email, 120), notes: text(b.notes, 1000),
    feeType: type, fee, factoring: text(b.factoring, 120),
  };
}

export function truckInput(b: Record<string, unknown> = {}): TruckInput {
  const unit = text(b.unit, 40);
  const driver = text(b.driver, 80);
  if (!unit && !driver) throw new BadRequestException('Enter a truck number or a driver');
  return { carrierId: id(b.carrierId), unit, driver, phone: text(b.phone, 40) };
}

export function dispatcherInput(b: Record<string, unknown> = {}): { name: string; percent: number } {
  const name = text(b.name, 80);
  if (!name) throw new BadRequestException('Dispatcher name is required');
  const percent = money(b.percent);
  if (percent < 0 || percent > 100) throw new BadRequestException('Percent must be between 0 and 100');
  return { name, percent };
}

export const MAX_IMPORT_ROWS = 5000;

export function importRows(b: unknown): ImportRow[] {
  const rows = Array.isArray((b as { rows?: unknown })?.rows) ? (b as { rows: Record<string, unknown>[] }).rows : null;
  if (!rows?.length) throw new BadRequestException('Nothing to import');
  if (rows.length > MAX_IMPORT_ROWS) throw new BadRequestException(`At most ${MAX_IMPORT_ROWS} rows at a time`);
  return rows.map((r, i) => {
    const date = isoDate(r.date);
    if (!date) throw new BadRequestException(`Row ${i + 1}: date must be YYYY-MM-DD`);
    return {
      date, broker: text(r.broker), pro: text(r.pro, 60), origin: text(r.origin), destination: text(r.destination),
      rate: money(r.rate), dispatcher: text(r.dispatcher, 80), carrier: text(r.carrier), loadedMiles: miles(r.loadedMiles),
    };
  });
}
