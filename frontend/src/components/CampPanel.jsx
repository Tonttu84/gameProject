import React, { useState } from 'react'
import TutorialIntro from './TutorialIntro'

// Camp spending — the materials + labour sink, laid out as a right-side stack
// of self-contained boxes (fortifications on top, militia below). Raising the
// abstract fortification level walls a wider (and sturdier) span of your front
// deployment edge; the engine makes the enemy pay a combat penalty to assault
// across it, so you deploy behind the wall. Militia buys raw bodies. BOTH draw
// on the civilian workforce (workers.available): a fort needs stores + hands,
// each militiaman IS one worker taken off the pool. The fort cost/cap come from
// the campaign view (the server owns the rules); the militia cost preview
// mirrors the server config, and the server still validates and caps every buy.
const MILITIA_FOOD_COST = 2
const MILITIA_MATERIAL_COST = 1
const MILITIA_WORKER_COST = 1

const CampPanel = ({ fortification, resources, workers, onFortify, onBuyMilitia, tutorial }) => {
  const [militia, setMilitia] = useState(1)

  const { level, atCap, nextCost, nextWorkerCost } = fortification
  const materials = resources.materials ?? 0
  const food = resources.food ?? 0
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

  // The most militia the camp can pay for right now — whichever resource runs
  // out first. Clamps the input so the previewed cost never outruns the stores
  // (it used to accept 99999999); the server still caps the buy for real.
  const maxMilitia = Math.min(
    Math.floor(food / MILITIA_FOOD_COST),
    Math.floor(materials / MILITIA_MATERIAL_COST),
    Math.floor(workersFree / MILITIA_WORKER_COST),
  )
  const clampMilitia = (n) =>
    Math.min(Math.max(1, Math.floor(n) || 1), Math.max(1, maxMilitia))

  const militiaFood = militia * MILITIA_FOOD_COST
  const militiaMaterials = militia * MILITIA_MATERIAL_COST
  const militiaWorkers = militia * MILITIA_WORKER_COST
  const canBuyMilitia =
    militia > 0 &&
    food >= militiaFood &&
    materials >= militiaMaterials &&
    workersFree >= militiaWorkers
  // Why a buy is blocked (mirrors the fortify button's title), checked in the
  // same order costs are spent.
  const militiaReason =
    food < militiaFood
      ? 'Not enough food'
      : materials < militiaMaterials
        ? 'Not enough materials'
        : workersFree < militiaWorkers
          ? 'Not enough workers'
          : undefined

  // After a buy, workers/resources shrink but the input stays wherever the
  // player left it — stale enough to look like nothing happened (the button
  // still reads "Raise N militia" even though N workers are already spent
  // and gone). Reset to 1 so the next affordability preview is honest.
  const handleBuyMilitia = async () => {
    await onBuyMilitia(militia)
    setMilitia(1)
  }

  return (
    <aside className="camp-side" data-testid="camp-panel">
      <TutorialIntro
        id="camp"
        enabled={tutorial}
        title="The camp"
        lines={[
          'Spend salvaged materials on defensive works: each level walls a wider stretch of your front line.',
          'Deploy behind the wall — the enemy pays for every assault across it.',
          'Muster militia to fill out the ranks — both works and militia cost workers from your camp followers.',
        ]}
      />
      <div className="camp-workers-readout" data-testid="camp-workers">
        <div className="camp-workers-row">
          <span className="camp-workers-label">Workforce</span>
          <span className="camp-workers-count">{workersFree} free / {workersTotal} raised</span>
        </div>
        {/* workersTotal is a fixed ceiling (the campaign's starting workforce),
            never reduced — militia and fort labour are PERMANENT commitments
            (see campaignConfig.js), so they never return to the pool. Spell
            that out here instead of leaving "X / Y" to read as "X of Y
            currently checked out, comes back later". */}
        {workersUsed > 0 && (
          <span className="camp-workers-committed" data-testid="camp-workers-committed">
            {workersUsed} committed to militia &amp; works — gone for good
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
          disabled={!canFortify}
          title={fortReason}
        >
          {atCap
            ? 'Fortifications maxed'
            : `Raise to level ${level + 1} (${nextCost} materials, ${nextWorkerCost} workers)`}
        </button>
      </div>

      <div className="camp-box camp-militia-box" data-testid="camp-militia-box">
        <h3>Militia</h3>
        <label className="camp-row">
          Count
          <input
            type="number"
            min="1"
            value={militia}
            data-testid="militia-input"
            onChange={(e) => setMilitia(clampMilitia(Number(e.target.value)))}
          />
        </label>
        <button
          className="btn-primary"
          data-testid="militia-button"
          onClick={handleBuyMilitia}
          disabled={!canBuyMilitia}
          title={militiaReason}
        >
          Raise {militia} militia ({militiaFood} food, {militiaMaterials} materials, {militiaWorkers} workers)
        </button>
      </div>
    </aside>
  )
}

export default CampPanel
