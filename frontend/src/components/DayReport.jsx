import React from 'react'

// End-of-turn report: what the fortnight brought — the dramatic beat being
// the augury reveal, prophecy against what actually came to pass.
const DayReport = ({ report, onContinue }) => (
  <div className="day-report" data-testid="day-report">
    <h2>Turn {report.day} — The Fortnight Passes</h2>

    {report.augury && (
      <div className="report-augury" data-testid="report-augury">
        {report.augury.predicted ? (
          <>
            <p>
              The augur foretold: <strong>{report.augury.predicted.title}</strong>
            </p>
            <p>
              What came to pass: <strong>{report.augury.actual.title}</strong>
              {report.augury.actual.description && ` — ${report.augury.actual.description}`}
            </p>
            <p className={report.augury.wasAccurate ? 'augury-true' : 'augury-false'}>
              {report.augury.wasAccurate ? 'The augur spoke true.' : 'The augur was wrong.'}
            </p>
          </>
        ) : (
          <p>
            Unconsulted, fate struck anyway: <strong>{report.augury.actual.title}</strong>
            {report.augury.actual.description && ` — ${report.augury.actual.description}`}
          </p>
        )}
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
