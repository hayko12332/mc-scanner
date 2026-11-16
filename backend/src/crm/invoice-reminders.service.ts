import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { db } from '../db.js';
import { sendMail } from '../mail/mailer.js';
import { CrmStore } from './crm.store.js';
import { PAY_TERMS_DAYS } from './crm.controller.js';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/**
 * Polite payment reminders to brokers for invoices sent from the board that are past their terms and still unpaid:
 * at most 3, a week apart, only while "remind" is on for that invoice. Replies go to the dispatcher.
 */
@Injectable()
export class InvoiceRemindersService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(InvoiceRemindersService.name);
  private timer?: NodeJS.Timeout;
  private store: CrmStore | null = null;

  onApplicationBootstrap() {
    if (!db()) return;
    const run = () => void this.run().catch((e: Error) => this.logger.warn(`Invoice reminders: ${e.message}`));
    setTimeout(run, 5 * 60_000).unref();
    this.timer = setInterval(run, 3 * 3600_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async run(): Promise<number> {
    const pool = db();
    if (!pool) return 0;
    this.store ??= new CrmStore(pool);
    const due = await this.store.remindersDue(PAY_TERMS_DAYS);
    for (const d of due) {
      const l = d.load;
      const total = l.rate + l.detention + l.layover + l.tonu + l.other + l.lumper;
      const late = Math.floor((Date.now() - new Date(`${l.invoicedOn}T12:00:00Z`).getTime()) / 86_400_000) - PAY_TERMS_DAYS;
      const ref = `invoice ${d.number} for load ${l.pro || l.id} (${l.origin} → ${l.destination})`;
      try {
        await sendMail({
          to: d.to, fromName: `${d.ownerName || 'Billing'} via HaulPanel`, replyTo: d.ownerEmail,
          subject: `Payment reminder: invoice ${d.number} · Load ${l.pro || l.id}`,
          text: `Hello,\n\nThis is a friendly reminder that ${ref}, ${usd(total)}, was due ${late} days ago and we have not received payment yet.\nIf it has already been paid, please reply with the payment date or check number.\n\nThank you,\n${d.ownerName}`,
          html: `<p>Hello,</p><p>This is a friendly reminder that ${esc(ref)}, <b>${usd(total)}</b>, was due ${late} days ago and we have not received payment yet.</p><p>If it has already been paid, please reply with the payment date or check number.</p><p>Thank you,<br>${esc(d.ownerName)}</p>`,
        });
        await this.store.reminded(l.id);
      } catch (e) {
        this.logger.warn(`Reminder for load ${l.id}: ${(e as Error).message}`);
      }
    }
    if (due.length) this.logger.log(`Invoice reminders sent: ${due.length}`);
    return due.length;
  }
}
