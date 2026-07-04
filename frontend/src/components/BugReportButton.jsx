import React, { useState } from 'react'
import { submitBugReport } from '../services/api'

// Small "Report a bug" affordance for demo players. Opens a textarea, posts to
// the campaign server, and shows a thanks state. The server owns all the
// reproduction context (active campaign, day, build) — we only tell it which
// screen the player was on via the `screen` prop.
const MAX = 2000

const BugReportButton = ({ screen }) => {
  const [open, setOpen]       = useState(false)
  const [text, setText]       = useState('')
  const [status, setStatus]   = useState('idle') // idle | sending | done | error
  const [error, setError]     = useState(null)

  const close = () => {
    setOpen(false)
    setText('')
    setStatus('idle')
    setError(null)
  }

  const send = async () => {
    const message = text.trim()
    if (message.length === 0) return
    setStatus('sending')
    setError(null)
    try {
      await submitBugReport(message, screen)
      setStatus('done')
      setText('')
    } catch (e) {
      setStatus('error')
      setError(e.response?.data?.error ?? 'Could not send the report — please try again.')
    }
  }

  if (!open) {
    return (
      <button
        className="login-toggle"
        data-testid="bug-report-open"
        onClick={() => setOpen(true)}
      >
        Report a bug
      </button>
    )
  }

  return (
    <div className="bug-report-overlay" data-testid="bug-report-modal" role="dialog" aria-label="Report a bug">
      <div className="bug-report-modal">
        {status === 'done' ? (
          <>
            <h3>Thanks!</h3>
            <p>Your report was sent. It helps us fix the game.</p>
            <button className="btn-primary" data-testid="bug-report-close" onClick={close}>
              Close
            </button>
          </>
        ) : (
          <>
            <h3>Report a bug</h3>
            <p className="bug-report-hint">
              Describe what went wrong. We record which screen you were on and your
              campaign automatically — no need to include those.
            </p>
            <textarea
              data-testid="bug-report-text"
              value={text}
              maxLength={MAX}
              rows={5}
              placeholder="What happened? What did you expect?"
              onChange={(e) => setText(e.target.value)}
              disabled={status === 'sending'}
            />
            <div className="bug-report-count">{text.length}/{MAX}</div>
            {error && <p className="login-error" data-testid="bug-report-error">{error}</p>}
            <div className="bug-report-actions">
              <button
                className="btn-primary"
                data-testid="bug-report-submit"
                onClick={send}
                disabled={status === 'sending' || text.trim().length === 0}
              >
                {status === 'sending' ? 'Sending…' : 'Send report'}
              </button>
              <button className="login-toggle" data-testid="bug-report-cancel" onClick={close}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default BugReportButton
