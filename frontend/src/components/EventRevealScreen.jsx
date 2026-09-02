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

// The state of Karrowgate's walls under the enemy's assault, keyed off the meter
// band (intact/damaged/breached) — the same banded signal the HUD gauge reads.
// FLAGGED FOR PLAYTEST (docs/CAMPAIGN_PLAN.md): revisit the wording once the
// meter's pacing is felt in play.
const BAND_LINES = {
  intact: "The enemy presses the assault, but Karrowgate's walls stand firm.",
  damaged: "Karrowgate's walls are battered and breaking; the city's plight grows dire.",
  breached: 'The walls are breached — the enemy will storm the city unless you break the siege.',
}

const CLASH_LINES = {
  player: 'Enemy riders caught your foragers — your parties drove them off.',
  enemy: 'Enemy riders caught your foragers — your parties were scattered.',
}

// The charters a mission fate offers (docs/CAMPAIGN_PLAN.md 12-1). A DRAW of
// two, not the whole army: which cohort you can spare for three turns is the
// decision the card exists to pose, and picking the option means picking the
// charter — one decision, one click.
//
// The LOCKED row is shown, never hidden, and it names a real charter with the
// one word for why it cannot go. That is what teaches the mechanic: a player
// who sees the same cohort locked twice learns a charter can only be in one
// place at a time. The words are the player's (12-2) — a charter is "on a
// mission", never "tied up".
const BLOCKER_WORDS = {
  mission: 'already on a mission',
  empty: 'no troops left to send',
}

const MissionPicker = ({ offer, chosen, onChoose, busy }) => (
  <div className="mission-picker" data-testid="mission-picker">
    <span className="mission-picker-label">Which charter goes?</span>
    {offer.picks.map((squad) => (
      <button
        key={squad.id}
        className={`mission-pick${chosen === squad.id ? ' is-chosen' : ''}`}
        data-testid={`mission-pick-${squad.id}`}
        aria-pressed={chosen === squad.id}
        disabled={busy}
        onClick={() => onChoose(squad.id)}
      >
        <strong>{squad.name}</strong>
        <span>{squad.rank}</span>
      </button>
    ))}
    {offer.locked && (
      <span className="mission-pick is-locked" data-testid={`mission-locked-${offer.locked.id}`}>
        <strong>{offer.locked.name}</strong>
        <span>{BLOCKER_WORDS[offer.locked.blocker] ?? 'cannot go'}</span>
      </span>
    )}
  </div>
)

// The companies a charter fate offers (docs/CAMPAIGN_PLAN.md "CHARTER
// RECRUITMENT", R-2/R-3/R-6). A DRAFT of three rows, and picking the option
// means picking the company — one decision, one click, exactly as the mission
// picker works.
//
// Each card carries everything the server sent, because the COMPOSITION IS THE
// CHOICE (R-3): a draft that named three companies and withheld what each
// brings would be three coin-flips wearing a card. The rank word rides along
// because a company arriving Blooded comes with an upgrade slot already open
// (R-4) — the one thing on the card worth more than it looks.
//
// No locked row, unlike the mission picker: a company that was not drawn is
// simply one the drums did not reach, so there is nobody to name.
const CharterPicker = ({ offer, chosen, onChoose, busy }) => (
  <div className="charter-picker" data-testid="charter-picker">
    <span className="charter-picker-label">Which company takes service?</span>
    {offer.picks.map((row) => (
      <button
        key={row.id}
        className={`charter-pick${chosen === row.id ? ' is-chosen' : ''}`}
        data-testid={`charter-pick-${row.id}`}
        aria-pressed={chosen === row.id}
        disabled={busy}
        onClick={() => onChoose(row.id)}
      >
        <strong>{row.name}</strong>
        <span>{row.archetype} · {row.rank}</span>
        <span className="charter-pick-bodies">{composition(row.composition)}</span>
        <span>{row.blurb}</span>
      </button>
    ))}
  </div>
)

// What the company brings, in the roster's own words: "40 Soldier",
// "6 Cavalry · 6 LightCavalry". Not a total — which types is half of what
// makes one company different from another.
const composition = (bag) =>
  Object.entries(bag ?? {})
    .map(([type, n]) => `${n} ${type}`)
    .join(' · ')

const ChoiceOptions = ({ slot, options, onPick, busy, missionOffer, charterOffer }) => {
  // Which charter the player has picked for THIS card, before they commit by
  // clicking the option. Local: nothing is owed to the server until the option
  // is taken, and the sealed offer is what the server checks against anyway.
  const [squadId, setSquadId] = useState(null)
  // The same, for the company a charter branch enrols.
  const [charterId, setCharterId] = useState(null)
  const missionOption = options.find((o) => o.effectText?.length && isMissionOption(o))
  const charterOption = options.find((o) => o.effectText?.length && isCharterOption(o))
  const hasCharters = (charterOffer?.picks?.length ?? 0) > 0
  return (
    <>
      {missionOffer && missionOffer.picks.length > 0 && (
        <MissionPicker offer={missionOffer} chosen={squadId} onChoose={setSquadId} busy={busy} />
      )}
      {hasCharters && (
        <CharterPicker offer={charterOffer} chosen={charterId} onChoose={setCharterId} busy={busy} />
      )}
      <ChoiceButtons
        slot={slot}
        options={options}
        onPick={onPick}
        busy={busy}
        squadId={squadId}
        charterId={charterId}
        missionOptionId={missionOption?.id ?? null}
        // Only when there is something to pick: an offer that came back empty
        // (the catalog exhausted) is still answerable — the server accepts the
        // branch and enrols nobody — so holding the button back would strand
        // the player behind an unmakeable decision.
        charterOptionId={hasCharters ? (charterOption?.id ?? null) : null}
      />
    </>
  )
}

// An option needs a charter when the fate offered charters and this is the
// branch that spends one. The server is the authority on that pairing; the
// client only needs to know which button to hold back until a charter is
// picked, so it asks the option's own text rather than being told twice.
const isMissionOption = (option) =>
  (option.effectText ?? []).some((line) => /charter marches out/i.test(line))

// The same trick for the branch that ENROLS a company — keyed off the phrase
// describeEffect writes for a `squad` effect, so the pairing is stated once,
// server-side, and read here rather than declared twice.
const isCharterOption = (option) =>
  (option.effectText ?? []).some((line) => /take service under your banner/i.test(line))

const ChoiceButtons = ({ slot, options, onPick, busy, squadId, charterId, missionOptionId, charterOptionId }) => (
  <div className="choice-options">
    {options.map((option) => (
      <button
        key={option.id}
        className="choice-option"
        data-testid={`choice-${option.id}`}
        // A mission branch waits for its charter, and a charter branch for its
        // company: the server refuses a pick that names nobody, so offering
        // the button would only buy a 400.
        disabled={
          busy
          || (option.id === missionOptionId && !squadId)
          || (option.id === charterOptionId && !charterId)
        }
        onClick={() => onPick(slot, option, squadId, charterId)}
      >
        <strong>{option.label}</strong>
        <span>{option.description}</span>
        {/* What the branch MECHANICALLY costs or gives. Formatted server-side
            (describeEffect, via optionCard) so hidden state stays hidden — a
            garrison branch reads as a direction, never a resolve figure. Before
            this the options carried prose alone and a decision could only be
            made on tone. */}
        {option.effectText?.length > 0 && (
          <span className="choice-option-effect" data-testid={`choice-effect-${option.id}`}>
            {option.effectText.join(', ')}
          </span>
        )}
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
// What the fate DID, beside what it was. The standing rule (user, 2026-08-10)
// is that no card shows flavour alone, and this beat was the last place one
// still did: the figures existed, but only down in the flat "fortnight, in
// full" list, a beat away and mixed with upkeep, foraging and the enemy's turn.
// Empty for a choice-fate (the branch cards carry their own costs, below) and
// for a pure bookkeeping flag, which is the rule's one stated exemption.
const FateEffect = ({ effect, index }) =>
  effect?.length > 0 ? (
    <p className="fate-effect" data-testid={`fate-effect-${index}`}>
      {effect.join(', ')}
    </p>
  ) : null

const FateBeat = ({ slot, index, outcome, onPick, busy }) => {
  // Deferred (a counter-raid target): the blow hasn't fallen. The tent shows
  // only the prophecy and the pending threat — no verdict, no came-to-pass, no
  // scouts line. All of that reveals at end-day, after the raid phase.
  if (slot.deferred) {
    return (
      <div className="reveal-card report-augury-slot" data-testid={`reveal-beat-fate-${index}`}>
        <h3>{FATE_NAMES[index] ?? `Fate ${index + 1}`}</h3>
        {/* The TRUE fate, not the vision. The truth is already out by the time
            this renders, and the raid board names the same thing — the tent
            showing the bluff instead was the two screens disagreeing about
            what the player knows. */}
        {slot.threat && (
          <p data-testid={`fate-threat-${index}`}>
            Coming: <strong>{slot.threat.title}</strong>
            {slot.threat.effect?.length > 0 && ` — ${slot.threat.effect.join(', ')}`}
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
          <FateEffect effect={came.effect} index={index} />
          <p className={slot.wasAccurate ? 'augury-true' : 'augury-false'}>
            {slot.wasAccurate ? 'The augur spoke true.' : 'The augur was wrong.'}
          </p>
        </>
      ) : (
        <>
          <p>
            Unconsulted, fate struck anyway: <strong>{came.title}</strong>
            {came.description && ` — ${came.description}`}
          </p>
          <FateEffect effect={came.effect} index={index} />
        </>
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
        <ChoiceOptions
          slot={index}
          options={slot.pendingChoice.options}
          onPick={onPick}
          busy={busy}
          missionOffer={slot.pendingChoice.missionOffer}
          charterOffer={slot.pendingChoice.charterOffer}
        />
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
    <p>
      {enemy.bossFightDue
        ? 'The walls are breached and the assault is at hand — the enemy turns from the city to give you battle.'
        : (BAND_LINES[enemy.band] ?? "The enemy's movements are unclear.")}
    </p>
    {enemy.bossFightDue && <p>Battle will be joined if you take the field.</p>}
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

  const pick = async (slot, option, squadId, charterId) => {
    setBusy(true)
    try {
      // onChoose is guarded(): a failed post returns undefined and the
      // options stay up for another try.
      const resolved = await onChoose(slot, option.id, squadId, charterId)
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
            <ChoiceOptions
              slot={pending.slot}
              options={pending.options}
              onPick={pick}
              busy={busy}
              missionOffer={pending.missionOffer}
              charterOffer={pending.charterOffer}
            />
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
