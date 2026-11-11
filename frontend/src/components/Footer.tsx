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
        { label: 'New MC leads', href: '#/leads', tag: 'New' },
        { label: 'MC scanner', href: '#/scan' },
        { label: 'Company lookup', href: lastLookup },
        { label: 'Dispatcher CRM', href: '#/feedback', tag: 'Soon' },
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
        ...(telegram.support ? [{ label: 'Support', href: telegram.support, external: true }] : []),
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
              <img src="/logo.svg" alt="" width="34" height="34" />
              <span className="brand-text"><span>Lead<em>Haul</em></span><small>New MC leads every day</small></span>
            </a>
            <p>New MC leads with phone and email every day, plus a live SAFER check on every carrier. Free for dispatchers and freight brokers.</p>
            <span className={`footer-status ${status.cls}`}><i />{status.text}</span>
            <div className="footer-actions">
              <a className="btn primary glow" href="#/leads?go=1"><Icon name="zap" size={15} />Get new MC leads</a>
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
                  {i.tag && <span className={`footer-tag ${i.tag === 'Soon' ? 'soon' : ''}`}>{i.tag}</span>}
                  {i.external && <Icon name="arrow" size={12} className="ext" />}
                </a>
              ))}
            </nav>
          ))}
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} LeadHaul</span>
          <span>Data from FMCSA open data and SAFER. Not affiliated with FMCSA or USDOT.</span>
          <span>We record anonymous usage (pages opened, searches) to improve the service.</span>
        </div>
      </div>
      <div className="footer-mark" aria-hidden="true">LEADHAUL</div>
    </footer>
  )
}
