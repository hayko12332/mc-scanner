import { api } from '../api'
import { entityLabel } from '../lib/carrier'
import { formatDate, formatMoney, formatNumber, formatPhone } from '../lib/format'
import type { DetailsCarrier } from '../types'
import { InsurancePanel } from './InsurancePanel'
import { DetailBox, KeyValues, Pill, StatusPill } from './ui'

const required = (v: string) => (v === 'Y' ? 'Required' : v === 'N' ? 'Not required' : '—')
const onFile = (v: string) => (v === 'Y' ? 'Yes' : v === 'N' ? 'No' : '—')

export function CarrierDetails({ carrier: c }: { carrier: DetailsCarrier }) {
  const a = c.authority
  const s = c.safer

  return (
    <div className="detail-grid">
      {s && (
        <DetailBox title="SAFER (live)">
          <KeyValues items={[
            ['Operating authority', <><Pill tone={s.authorized ? 'ok' : 'bad'}>{s.authorityStatus.replace(/:$/, '')}</Pill> {s.authorizedFor.join(', ')}</>],
            ['USDOT status', <Pill tone={s.usdotStatus === 'ACTIVE' ? 'ok' : 'bad'}>{s.usdotStatus || '—'}</Pill>],
            ['Out of service', s.outOfServiceDate],
            ['Entity type', s.entityType],
            ['MC/MX/FF', s.mcNumbers.join(', ')],
            ['Phone (SAFER)', s.phone],
            ['Address (SAFER)', s.physicalAddress],
            ['MCS-150', s.mcs150Date],
            ['SAFER data as of', s.asOf],
            ['Checked', formatDate(s.checkedAt)],
          ]} />
        </DetailBox>
      )}
      {a ? (
        <>
          <DetailBox title="Operating authority (FMCSA files)">
            <KeyValues items={[
              ['Common (L&I)', a.sources.includes('L&I') && <StatusPill code={a.common} />],
              ['Contract (L&I)', a.sources.includes('L&I') && <StatusPill code={a.contract} />],
              ['Carrier (Motus)', a.motusCarrier && <StatusPill code={a.motusCarrier} />],
              ['Broker', <StatusPill code={a.broker} />],
              ['Motus authorities', a.motusAuthorities.join('; ')],
              ['Pending application', a.pendingApplications.join(', ') || 'none'],
              ['Pending revocation', a.pendingRevocations.join(', ') || 'none'],
              ['Type', a.authorityTypes.join(', ')],
              ['Source', a.sources.join(' + ')],
              ['Verify', <a href={api.saferPageUrl(c.dot)} target="_blank" rel="noopener">Open on SAFER</a>],
            ]} />
          </DetailBox>
          <DetailBox title="Insurance on file (FMCSA)">
            <KeyValues items={[
              ['BIPD required', formatMoney(a.bipdRequired)],
              ['BIPD on file', formatMoney(a.bipdOnFile)],
              ['Cargo', `${required(a.cargoRequired)} / on file: ${onFile(a.cargoOnFile)}`],
              ['Bond', `${required(a.bondRequired)} / on file: ${onFile(a.bondOnFile)}`],
            ]} />
          </DetailBox>
        </>
      ) : (
        <DetailBox title="Operating authority (FMCSA files)">
          <p className="muted">
            {c.mc ? `No authority record for MC-${c.mc} in L&I or Motus.` : 'No MC number: no for-hire operating authority.'}
          </p>
          <a href={api.saferPageUrl(c.dot)} target="_blank" rel="noopener">Open on SAFER</a>
        </DetailBox>
      )}
      <DetailBox title="Company">
        <KeyValues items={[
          ['Legal name', c.legalName],
          ['DBA', c.dbaName],
          ['Entity', entityLabel(c.entityTypes)],
          ['MC numbers', (c.mcNumbers?.length ?? 0) > 1 && c.mcNumbers!.map((n) => `MC-${n}`).join(', ')],
          ['Officers', c.officers.join('; ')],
          ['Address', c.physicalAddress],
          ['Mailing address', c.mailingAddress !== c.physicalAddress && c.mailingAddress],
          ['Fax', formatPhone(c.fax)],
          ['USDOT status', c.usdotStatus && <StatusPill code={c.usdotStatus} />],
          ['USDOT since', formatDate(c.addedOn)],
          ['Operation', c.operation],
        ]} />
      </DetailBox>
      <DetailBox title="Fleet & safety">
        <KeyValues items={[
          ['Power units', formatNumber(c.powerUnits)],
          ['Trucks', formatNumber(c.trucks)],
          ['Drivers', formatNumber(c.drivers)],
          ['CDL drivers', formatNumber(c.cdlDrivers)],
          ['Mileage', c.mileage ? `${formatNumber(c.mileage)} mi (${c.mileageYear})` : ''],
          ['MCS-150 updated', formatDate(c.mcs150Date)],
          ['Safety rating', c.safetyRating + (c.safetyRatingDate ? ` (${formatDate(c.safetyRatingDate)})` : '')],
          ['Hazmat', c.hazmat ? 'Yes' : 'No'],
        ]} />
      </DetailBox>
      <DetailBox title="Cargo">
        <div>{c.cargo.join(', ') || '—'}</div>
      </DetailBox>
      {c.mc != null && (
        <DetailBox title="Insurance policies (active / pending)">
          <InsurancePanel mc={c.mc} />
        </DetailBox>
      )}
    </div>
  )
}
