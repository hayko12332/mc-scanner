import type { CSSProperties } from 'react'
import { Icon } from './Icon'

const delay = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties

/** Three steps joined by a line, each with a small piece of the real interface. */
export function HowItWorks() {
  return (
    <section className="section">
      <div className="section-head reveal">
        <span className="eyebrow">How it works</span>
        <h2>From an MC number to a call list in under a minute</h2>
        <p>No accounts, no spreadsheets to merge — the scanner does the checking for you.</p>
      </div>
      <div className="steps">
        <div className="step reveal">
          <div className="step-visual">
            <div className="mock-label">Start from MC</div>
            <div className="mock-field">1000000<span className="caret" /></div>
          </div>
          <div className="step-num">01</div>
          <h3>Pick a starting MC</h3>
          <p>Enter any MC number or keep the default. The scanner walks MC, MC+1, MC+2 and so on.</p>
        </div>
        <div className="step reveal" style={delay(120)}>
          <div className="step-visual">
            <div className="mock-live"><span className="pulse" /> Checking MC 1000100 – 1000199</div>
            <div className="progress"><i /></div>
            <div className="mock-count"><b>16</b> carriers found · <b>6</b> rejected by SAFER</div>
          </div>
          <div className="step-num">02</div>
          <h3>Press Start</h3>
          <p>Only authorized carriers with a phone and email are kept — each one re-checked on SAFER live.</p>
        </div>
        <div className="step reveal" style={delay(240)}>
          <div className="step-visual">
            <div className="mock-actions">
              <span className="mock-btn primary"><Icon name="download" size={14} />CSV</span>
              <span className="mock-btn"><Icon name="phone" size={14} />Copy phones</span>
            </div>
            <div className="mock-toast"><Icon name="check" size={14} />Copied: 31 phones</div>
          </div>
          <div className="step-num">03</div>
          <h3>Call or export</h3>
          <p>Click any phone or email to copy it, copy them all at once, or export to Excel or your dialer.</p>
        </div>
      </div>
      <SectionCta note="Takes about 20 seconds · no sign-up" />
    </section>
  )
}

/** Centered call to action under a landing section. */
export function SectionCta({ note, label = 'Get new MC leads' }: { note?: string; label?: string }) {
  return (
    <div className="section-cta reveal">
      <a className="btn primary big glow" href="#/leads?go=7"><Icon name="zap" size={16} />{label}</a>
      {note && <span>{note}</span>}
    </div>
  )
}

/** Closing band before the footer. */
export function FinalCta() {
  return (
    <section className="final-cta reveal">
      <div className="final-glow" aria-hidden="true" />
      <span className="eyebrow dark">Free · no sign-up</span>
      <h2>Start calling new carriers <span className="hl">today</span></h2>
      <p>150+ carriers get their operating authority every day. Most of them don’t have a dispatcher yet.</p>
      <div className="final-actions">
        <a className="btn primary big glow" href="#/leads?go=7"><Icon name="zap" size={16} />Get new MC leads</a>
        <a className="btn big ghost" href="#/lookup"><Icon name="search" size={16} />Check a company</a>
      </div>
      <ul className="trust">
        <li><Icon name="database" size={15} />Official FMCSA data</li>
        <li><Icon name="refresh" size={15} />Updated daily</li>
        <li><Icon name="download" size={15} />Excel, CSV &amp; contacts export</li>
      </ul>
    </section>
  )
}

const ROWS: [string, string, string][] = [
  ['B•••• Express LLC', 'MC-1000012', 'TX'],
  ['S•••• Trucking Inc', 'MC-1000047', 'IL'],
  ['M•••• Logistics LLC', 'MC-1000083', 'GA'],
]

/** Bento grid of features; the big cards carry a small preview of what you get. */
export function FeatureBento() {
  return (
    <section className="section">
      <div className="section-head reveal">
        <span className="eyebrow">Features</span>
        <h2>Everything you need to vet a carrier</h2>
        <p>One free tool instead of a dozen tabs with SAFER, L&amp;I and state registries.</p>
      </div>
      <div className="bento">
        <article className="tile wide reveal">
          <div className="tile-icon"><Icon name="scan" /></div>
          <h3>MC scanner</h3>
          <p>Walks MC numbers one by one and keeps only authorized carriers — no brokers — with a phone and email.</p>
          <div className="mini-table">
            {ROWS.map(([name, mc, st]) => (
              <div key={mc} className="mini-row">
                <b>{name}</b>
                <span>{mc}</span>
                <span>{st}</span>
                <span className="pill pill-ok">AUTHORIZED ✓</span>
              </div>
            ))}
          </div>
        </article>

        <article className="tile accent reveal" style={delay(100)}>
          <div className="tile-icon"><Icon name="shield" /></div>
          <h3>Live SAFER check</h3>
          <p>Every carrier is re-checked on SAFER in real time, so you never call a company whose authority is gone.</p>
          <div className="shield-badge"><Icon name="check" size={28} /></div>
        </article>

        <article className="tile reveal">
          <div className="tile-icon"><Icon name="search" /></div>
          <h3>Company lookup</h3>
          <p>Check any company by MC, USDOT, email or phone — and see other companies sharing the same contact.</p>
          <div className="mini-search"><Icon name="search" size={14} />MC-1000012<span className="mini-chip">1 company</span></div>
        </article>

        <article className="tile wide reveal" style={delay(100)}>
          <div className="tile-icon"><Icon name="file" /></div>
          <h3>Insurance &amp; public records</h3>
          <p>Active insurance and policy history, state business registration, UCC liens and court links in one card.</p>
          <div className="mini-kv">
            <div><span>BIPD on file</span><b>$750,000</b></div>
            <div><span>Cargo</span><b>Not required</b></div>
            <div><span>State registration</span><b className="ok">Active</b></div>
            <div><span>UCC liens</span><b>Search →</b></div>
          </div>
        </article>

        <article className="tile reveal">
          <div className="tile-icon"><Icon name="download" /></div>
          <h3>Copy &amp; export</h3>
          <p>Copy all phones or emails in one click, or export to Excel, Google Sheets, CSV or phone contacts.</p>
        </article>

        <article className="tile wide telegram reveal" style={delay(100)}>
          <div className="tile-icon"><Icon name="send" /></div>
          <h3>Also in Telegram</h3>
          <p>The same scanner and lookup inside Telegram, plus support and updates — right where dispatchers already work.</p>
          <a className="btn tg-cta" href="https://t.me/MCUSDOTScannerbot" target="_blank" rel="noopener">
            <Icon name="send" size={16} />Open @MCUSDOTScannerbot
          </a>
        </article>
      </div>
      <SectionCta note="See who got authority this week" />
    </section>
  )
}
