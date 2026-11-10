import { randomBytes } from 'node:crypto';

/** File types the site exports; anything else is refused so the store can't host arbitrary content. */
export const EXPORT_TYPES: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
  vcf: 'text/vcard; charset=utf-8',
};

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const TTL_MS = 10 * 60_000;

export interface StoredFile { name: string; type: string; data: Buffer; expires: number }

/** Clean file name with an allowed extension, or null. */
export function safeName(name: string): string | null {
  const clean = name.replace(/[^\w.-]+/g, '_').slice(0, 120);
  const ext = clean.split('.').pop()?.toLowerCase() ?? '';
  return EXPORT_TYPES[ext] && clean.length > ext.length + 1 ? clean : null;
}

/**
 * Exported files kept in memory for a few minutes. Telegram Mini Apps can't save a file the page builds itself,
 * so the page uploads it here and asks Telegram to download it from a normal https link.
 */
export class ExportStore {
  private readonly files = new Map<string, StoredFile>();

  constructor(private readonly now: () => number = Date.now) {}

  put(name: string, data: Buffer): string {
    this.prune();
    let total = data.length;
    for (const f of this.files.values()) total += f.data.length;
    // Drop the oldest files when memory runs short.
    for (const [id, f] of this.files) {
      if (total <= MAX_TOTAL_BYTES) break;
      total -= f.data.length;
      this.files.delete(id);
    }
    const id = randomBytes(16).toString('hex');
    const ext = name.split('.').pop()!.toLowerCase();
    this.files.set(id, { name, type: EXPORT_TYPES[ext], data, expires: this.now() + TTL_MS });
    return id;
  }

  get(id: string): StoredFile | null {
    const f = this.files.get(id);
    if (!f || f.expires < this.now()) return null;
    return f;
  }

  private prune() {
    const now = this.now();
    for (const [id, f] of this.files) if (f.expires < now) this.files.delete(id);
  }
}
