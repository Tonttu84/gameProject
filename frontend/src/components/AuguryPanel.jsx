import React from 'react'

// The augur's tent. One prophecy per turn: consult to receive a single vision
// (which may or may not be true — the truth is revealed at end of turn), and
// optionally reroll the bones, which REPLACES fate itself rather than
// re-reading it. Everything shown comes from the server view; no odds are
// ever stated — the only hints are the omen's gravity and the height of the
// dice roll.

const SEVERITY_LABEL = { 1: 'A gentle omen', 2: 'A troubling omen', 3: 'A dire omen' }

const AuguryPanel = ({ augury, onConsult, onReroll, onContinue }) => (
  <div className="augury-phase">
    <h2>The Augur&apos;s Tent</h2>
    {!augury.consulted ? (
      <>
        <p className="augury-hint">
          The augur waits with bones and smoke, ready to read the coming fortnight.
        </p>
        <button className="btn-primary" data-testid="consult-augur" onClick={onConsult}>
          Consult the Augur
        </button>
      </>
    ) : (
      <>
        {augury.prediction && (
          <div className="augury-card" data-testid="augury-prophecy">
            <div className="augury-severity">
              {SEVERITY_LABEL[augury.prediction.event.severity] ?? 'An omen'}
            </div>
            <div className="augury-title">{augury.prediction.event.title}</div>
            <div className="augury-desc">{augury.prediction.event.description}</div>
            <div className="augury-roll" data-testid="augury-roll">
              The bones rolled {augury.prediction.roll}
            </div>
          </div>
        )}
        {augury.rerollsRemaining > 0 && (
          <button className="login-toggle" data-testid="reroll-augury" onClick={onReroll}>
            Reroll the bones ({augury.rerollsRemaining})
          </button>
        )}
        <button className="btn-primary" data-testid="augury-continue" onClick={onContinue}>
          Muster for Battle
        </button>
      </>
    )}
  </div>
)

export default AuguryPanel
