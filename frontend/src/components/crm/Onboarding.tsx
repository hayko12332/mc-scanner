import { useState } from 'react'
import { track } from '../../lib/analytics'
import { ImportCard } from './AiHome'

// Right after sign-up, while the board is empty: move the dispatch office in the simple way. Drop whatever you have
// (spreadsheets, rate cons, carrier lists, screenshots of the old TMS) or a Google Sheet link, and the AI fills the
// board; you check a preview first. Platforms we can't connect yet are shown as coming, never as working buttons.

const PLATFORMS: { name: string; what: string; when: string }[] = [
  { name: 'Gmail / Outlook', what: 'Rate cons from your inbox become loads', when: 'Soon' },
  { name: 'Truckstop', what: 'Search loads, post trucks, lane rates', when: 'Soon' },
  { name: 'DAT', what: 'Search loads, post trucks, lane rates', when: 'Soon' },
  { name: 'Samsara (ELD)', what: 'Live truck location and driver hours', when: 'Works now · Integrations' },
  { name: 'Motive (ELD)', what: 'Live truck location and driver hours', when: 'Soon' },
  { name: 'Any factoring company', what: 'Invoice packet to your factor in one click', when: 'Works now' },
  { name: 'QuickBooks', what: 'Invoices and payments', when: 'Export works today' },
]

export function Onboarding({ firstName, done }: { firstName: string; done: (note: string) => void }) {
  const [started, setStarted] = useState<File[] | null>(null)
  return (
    <div className="ob">
      <header className="ob-top">
        <a href="#/" className="ob-brand"><img src="/logo.svg" alt="" width="24" height="24" /><b>HaulPanel</b></a>
        <span className="ob-step">Step 2 of 2</span>
        <button className="ob-skip" onClick={() => { track('onboarding_skip'); done('') }}>Skip for now →</button>
      </header>
      <main className="ob-main">
        <div className="ob-head">
          <h1>Bring your dispatch office in, {firstName}</h1>
          <p>Give the AI whatever you have — it fills your board: loads, carriers, trucks &amp; drivers, dispatchers, broker emails. You check everything before it’s saved.</p>
        </div>
        <div className={`ob-grid ${started ? 'wide' : ''}`}>
          <section className="ob-files" aria-label="Your files">
            <div className="ob-k">Your files — works now</div>
            {started ? (
              <ImportCard initial={started} close={() => setStarted(null)} done={(msg) => { track('onboarding_import'); done(msg) }} />
            ) : (
              <button className="ob-drop" onClick={() => setStarted([])} onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); setStarted([...e.dataTransfer.files]) }}>
                <span className="ob-ico" aria-hidden="true">⇪</span>
                <b>Drop files or paste a Google Sheet link</b>
                <small>Excel · CSV · Google Sheets · PDF · photos · screenshots</small>
                <span className="ob-eg">
                  <i>Load log / settlement sheet</i><i>Carrier &amp; driver list</i><i>Rate cons</i><i>Export or screenshots of your old TMS</i>
                </span>
              </button>
            )}
          </section>
          <aside className="ob-plat" aria-label="Connect your platforms">
            <div className="ob-k">Connect your platforms</div>
            {PLATFORMS.map((p) => (
              <div key={p.name} className="ob-p">
                <span><b>{p.name}</b><small>{p.what}</small></span>
                <em className={p.when === 'Soon' ? '' : 'ok'}>{p.when}</em>
              </div>
            ))}
            <p className="ob-muted">We’re setting up these connections with each company. Until then, an export file from any of them works above.</p>
          </aside>
        </div>
      </main>
    </div>
  )
}
