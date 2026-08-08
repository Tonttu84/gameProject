import React from 'react'
import TutorialIntro from './TutorialIntro'
import useCampaignStore from '../stores/useCampaignStore'
import useUiStore from '../stores/useUiStore'

// Camp spending — the materials + labour sink, laid out as a right-side stack
// of self-contained boxes. Raising the abstract fortification level walls a
// wider (and sturdier) span of your front deployment edge; the engine makes the
// enemy pay a combat penalty to assault across it, so you deploy behind the
// wall. It draws on the civilian workforce (workers.available) as well as
// stores: a fort needs both hands and materials. The cost/cap come from the
// campaign view (the server owns the rules) and the server still validates
// every spend. Buying troops does NOT live here — that's the Recruit phase
// (RecruitPanel), which is the other claim on the same workforce.

// fortification/resources/workers come straight from the campaign store;
// onFortify is still a prop (a guarded action). `locked` means the turn has
// marched past Prepare: the panel is a record of what stands, not a control
// (the server refuses the spend anyway — routes' rejectIfPhasePassed).
const CampPanel = ({ onFortify, locked }) => {
  const { fortification, resources, workers } = useCampaignStore((s) => s.campaign)
  const tutorial = useUiStore((s) => s.tutorial)

  const { level, atCap, nextCost, nextWorkerCost } = fortification
  const materials = resources.materials ?? 0
  const workersFree = workers?.available ?? 0
  const workersTotal = workers?.total ?? 0
  const workersUsed = workers?.used ?? 0

  const canFortify =
    !atCap &&
    nextCost != null &&
    materials >= nextCost &&
    workersFree >= (nextWorkerCost ?? 0)
  // The fort option always shows so players can save toward it: green when
  // affordable, red when short of materials OR workers, neutral once maxed.
  const fortState = atCap ? 'maxed' : canFortify ? 'affordable' : 'unaffordable'
  const fortReason = atCap
    ? 'Fortifications already at maximum'
    : materials < (nextCost ?? Infinity)
      ? 'Not enough materials'
      : workersFree < (nextWorkerCost ?? 0)
        ? 'Not enough workers'
        : undefined

  return (
    <aside className="camp-side" data-testid="camp-panel">
      <TutorialIntro
        id="camp"
        enabled={tutorial}
        title="The camp"
        lines={[
          'Dug in within sight of the enemy siege lines, your camp is what lets you hold and harry instead of give battle.',
          'Spend salvaged materials on defensive works: each level walls a wider stretch of your front line.',
          'Deploy behind the wall — the enemy pays for every assault across it.',
          'The works cost workers from your camp followers — the same pool the recruiters draw on.',
        ]}
      />
      <div className="camp-workers-readout" data-testid="camp-workers">
        <div className="camp-workers-row">
          <span className="camp-workers-label">Workforce</span>
          <span className="camp-workers-count">{workersFree} free / {workersTotal} raised</span>
        </div>
        {/* Recruited workers leave the workforce entirely (they become roster
            soldiers), so hiring shrinks workersTotal itself — "raised" moves.
            Fort labour is different: the worker is still around, just
            permanently busy, so that commitment lives in workersUsed and never
            returns to the pool. Spell that out here instead of leaving "X / Y"
            to read as "X of Y currently checked out, comes back later". */}
        {workersUsed > 0 && (
          <span className="camp-workers-committed" data-testid="camp-workers-committed">
            {workersUsed} committed to fortification work — gone for good
          </span>
        )}
      </div>

      <div className="camp-box camp-fort-box" data-testid="camp-fort-box">
        <h3>Fortifications</h3>
        <span className="camp-box-status" data-testid="fort-level">Level {level}</span>
        <button
          className={`btn-primary ${fortState}`}
          data-testid="fortify-button"
          onClick={onFortify}
          disabled={locked || !canFortify}
          title={locked ? 'The camp is behind you this turn' : fortReason}
        >
          {atCap
            ? 'Fortifications maxed'
            : `Raise to level ${level + 1} (${nextCost} materials, ${nextWorkerCost} workers)`}
        </button>
      </div>
    </aside>
  )
}

export default CampPanel
