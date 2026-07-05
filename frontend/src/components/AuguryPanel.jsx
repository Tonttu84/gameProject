import React from 'react'

// The augur's tent. Each turn holds three independent fates; consulting shows
// one vision per fate with the odds that it is true — the minigame is judging
// a dire omen at 30% (probably noise) against one at 90% (all but certain).
// While a reroll remains, clicking a vision REPLACES that fate itself rather
// than re-reading it: a new hidden pair, new odds, read fresh. Everything
// shown comes from the server view — the odds are the server's own roll
// target, never recomputed here.

const SEVERITY_LABEL = { 1: 'A gentle omen', 2: 'A troubling omen', 3: 'A dire omen' }

const AuguryPanel = ({ augury, onConsult, onReroll, onContinue }) => {
  const canReroll = augury.rerollsRemaining > 0

  return (
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
          <p className="augury-hint">
            Three fates for the fortnight.
            {canReroll
              ? ` Recast the bones on one of them (${augury.rerollsRemaining} left) — it changes that fate itself, for better or worse.`
              : ' The bones are still; fate is sealed.'}
          </p>
          <div className="augury-cards">
            {(augury.visions ?? []).map((vision, i) => (
              <button
                key={i}
                className={`augury-card${canReroll ? ' augury-card-rerollable' : ''}`}
                data-testid={`augury-vision-${i}`}
                onClick={() => canReroll && onReroll(i)}
                disabled={!canReroll}
              >
                <div className="augury-severity">
                  {SEVERITY_LABEL[vision.severity] ?? 'An omen'}
                </div>
                <div className="augury-title">{vision.title}</div>
                <div className="augury-desc">{vision.description}</div>
                <div className="augury-odds" data-testid={`augury-odds-${i}`}>
                  {Math.round(vision.odds * 100)}% true
                </div>
                {/* The truth, revealed once the reroll is resolved (or
                    immediately while the server's debug flag is on). */}
                {vision.truth && (
                  <div
                    className={`augury-truth ${vision.truth.id === vision.id ? 'augury-true' : 'augury-false'}`}
                    data-testid={`augury-truth-${i}`}
                  >
                    {vision.truth.id === vision.id
                      ? 'The vision holds true.'
                      : `In truth: ${vision.truth.title}`}
                  </div>
                )}
                {canReroll && <div className="augury-reroll-hint">Recast these bones</div>}
              </button>
            ))}
          </div>
          <button className="btn-primary" data-testid="augury-continue" onClick={onContinue}>
            Muster for Battle
          </button>
        </>
      )}
    </div>
  )
}

export default AuguryPanel
