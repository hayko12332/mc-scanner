import { useCallback, useRef, useState } from 'react'

export function useToast(durationMs = 1400) {
  const [message, setMessage] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const show = useCallback((text: string) => {
    setMessage(text)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(''), durationMs)
  }, [durationMs])
  return { message, show }
}
