import { useEffect } from 'react'
import { telegramApp } from '../lib/telegram'
import { Icon } from './Icon'

const SHEETS_URL = 'https://sheets.new'
const isApple = /Mac|iPhone|iPad/.test(navigator.userAgent)
const isPhone = /Android|iPhone|iPad/.test(navigator.userAgent)

interface Props {
  rows: number
  /** False when the clipboard refused the copy. */
  copied: boolean
  onCopyAgain: () => void
  onDownload: (format: 'xlsx' | 'csv') => void
  onClose: () => void
}

/**
 * Google Sheets export: the table is on the clipboard; this dialog says what to do next and opens a new sheet
 * from a real click, so pop-up blockers don't stop it.
 */
export function SheetsDialog({ rows, copied, onCopyAgain, onDownload, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [onClose])

  const openSheets = (e: React.MouseEvent) => {
    const app = telegramApp()
    if (app) { e.preventDefault(); app.openLink(SHEETS_URL) }
  }
  const paste = isApple ? '⌘V' : 'Ctrl+V'

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="sheets-title">
        <button className="dialog-close" aria-label="Close" onClick={onClose}>×</button>
        <div className="dialog-icon"><Icon name="database" size={22} /></div>
        <h3 id="sheets-title">Export to Google Sheets</h3>
        {copied ? (
          <>
            <p className="dialog-ok"><Icon name="check" size={16} />{rows.toLocaleString('en-US')} rows copied to the clipboard</p>
            <ol className="dialog-steps">
              <li><b>Open a new Google Sheet</b><span>Sign in to Google if asked.</span></li>
              <li><b>Click cell A1 and press {isPhone ? 'Paste' : <kbd>{paste}</kbd>}</b><span>Every column lands in place, with headers.</span></li>
            </ol>
            <div className="dialog-actions">
              <a className="btn primary glow" href={SHEETS_URL} target="_blank" rel="noopener" onClick={openSheets}>
                <Icon name="arrow" size={16} />Open Google Sheets
              </a>
              <button onClick={onCopyAgain}><Icon name="copy" size={15} />Copy again</button>
            </div>
          </>
        ) : (
          <p className="dialog-warn">Your browser didn’t allow copying. Download the file instead and open it in Google Sheets (File → Import).</p>
        )}
        <p className="dialog-alt">
          {isPhone && copied ? 'On a phone it’s easier to ' : 'Or '}
          <button className="linkish" onClick={() => onDownload('xlsx')}>download Excel</button> /{' '}
          <button className="linkish" onClick={() => onDownload('csv')}>CSV</button>
          {' '}— Google Sheets opens both via File → Import.
        </p>
      </div>
    </div>
  )
}
