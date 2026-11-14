import { Icon, type IconName } from './Icon'

interface Links { bot: string; group: string; support: string }
interface Item { label: string; href: string; icon?: IconName; tag?: string; external?: boolean }

const CHANNEL = 'https://t.me/MCScannerFMCSA'

/** Dark site footer: brand and status, link columns, legal line. */
export function Footer({ telegram, lastLookup, backendOk }: { telegram: Links; lastLookup: string; backendOk: boolean | null }) {
  const columns: { title: string; items: Item[] }[] = [
    {
      title: 'Product',
      items: [
        { label: 'Dispatch TMS', href: '#/crm', tag: 'Beta' },
        { label: 'Company lookup', href: lastLookup },
        { label: 'New MC leads', href: '#/leads' },
        { label: 'MC scanner', href: '#/scan' },
      ],
    },
    {
      title: 'Community',
      items: [
        ...(telegram.bot ? [{ label: 'Telegram bot', href: telegram.bot, external: true }] : []),
        ...(telegram.group ? [{ label: 'Dispatchers group', href: telegram.group, external: true }] : []),
        { label: 'Updates channel', href: CHANNEL, external: true },
        { label: 'Suggest a feature', href: '#/feedback' },
      ],
    },
    {
      title: 'Help',
      items: [
        { label: 'support@haulpanel.com', href: 'mailto:support@haulpanel.com' },
        ...(telegram.support ? [{ label: 'Support in Telegram', href: telegram.support, external: true }] : []),
        { label: 'FMCSA SAFER', href: 'https://safer.fmcsa.dot.gov/CompanySnapshot.aspx', external: true },
        { label: 'FMCSA open data', href: 'https://data.transportation.gov/browse?q=fmcsa', external: true },
      ],
    },
  ]
  const status = backendOk === false
    ? { cls: 'down', text: 'Data service is restarting' }
    : { cls: 'up', text: 'FMCSA data · updated daily' }

  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="footer-top">
          <div className="footer-brand">
            <a href="#/" className="brand">
              <img src="/logo.svg" alt="" width="32" height="32" />
              <span className="brand-word">Haul<em>Panel</em></span>
            </a>
            <p>The TMS for dispatch companies: loads, trucks, carrier statements and payments — plus company checks by MC or USDOT and new MC leads every day.</p>
            <span className={`footer-status ${status.cls}`}><i />{status.text}</span>
            <div className="footer-actions">
              <a className="btn primary" href="#/crm?signup">Start free</a>
              {telegram.bot && (
                <a className="btn footer-tg" href={telegram.bot} target="_blank" rel="noopener"><Icon name="send" size={15} />Open in Telegram</a>
              )}
            </div>
          </div>
          {columns.map((c) => (
            <nav key={c.title} className="footer-col" aria-label={c.title}>
              <h4>{c.title}</h4>
              {c.items.map((i) => (
                <a key={i.label} href={i.href} {...(i.external ? { target: '_blank', rel: 'noopener' } : {})}>
                  {i.label}
                  {i.tag && <span className={`footer-tag ${i.tag === 'New' ? '' : 'soon'}`}>{i.tag}</span>}
                  {i.external && <Icon name="arrow" size={12} className="ext" />}
                </a>
              ))}
            </nav>
          ))}
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} HaulPanel</span>
          <span>Data from FMCSA open data and SAFER. Not affiliated with FMCSA or USDOT.</span>
          <span>We record anonymous usage (pages opened, searches) to improve the service.</span>
        </div>
      </div>
      <div className="footer-mark" aria-hidden="true">HAULPANEL</div>
    </footer>
  )
}
