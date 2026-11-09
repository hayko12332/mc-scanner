import { Injectable } from '@nestjs/common';
import type { Insurance, Policy } from './fmcsa.types.js';
import { docketVariants, dollars, legacyDollars, toIsoDate } from './normalize.js';
import { DATASETS, inList, SocrataClient, type Row } from './socrata.client.js';

const INSURANCE_TYPE: Record<string, string> = { '1': 'BIPD', '2': 'Cargo', '3': 'Bond', '4': 'Trust Fund' };

const motusPolicy = (p: Row): Policy => ({
  type: (INSURANCE_TYPE[p.ins_type_code ?? ''] ?? '') + (p.ins_form_code ? ` (${p.ins_form_code})` : ''),
  company: p.insurance_company_name ?? '',
  policyNumber: p.policy_no ?? '',
  amount: dollars(p.max_cov_amount),
  underlying: dollars(p.underl_lim_amount),
  effectiveDate: toIsoDate(p.effective_date),
  cancelledDate: null,
  postedDate: toIsoDate(p.trans_date),
  reason: '',
});

const motusPastPolicy = (p: Row): Policy => ({
  ...motusPolicy(p),
  type: p.ins_type_desc || INSURANCE_TYPE[p.ins_type_code ?? ''] || '',
  cancelledDate: toIsoDate(p.cancl_effective_date),
  postedDate: null,
  reason: p.filing_status_reason ?? '',
});

const legacyPolicy = (p: Row): Policy => ({
  type: p.mod_col_1 || p.ins_form_code || '',
  company: p.name_company ?? '',
  policyNumber: p.policy_no ?? '',
  amount: legacyDollars(p.max_cov_amount),
  underlying: legacyDollars(p.underl_lim_amount),
  effectiveDate: toIsoDate(p.effective_date),
  cancelledDate: toIsoDate(p.cancl_effective_date),
  postedDate: toIsoDate(p.trans_date),
  reason: '',
});

@Injectable()
export class InsuranceService {
  constructor(private readonly socrata: SocrataClient) {}

  /** Motus (current system) first; the legacy L&I file only when Motus has nothing for this MC. */
  async forMc(mc: number): Promise<Insurance> {
    const where = `docket_number in (${inList(docketVariants([mc]))})`;
    // Motus is current; the legacy L&I file (frozen since 05/2026) is the fallback and may be retired.
    const [currentRes, pastRes] = await Promise.allSettled([
      this.socrata.query(DATASETS.motusInsurance, { $where: where, $order: 'effective_date DESC', $limit: '100' }),
      this.socrata.query(DATASETS.motusInsuranceHistory, {
        $where: `${where} AND cancl_effective_date IS NOT NULL AND (ins_type_desc IS NULL OR ins_type_desc not like '%CANCELLATION%')`,
        $order: 'cancl_effective_date DESC',
        $limit: '15',
      }),
    ]);
    const current = currentRes.status === 'fulfilled' ? currentRes.value : [];
    const past = pastRes.status === 'fulfilled' ? pastRes.value : [];
    if (current.length || past.length) {
      return { source: 'Motus', current: current.map(motusPolicy), past: past.map(motusPastPolicy) };
    }
    try {
      const legacy = await this.socrata.query(DATASETS.legacyInsurance, { $where: where, $limit: '100' });
      return { source: 'L&I', current: legacy.map(legacyPolicy), past: [] };
    } catch {
      // No legacy file: an empty Motus answer is the truth; if Motus failed too, report the error.
      if (currentRes.status === 'rejected') throw currentRes.reason;
      return { source: 'Motus', current: [], past: [] };
    }
  }
}
