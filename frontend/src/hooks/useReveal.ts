import { useEffect } from 'react'

/** Fades `.reveal` elements in as they scroll into view (adds `.in`). Without IntersectionObserver they just show. */
export function useReveal(deps: unknown[] = []) {
  useEffect(() => {
    const items = [...document.querySelectorAll<HTMLElement>('.reveal:not(.in)')]
    if (!('IntersectionObserver' in window)) {
      items.forEach((el) => el.classList.add('in'))
      return
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        e.target.classList.add('in')
        io.unobserve(e.target)
      }
    }, { threshold: 0.12 })
    items.forEach((el) => io.observe(el))
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
