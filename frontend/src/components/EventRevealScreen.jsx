import React, { useState } from 'react'
import useUiStore from '../stores/useUiStore'
import TutorialIntro from './TutorialIntro'
import { tons } from '../utils/format'

// End-of-turn reveal: the fortnight's report dealt out one card at a time on
// player click — forage, then each fate (prophecy against what actually came
// to pass), then upkeep, the enemy, and finally the full summary. Revealed
// cards stay on screen; the continue button only appears with the last card.
//
// Events with choices (resolve-then-choose): a fate that fired with
// `pendingChoice` swaps the advance control for its option buttons — the
// reveal can't move past an unmade decision (the server 409s every other
// campaign action anyway). With no `report` at all (a reload while a decision
// was owed), the screen runs in choices-only mode straight off the view's
// `pendingChoices`; App drops the overlay once the last one resolves.

const FATE_NAMES = ['The First Fate', 'The Second Fate', 'The Third Fate']

const STANCE_LINES = {
  camp: 'The enemy keeps to its camp.',
  shadowing: 'The enemy shadows your line of march.',
  offering_battle: 'The enemy has drawn up for battle — they offer the field.',
  withdrawing: 'The enemy is withdrawing from the country.',
}

const CLASH_LINES = {
  player: 'Enemy riders caught your foragers — your parties drove them off.',
  enemy: 'Enemy riders caught your foragers — your parties were scattered.',
}

const ChoiceOptions = ({ slot, options, onPick, busy }) => (
  <div className="choice-options">
    {options.map((option) => (
      <button
        key={option.id}
        className="choice-option"
        data-testid={`choice-${option.id}`}
        disabled={busy}
        onClick={() => onPick(slot, option)}
      >
        <strong>{option.label}</strong>
        <span>{option.description}</span>
      </button>
    ))}
  </div>
)

const buildBeats = (report) => {
  const beats = []
  if (report.forage) beats.push({ kind: 'forage' })
  ;(report.augury ?? []).forEach((slot, i) => {
    // A deferred fate resolved at end-day carries its own slot index in `fate`
    // (the report holds only the deferred slots, so position ≠ slot); a
    // full-reveal report leaves it unset and position is the index.
    const index = slot.fate ?? i
    beats.push({ kind: `fate-${index}`, slot, index })
  })
  if (report.upkeep) beats.push({ kind: 'upkeep' })
  if (report.enemy) beats.push({ kind: 'enemy' })
  beats.push({ kind: 'summary' })
  return beats
}

const ForageBeat = ({ forage }) => (
  <div className="reveal-card" data-testid="reveal-beat-forage">
    <h3>Foraging</h3>
    <p>
      The parties swept the rings in <strong>{forage.posture}</strong> posture and brought in{' '}
      <strong>{tons(forage.harvested?.food ?? 0)}</strong> of food and{' '}
      <strong>{tons(forage.harvested?.materials ?? 0)}</strong> of materials.
    </p>
    {(forage.clashes ?? []).map((clash, i) => (
      <p className="reveal-clash" key={i}>
        {CLASH_LINES[clash.winner] ?? 'Enemy riders clashed with your foragers.'}
      </p>
    ))}
  </div>
)

// The dramatic beat, ported from the old all-at-once DayReport: prophecy vs
// what came to pass. Recon-sensitive fates (Stage 4 1c) show the FIRED rung —
// the augur always foretold the blind one; a countered fate (a won
// counter_event raid) never fired at all.
const FateBeat = ({ slot, index, outcome, onPick, busy }) => {
  // Deferred (a counter-raid target): the blow hasn't fallen. The tent shows
  // only the prophecy and the pending threat — no verdict, no came-to-pass, no
  // scouts line. All of that reveals at end-day, after the raid phase.
  if (slot.deferred) {
    return (
      <div className="reveal-card report-augury-slot" data-testid={`reveal-beat-fate-${index}`}>
        <h3>{FATE_NAMES[index] ?? `Fate ${index + 1}`}</h3>
        {slot.predicted && (
          <p>
            The augur foretold: <strong>{slot.predicted.title}</strong>
          </p>
        )}
        <p className="fate-deferred" data-testid="fate-deferred">
          It has not yet struck — your raiders may still unmake it.
        </p>
      </div>
    )
  }
  const came = slot.fired ?? slot.actual
  return (
    <div className="reveal-card report-augury-slot" data-testid={`reveal-beat-fate-${index}`}>
      <h3>{FATE_NAMES[index] ?? `Fate ${index + 1}`}</h3>
      {slot.predicted ? (
        <>
          <p>
            The augur foretold: <strong>{slot.predicted.title}</strong>
          </p>
          <p>
            What came to pass: <strong>{came.title}</strong>
            {came.description && ` — ${came.description}`}
          </p>
          <p className={slot.wasAccurate ? 'augury-true' : 'augury-false'}>
            {slot.wasAccurate ? 'The augur spoke true.' : 'The augur was wrong.'}
          </p>
        </>
      ) : (
        <p>
          Unconsulted, fate struck anyway: <strong>{came.title}</strong>
          {came.description && ` — ${came.description}`}
        </p>
      )}
      {slot.countered && (
        <p className="scout-intervened" data-testid="fate-countered">
          Averted — your raiders unmade it before the fortnight ended.
        </p>
      )}
      {slot.scoutsIntervened && (
        <p className="scout-intervened" data-testid="scout-intervened">
          Your scouts saw it coming — the blow was turned.
        </p>
      )}
      {slot.pendingChoice && outcome == null && (
        <ChoiceOptions slot={index} options={slot.pendingChoice.options} onPick={onPick} busy={busy} />
      )}
      {outcome != null && (
        <p className="choice-outcome" data-testid={`choice-outcome-${index}`}>
          You chose: <strong>{outcome}</strong>
        </p>
      )}
    </div>
  )
}

const UpkeepBeat = ({ upkeep }) => (
  <div className="reveal-card" data-testid="reveal-beat-upkeep">
    <h3>Upkeep</h3>
    <p>
      The army consumed <strong>{tons(upkeep.foodConsumed)}</strong> of food.
    </p>
    {upkeep.deserters > 0 && (
      <p className="augury-false">
        {upkeep.deserters} soldiers deserted — the stores are empty.
      </p>
    )}
  </div>
)

const EnemyBeat = ({ enemy }) => (
  <div className="reveal-card" data-testid="reveal-beat-enemy">
    <h3>The Enemy</h3>
    <p>{STANCE_LINES[enemy.stance] ?? "The enemy's movements are unclear."}</p>
    {enemy.battleOffer && <p>Battle will be joined if you take the field.</p>}
  </div>
)

const SummaryBeat = ({ report, onContinue }) => (
  <div className="reveal-card" data-testid="reveal-beat-summary">
    <h3>The fortnight, in full</h3>
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

const EventRevealScreen = ({ report, pendingChoices, onChoose, onContinue }) => {
  const tutorial = useUiStore((s) => s.tutorial)
  const beats = buildBeats(report ?? {})
  const [shown, setShown] = useState(1)
  // Slot index → chosen label, kept locally: the report's pendingChoice stays
  // in the (immutable) report object after the server resolves it.
  const [outcomes, setOutcomes] = useState({})
  const [busy, setBusy] = useState(false)

  const pick = async (slot, option) => {
    setBusy(true)
    try {
      // onChoose is guarded(): a failed post returns undefined and the
      // options stay up for another try.
      const resolved = await onChoose(slot, option.id)
      if (resolved)
        setOutcomes((prev) => ({ ...prev, [slot]: resolved.label ?? option.label }))
    } finally {
      setBusy(false)
    }
  }

  // Choices-only mode (reload recovery): no report to deal out — just the
  // owed decisions, all on the table at once. Resolving the last one shrinks
  // `pendingChoices` to empty and App drops this overlay for the council.
  if (!report) {
    return (
      <div className="day-report" data-testid="day-report">
        <TutorialIntro
          id="decisions"
          enabled={tutorial}
          title="A decision is owed"
          lines={[
            'An event from the last fortnight demands a choice before the campaign can go on.',
            'Pick an option for each — the campaign resumes once every decision is made.',
          ]}
        />
        <h2>Decisions Await</h2>
        {(pendingChoices ?? []).map((pending) => (
          <div
            className="reveal-card"
            data-testid={`reveal-beat-choice-${pending.slot}`}
            key={pending.slot}
          >
            <h3>{pending.title}</h3>
            {pending.description && <p>{pending.description}</p>}
            <ChoiceOptions slot={pending.slot} options={pending.options} onPick={pick} busy={busy} />
          </div>
        ))}
      </div>
    )
  }

  // The reveal can't move past an unmade decision on the card just dealt —
  // EXCEPT a deferred slot (a counter-raid target): it shows only its threat
  // here, no options, and its decision is owed later via the pendingChoices
  // overlay. Gating on its pendingChoice would deadlock the tent (disabled
  // advance, nothing to click).
  const current = beats[shown - 1]
  const awaitingChoice =
    current?.slot?.pendingChoice != null &&
    !current?.slot?.deferred &&
    outcomes[current.index] == null

  return (
    <div className="day-report" data-testid="day-report">
      <TutorialIntro
        id="reveal"
        enabled={tutorial}
        title="The fortnight passes"
        lines={[
          'The turn is resolved: each card tells what became of the foragers, the three fates, and the enemy.',
          'Reveal the cards one by one — a prophecy is only judged when its card is turned.',
        ]}
      />
      <h2>
        Turn {report.day} — {report.kind === 'fates' ? 'The Fates Come to Pass' : 'The Fortnight Passes'}
      </h2>

      {beats.slice(0, shown).map((beat) => {
        switch (beat.kind) {
          case 'forage':
            return <ForageBeat key={beat.kind} forage={report.forage} />
          case 'upkeep':
            return <UpkeepBeat key={beat.kind} upkeep={report.upkeep} />
          case 'enemy':
            return <EnemyBeat key={beat.kind} enemy={report.enemy} />
          case 'summary':
            return <SummaryBeat key={beat.kind} report={report} onContinue={onContinue} />
          default:
            return (
              <FateBeat
                key={beat.kind}
                slot={beat.slot}
                index={beat.index}
                outcome={outcomes[beat.index]}
                onPick={pick}
                busy={busy}
              />
            )
        }
      })}

      {shown < beats.length && (
        <button
          className="btn-primary reveal-next"
          data-testid="reveal-next"
          disabled={awaitingChoice}
          title={awaitingChoice ? 'A decision awaits — choose above.' : undefined}
          onClick={() => setShown(shown + 1)}
        >
          Reveal
        </button>
      )}
    </div>
  )
}

export default EventRevealScreen
