import { useEffect, useState } from 'react'
import { api } from '../api'
import { track } from '../lib/analytics'
import { formatDate } from '../lib/format'
import { STATES } from '../lib/states'
import type { RegistryResult, StateEntity } from '../types'
import { DetailBox, KeyValues, Pill } from './ui'

const courtListener = (name: string) =>
  `https://www.courtlistener.com/?${new URLSearchParams({ q: `"${name}"`, type: 'r' })}`
const openCorporates = (state: string, name: string) =>
  `https://opencorporates.com/companies/us_${state.toLowerCase()}?${new URLSearchParams({ q: name })}`

function Ext({ href, children }: { href: string; children: string }) {
  return <a href={href} target="_blank" rel="noopener noreferrer">{children} ↗</a>
}

function EntityCard({ e }: { e: StateEntity }) {
  return (
    <div className="entity">
      <div className="entity-head">
        <b>{e.name}</b>{' '}
        <Pill tone={e.active ? 'ok' : e.active === false ? 'bad' : 'warn'}>{e.status || 'Unknown status'}</Pill>{' '}
        {!e.exact && <span className="muted small-text">similar name</span>}
      </div>
      <KeyValues items={[
        ['Type', e.type],
        ['Formed', formatDate(e.formed)],
        ['ID', e.id],
        ['Address', e.address],
        ['People', e.people.join('; ')],
        ['Email', e.email],
        ['Details', e.detailsUrl && <Ext href={e.detailsUrl}>State record</Ext>],
      ]} />
    </div>
  )
}

function StateRegistry({ state, name }: { state: string; name: string }) {
  const [result, setResult] = useState<RegistryResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const ctrl = new AbortController()
    setResult(null)
    setError('')
    api.registry(state, name, ctrl.signal).then(setResult, (e: Error) => !ctrl.signal.aborted && setError(e.message))
    return () => ctrl.abort()
  }, [state, name])

  if (error) return <p className="error">Could not load: {error}</p>
  if (!result) return <p className="muted">Searching the {STATES[state].name} registry…</p>
  if (!result.supported) {
    return <p className="muted">{STATES[state].name} publishes no free registry data feed — use the links below.</p>
  }
  return (
    <>
      {result.entities.length
        ? result.entities.map((e) => <EntityCard key={e.id + e.name} e={e} />)
        : <p className="muted">No company starting with this name in the {STATES[state].name} registry.</p>}
      <p className="note">
        Source: {result.source}.{result.truncated && ' Only the first matches are shown.'}
      </p>
    </>
  )
}

interface Props {
  name: string
  state: string
  officers: string[]
}

/** State registration, UCC liens and court records for a company. */
export function PublicRecords({ name, state, officers }: Props) {
  const [st, setSt] = useState(STATES[state] ? state : 'DE')
  const links = STATES[st]

  return (
    <div className="detail-grid public-records">
      <DetailBox title="State business registration">
        <label className="field inline-field">
          State
          <select value={st} onChange={(e) => {
            setSt(e.target.value)
            track('registry_state', { state: e.target.value })
          }}>
            {Object.entries(STATES).map(([code, s]) => <option key={code} value={code}>{s.name}</option>)}
          </select>
        </label>
        <StateRegistry state={st} name={name} />
        <p className="links">
          <Ext href={links.business}>{`${links.name} Secretary of State`}</Ext>
          <Ext href={openCorporates(st, name)}>OpenCorporates</Ext>
        </p>
        <p className="note">Many trucking companies are formed in another state (often Wyoming or Delaware) — switch the state above.</p>
      </DetailBox>

      <DetailBox title="Liens (UCC filings)">
        <p>
          Search the debtor name <b>{name}</b> in the {links.name} UCC index. Factoring companies, truck lenders and
          leasing companies file UCC-1 liens against a carrier’s receivables and equipment.
        </p>
        <p className="links"><Ext href={links.ucc}>{`${links.name} UCC search`}</Ext></p>
        <p className="note">There is no free nationwide UCC search; some states charge a small fee or require an account.</p>
      </DetailBox>

      <DetailBox title="Courts & bankruptcy">
        <p className="links">
          <Ext href={courtListener(name)}>{`CourtListener: ${name}`}</Ext>
          {officers.map((o) => <Ext key={o} href={courtListener(o)}>{`CourtListener: ${o}`}</Ext>)}
          <Ext href="https://pcl.uscourts.gov/pcl/index.jsf">PACER Case Locator</Ext>
        </p>
        <p className="note">
          CourtListener is free and covers federal and bankruptcy dockets that someone has already pulled from PACER,
          so it is not complete. PACER is complete but needs an account ($0.10 per page, waived under $30 a quarter).
          State court cases are only on each state’s own court site.
        </p>
      </DetailBox>
    </div>
  )
}
