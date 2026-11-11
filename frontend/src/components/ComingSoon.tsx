/** Banner for the dispatch board (beta), with a link to try it. */
export function ComingSoon() {
  return (
    <aside className="coming-soon">
      <div>
        <span className="badge">New · beta</span>
        <h3>Dispatch board for dispatchers</h3>
        <p>Log your loads, see weekly gross per carrier and what each dispatcher earned. Import your Google Sheet in one paste.</p>
      </div>
      <a className="btn big" href="#/crm">Try it free →</a>
    </aside>
  )
}
