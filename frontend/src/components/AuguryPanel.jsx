import React from 'react'
import useCampaignStore from '../stores/useCampaignStore'
import { EMPTY_OBJECT } from '../stores/selectors'

// The augur's tent. Each turn holds three independent fates; consulting shows
// one vision per fate with the odds that it is true — the minigame is judging
// a dire omen at 30% (probably noise) against one at 90% (all but certain).
// While a reroll remains, clicking a vision REPLACES that fate itself rather
// than re-reading it: a new hidden pair, new odds, read fresh. Everything
// shown comes from the server view — the odds are the server's own roll
// target, never recomputed here.

// The header names the SHOWN card's flavour: its mood (valence, from the
// server) crossed with its magnitude (severity). So a bluff reads as the mood
// it shows, never the hidden truth's, and severity stops implying good/bad on
// its own. Neutral fates (a comet, rains that foul both sides) get their own
// mood-free words. Valence/severity come from the server view; the wording
// lives here (presentation).
const OMEN_LABEL = {
  good: { 1: 'A kind omen', 2: 'A favorable omen', 3: 'A blessed omen' },
  bad: { 1: 'An uneasy omen', 2: 'A troubling omen', 3: 'A dire omen' },
  neutral: { 1: 'A faint omen', 2: 'A clouded omen', 3: 'A portentous omen' },
}

const omenLabel = ({ valence, severity }) =>
  OMEN_LABEL[valence ?? 'neutral']?.[severity] ?? 'An omen'

// augury comes straight from the campaign store; onConsult/onReroll/
// onAccept/onContinue are still props (guarded actions / flow functions).
const AuguryPanel = ({ onConsult, onReroll, onAccept, onContinue }) => {
  const augury = useCampaignStore((s) => s.campaign?.augury ?? EMPTY_OBJECT)
  const canReroll = augury.rerollsRemaining > 0

  return (
    <div className="augury-phase">
      <h2>The Augur&apos;s Tent</h2>
      {!augury.consulted ? (
        <>
          <p className="augury-hint">
            What is to come is not yet fixed; it stirs in the Vael, the unsettled
            deep of days unlived. Few can look into it and read what they see — your
            augur is one such, and while the Vael is still soft can trouble its
            surface to raise a different thread. The bones are cast and the smoke
            rises; the augur is ready to read the coming fortnight.
          </p>
          <button className="btn-primary" data-testid="consult-augur" onClick={onConsult}>
            Consult the Augur
          </button>
        </>
      ) : (
        <>
          <p className="augury-hint">
            Three threads drawn from the Vael, each shown as it may come to pass.
            {canReroll
              ? ` Trouble a thread to let another rise in its place (${augury.rerollsRemaining} left) — for better or worse, and what you unmake cannot be recalled.`
              : ' The Vael has set; these fates are sealed.'}
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
                  {omenLabel(vision)}
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
                {canReroll && <div className="augury-reroll-hint">Trouble the Vael to redraw this thread</div>}
              </button>
            ))}
          </div>
          {/* Leaving the tent SEALS the reading: the fates come to pass right
              here (reveal + any decisions), before deployment — accepting
              with the reroll unspent is the "skip reroll" option. */}
          {!augury.accepted ? (
            <button className="btn-primary" data-testid="accept-fates" onClick={onAccept}>
              Accept the Fates
            </button>
          ) : (
            <button className="btn-primary" data-testid="augury-continue" onClick={onContinue}>
              On to the Raids
            </button>
          )}
        </>
      )}
    </div>
  )
}

export default AuguryPanel
