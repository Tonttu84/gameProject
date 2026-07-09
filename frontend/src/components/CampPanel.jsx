import React, { useState } from 'react'
import TutorialIntro from './TutorialIntro'

// Camp spending — the materials sink. Raising the abstract fortification level
// walls a wider (and sturdier) span of your front deployment edge; the engine
// makes the enemy pay a combat penalty to assault across it, so you deploy
// behind the wall. Militia buys raw bodies with stores. The fort cost/cap come
// from the campaign view (the server owns the rules); the militia cost preview
// mirrors the server config (2 food + 1 material per head) — the server still
// validates and caps the purchase.
const MILITIA_FOOD_COST = 2
const MILITIA_MATERIAL_COST = 1

const CampPanel = ({ fortification, resources, onFortify, onBuyMilitia, tutorial }) => {
  const [militia, setMilitia] = useState(1)

  const { level, atCap, nextCost } = fortification
  const materials = resources.materials ?? 0
  const food = resources.food ?? 0

  const canFortify = !atCap && nextCost != null && materials >= nextCost

  const militiaFood = militia * MILITIA_FOOD_COST
  const militiaMaterials = militia * MILITIA_MATERIAL_COST
  const canBuyMilitia = militia > 0 && food >= militiaFood && materials >= militiaMaterials

  return (
    <div className="camp-panel" data-testid="camp-panel">
      <TutorialIntro
        id="camp"
        enabled={tutorial}
        title="The camp"
        lines={[
          'Spend salvaged materials on defensive works: each level walls a wider stretch of your front line.',
          'Deploy behind the wall — the enemy pays for every assault across it.',
          'Muster militia to fill out the ranks when stores allow.',
        ]}
      />
      <h3>Camp Works</h3>
      <div className="camp-forts">
        <span data-testid="fort-level">Fortifications: Level {level}</span>
        <button
          className="btn-primary"
          data-testid="fortify-button"
          onClick={onFortify}
          disabled={!canFortify}
          title={
            atCap
              ? 'Fortifications already at maximum'
              : materials < (nextCost ?? Infinity)
                ? 'Not enough materials'
                : undefined
          }
        >
          {atCap ? 'Fortifications maxed' : `Raise to level ${level + 1} (${nextCost} materials)`}
        </button>
      </div>
      <div className="camp-militia">
        <label className="camp-row">
          Militia
          <input
            type="number"
            min="1"
            value={militia}
            data-testid="militia-input"
            onChange={(e) => setMilitia(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
          />
        </label>
        <button
          className="btn-primary"
          data-testid="militia-button"
          onClick={() => onBuyMilitia(militia)}
          disabled={!canBuyMilitia}
        >
          Raise {militia} militia ({militiaFood} food, {militiaMaterials} materials)
        </button>
      </div>
    </div>
  )
}

export default CampPanel
