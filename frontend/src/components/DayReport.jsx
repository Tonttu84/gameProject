import React from 'react'

// End-of-turn report: what the fortnight brought — the dramatic beat being
// the augury reveal, prophecy against what actually came to pass.
const DayReport = ({ report, onContinue }) => (
  <div className="day-report" data-testid="day-report">
    <h2>Turn {report.day} — The Fortnight Passes</h2>

    {report.augury?.length > 0 && (
      <div className="report-augury" data-testid="report-augury">
        {report.augury.map((slot, i) => (
          <div className="report-augury-slot" key={i}>
            {slot.predicted ? (
              <>
                <p>
                  The augur foretold: <strong>{slot.predicted.title}</strong>
                </p>
                <p>
                  What came to pass: <strong>{slot.actual.title}</strong>
                  {slot.actual.description && ` — ${slot.actual.description}`}
                </p>
                <p className={slot.wasAccurate ? 'augury-true' : 'augury-false'}>
                  {slot.wasAccurate ? 'The augur spoke true.' : 'The augur was wrong.'}
                </p>
              </>
            ) : (
              <p>
                Unconsulted, fate struck anyway: <strong>{slot.actual.title}</strong>
                {slot.actual.description && ` — ${slot.actual.description}`}
              </p>
            )}
          </div>
        ))}
      </div>
    )}

    <ul className="report-entries">
      {(report.entries ?? []).map((line, i) => (
        <li key={i}>{line}</li>
      ))}
    </ul>

    <button className="btn-primary" data-testid="report-continue" onClick={onContinue}>
      To the War Council
    </button>
  </div>
)

export default DayReport
