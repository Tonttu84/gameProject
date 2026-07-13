import {
  FORTIFICATION_PRESETS,
  FORTIFICATION_MAX_LEVEL,
  FORTIFY_COST_BASE,
  FORTIFY_WORKER_COST_BASE,
} from '../utils/campaignConfig.js'

// Campaign fortifications as an abstract level → concrete engine hexsides.
// Pure functions over FORTIFICATION_PRESETS; the route injects the result into
// the battle input as `fortified_sides` (the engine's BattleServer seam), the
// view exposes cost/cap. See docs/CAMPAIGN_PLAN.md Stage 3.

// The `fortified_sides` array a battle on `mapName` at `level` should carry:
// every preset side with tier ≤ level, stripped to the engine's entry shape
// {q, r, dir, durability}. Level 0 (or an unknown map) yields [].
export function fortifiedSidesFor(mapName, level) {
  const presets = FORTIFICATION_PRESETS[mapName]
  if (!presets || level <= 0) return []
  return presets
    .filter((p) => p.tier <= level)
    .map(({ q, r, dir, durability }) => ({ q, r, dir, durability }))
}

// Materials cost to raise the fort from `level` to `level + 1`.
// L0→1 = 50, L1→2 = 100. (Undefined once at the cap; callers gate on atFortCap.)
export const fortifyCost = (level) => FORTIFY_COST_BASE * (level + 1)

// Worker (labour) cost to raise the fort from `level` to `level + 1`.
// L0→1 = 500, L1→2 = 1000. A fort needs both this and the materials cost.
export const fortifyWorkerCost = (level) => FORTIFY_WORKER_COST_BASE * (level + 1)

export const atFortCap = (level) => level >= FORTIFICATION_MAX_LEVEL
