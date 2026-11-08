/** Announcement of the upcoming dispatcher CRM, with a link to leave suggestions. */
export function ComingSoon() {
  return (
    <aside className="coming-soon">
      <span className="badge">Coming soon</span>
      <span>
        <b>CRM for dispatchers</b> — keep your carriers, calls, notes and follow-ups in one place, right next to the
        scanner.
      </span>
      <a href="#/feedback">Tell us what it should do →</a>
    </aside>
  )
}
