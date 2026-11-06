import { api } from '../api'
import { formatDate, formatMoney, formatNumber, formatPhone } from '../lib/format'
import type { ScannedCarrier } from '../types'
import { InsurancePanel } from './InsurancePanel'
import { DetailBox, KeyValues, Pill, StatusPill } from './ui'

const required = (v: string) => (v === 'Y' ? 'Required' : v === 'N' ? 'Not required' : '—')
const onFile = (v: string) => (v === 'Y' ? 'Yes' : v === 'N' ? 'No' : '—')

export function CarrierDetails({ carrier: c }: { carrier: ScannedCarrier }) {
  const a = c.authority
  const s = c.safer
  const fromLegacy = a.sources.includes('L&I')

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
      <DetailBox title="Operating authority (FMCSA files)">
        <KeyValues items={[
          ['Common (L&I)', fromLegacy && <StatusPill code={a.common} />],
          ['Contract (L&I)', fromLegacy && <StatusPill code={a.contract} />],
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
      <DetailBox title="Company">
        <KeyValues items={[
          ['Legal name', c.legalName],
          ['DBA', c.dbaName],
          ['Officers', c.officers.join('; ')],
          ['Address', c.physicalAddress],
          ['Mailing address', c.mailingAddress !== c.physicalAddress && c.mailingAddress],
          ['Fax', formatPhone(c.fax)],
          ['USDOT status', c.usdotStatus && <StatusPill code={c.usdotStatus} />],
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
      <DetailBox title="Insurance policies (active / pending)">
        <InsurancePanel mc={c.mc} />
      </DetailBox>
    </div>
  )
}
