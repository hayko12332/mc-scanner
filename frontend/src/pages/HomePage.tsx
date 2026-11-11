import { CountUp, HeroNetwork } from '../components/HeroNetwork'
import { Icon } from '../components/Icon'
import { FeatureBento, FinalCta, HowItWorks } from '../components/Landing'
import { useReveal } from '../hooks/useReveal'

/** Landing page: what LeadHaul is, with buttons into the tools. */
export function HomePage({ backendOk }: { backendOk: boolean | null }) {
  useReveal([])
  return (
    <>
      <section className="hero-band">
        <div className="hero wrap">
          <div className="hero-text">
            <a className="announce" href="#/feedback">
              <span className="announce-tag">New</span>
              Dispatcher CRM is coming — tell us what you need
              <Icon name="arrow" size={14} />
            </a>
            <h1>New MC leads <span className="hl">with phone &amp; email</span> every day</h1>
            <p className="hero-sub">
              Carriers that just got their operating authority — reach them before other dispatchers do. Or scan any
              MC range and verify carriers live on SAFER. Built for dispatchers and freight brokers.
            </p>
            <div className="hero-cta">
              <a className={`btn primary big glow ${backendOk === false ? 'disabled' : ''}`} href="#/leads?go=1">
                <Icon name="zap" size={16} />Get new MC leads
              </a>
              <a className="btn big ghost" href="#/scan"><Icon name="scan" size={17} />Scan MC range</a>
            </div>
            <ul className="trust">
              <li><Icon name="database" size={15} />Official FMCSA data</li>
              <li><Icon name="shield" size={15} />Live SAFER check</li>
              <li><Icon name="zap" size={15} />No sign-up</li>
            </ul>
          </div>
          <HeroNetwork />
        </div>
        <div className="wrap">
          <div className="hero-stats reveal">
            <div><span className="stat-icon"><Icon name="zap" /></span><b><CountUp to={150} suffix="+" /></b><span>new carriers every day</span></div>
            <div><span className="stat-icon"><Icon name="shield" /></span><b><CountUp to={100} suffix="%" /></b><span>carriers verified on FMCSA</span></div>
            <div><span className="stat-icon"><Icon name="refresh" /></span><b>Daily</b><span>FMCSA data refresh</span></div>
            <div><span className="stat-icon"><Icon name="dollar" /></span><b>$<CountUp to={0} /></b><span>free Excel, CSV &amp; contacts export</span></div>
          </div>
        </div>
      </section>

      <HowItWorks />
      <FeatureBento />
      <FinalCta />
    </>
  )
}
