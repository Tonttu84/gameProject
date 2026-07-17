import React, { useState } from 'react'
import useUiStore from '../stores/useUiStore'
import TutorialIntro from './TutorialIntro'
import { tons } from '../utils/format'

// End-of-turn reveal: the fortnight's report dealt out one card at a time on
// player click — forage, then each fate (prophecy against what actually came
// to pass), then upkeep, the enemy, and finally the full summary. Revealed
// cards stay on screen; the continue button only appears with the last card.

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

const buildBeats = (report) => {
  const beats = []
  if (report.forage) beats.push({ kind: 'forage' })
  ;(report.augury ?? []).forEach((slot, i) => beats.push({ kind: `fate-${i}`, slot, index: i }))
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
const FateBeat = ({ slot, index }) => {
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

const EventRevealScreen = ({ report, onContinue }) => {
  const tutorial = useUiStore((s) => s.tutorial)
  const beats = buildBeats(report)
  const [shown, setShown] = useState(1)

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
      <h2>Turn {report.day} — The Fortnight Passes</h2>

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
            return <FateBeat key={beat.kind} slot={beat.slot} index={beat.index} />
        }
      })}

      {shown < beats.length && (
        <button
          className="btn-primary reveal-next"
          data-testid="reveal-next"
          onClick={() => setShown(shown + 1)}
        >
          Reveal
        </button>
      )}
    </div>
  )
}

export default EventRevealScreen
