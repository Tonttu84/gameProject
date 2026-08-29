import { Router } from 'express'
import UnitType from '../models/unitType.js'
import { getInfo } from '../services/engine.js'
import { spreadPlacement } from '../services/enemyPlacement.js'
import { runAndPersistSandboxBattle } from '../services/battleRunner.js'
import { userExtractor } from '../middleware/auth.js'
import { MAP_NAME, SANDBOX_MAX_UNITS_PER_SIDE } from '../utils/campaignConfig.js'

// THE BATTLE LAB (docs/CAMPAIGN_PLAN.md, "TEST / SANDBOX MODE", slice S1).
//
// A free-standing battle composed entirely by hand: both armies, both sides of
// the field, no campaign involved (SB-1). That is what makes it able to reach
// the fights the campaign cannot hand you — a battlefield enchantment needs
// Enchantment 2 while the host is sealed at 1, so no encounter can currently
// field one at all — and it is why this router touches no campaign document.
//
// It also means the lab CANNOT leak campaign state or undermine recon: the
// player composes the hypothetical enemy himself, so what he sees here is his
// own hypothesis, never the real host's numbers.
//
// Every route needs a login (SB-2): a launch spawns an engine subprocess, and
// this is the one route where the caller names how much work that subprocess
// does. The size cap is the other half of that guard.
const router = Router()

// The lab's zones, straight from the engine's own `info` — the same two the
// campaign deploys into. `blue` is the player's near edge, `red` the far one.
const zoneFor = (info, side) => (side === 'red' ? info.enemyZone : info.playerZone)

// Name → hex-packing size for EVERY type, not just the placeable ones: the lab
// composes from the full catalog (SB-1), so it must be able to weigh a
// Necromancer or a Scorpion, which `info.units` does not list.
const sizeCatalog = async () => {
  const types = await UnitType.find({}).select('name size')
  return new Map(types.map((t) => [t.name, t.size]))
}

// One placement entry, rebuilt from scratch rather than passed through. The
// body is untrusted (SECURITY_NOTES.md), and the engine reads fields — squad
// ids, character ids, caster paths — that mean things in the campaign layer
// that they must not be allowed to mean here. Whitelisting by CONSTRUCTION is
// the version of that guard which cannot be forgotten when a field is added.
//
// S2 adds the caster fields (paths and scripts) to this whitelist deliberately,
// one at a time, which is exactly the review this shape is meant to force.
const sanitizeEntry = (entry) => ({
  unit_type: String(entry?.unit_type ?? ''),
  q: Math.trunc(Number(entry?.q)),
  r: Math.trunc(Number(entry?.r)),
})

// Validate one side's placement: an array, within the cap, every type known to
// the catalog and every coordinate a real number. Returns an error STRING (the
// shape the routes turn into a 400) or null.
const placementError = (entries, side, sizes) => {
  if (!Array.isArray(entries)) return `${side}_placement must be an array`
  if (entries.length > SANDBOX_MAX_UNITS_PER_SIDE)
    return `too many units on the ${side} side (${entries.length}; the lab allows ${SANDBOX_MAX_UNITS_PER_SIDE})`
  for (const e of entries) {
    if (!sizes.has(e.unit_type)) return `unknown unit type "${e.unit_type}"`
    if (!Number.isFinite(e.q) || !Number.isFinite(e.r)) return 'placement coordinates must be numbers'
  }
  return null
}

// Launch one lab battle. Body is {player_placement, enemy_placement}: axial
// entries, one per BODY, exactly as the campaign's battle route builds them.
//
// The map is stamped here rather than taken from the body — only
// maps/sample_battle.json exists, so there is nothing to pick between, and a
// map name from the client is a filesystem argument the engine would read.
router.post('/battles', userExtractor, async (req, res) => {
  const sizes = await sizeCatalog()
  const playerPlacement = (Array.isArray(req.body?.player_placement) ? req.body.player_placement : [])
    .map(sanitizeEntry)
  const enemyPlacement = (Array.isArray(req.body?.enemy_placement) ? req.body.enemy_placement : [])
    .map(sanitizeEntry)

  const error =
    placementError(playerPlacement, 'player', sizes) ?? placementError(enemyPlacement, 'enemy', sizes)
  if (error) return res.status(400).json({ error })

  // Both sides empty is a battle with nothing in it; ONE side empty is a
  // legitimate thing to test (does a lone host walk the field? does a garrison
  // survive alone?), so only the pair is refused.
  if (playerPlacement.length === 0 && enemyPlacement.length === 0)
    return res.status(400).json({ error: 'place at least one unit before launching' })

  const { error: engineError, summary } = await runAndPersistSandboxBattle(
    { map: MAP_NAME, player_placement: playerPlacement, enemy_placement: enemyPlacement },
    req.user._id,
  )
  if (engineError) return res.status(400).json({ error: engineError })

  res.status(201).json(summary)
})

// Auto-place one side's army over its deployment zone (SB-3's per-side button).
// Body is {side: 'blue'|'red', army: {type: count}}; the response is the axial
// placement the client then draws and may edit by hand.
//
// This runs SERVER-side on purpose, through `spreadPlacement` — the very
// function the enemy's daily plan and both sides of a raid already use. Auto
// placement is therefore not new work and, more to the point, cannot drift from
// production: the lab packs hexes to the same capacity rule the real game does,
// so a formation that fits here fits there.
router.post('/auto-place', userExtractor, async (req, res) => {
  const side = req.body?.side === 'red' ? 'red' : 'blue'
  const army = req.body?.army
  if (!army || typeof army !== 'object' || Array.isArray(army))
    return res.status(400).json({ error: 'army must be an object of {unitType: count}' })

  const sizes = await sizeCatalog()
  let total = 0
  for (const [type, count] of Object.entries(army)) {
    if (!sizes.has(type)) return res.status(400).json({ error: `unknown unit type "${type}"` })
    const n = Number(count)
    if (!Number.isInteger(n) || n < 0) return res.status(400).json({ error: `bad count for "${type}"` })
    total += n
  }
  if (total > SANDBOX_MAX_UNITS_PER_SIDE)
    return res.status(400).json({
      error: `too many units on the ${side} side (${total}; the lab allows ${SANDBOX_MAX_UNITS_PER_SIDE})`,
    })

  const info = await getInfo()
  const placement = spreadPlacement(
    army,
    { ...zoneFor(info, side), width: info.grid.width, hexCapacity: info.grid.hexCapacity },
    sizes,
  )

  res.json({ placement })
})

export default router
