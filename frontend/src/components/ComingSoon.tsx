/** Announcement of the upcoming dispatcher CRM, with a link to leave suggestions. */
export function ComingSoon() {
  return (
    <aside className="coming-soon">
      <div>
        <span className="badge">Coming soon</span>
        <h3>CRM for dispatchers</h3>
        <p>Keep your carriers, calls, notes and follow-ups in one place, right next to the scanner.</p>
      </div>
      <a className="btn big" href="#/feedback">Tell us what it should do →</a>
    </aside>
  )
}
