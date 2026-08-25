import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import { startTestDb, stopTestDb, clearDb } from './helpers/db.js'
import Battle from '../models/battle.js'
import Tick from '../models/tick.js'
import { sweepOldBattles } from '../services/battleRetention.js'

// Keeping only the turn you can watch (docs/CAMPAIGN_PLAN.md, "TIERED BATTLE
// LOGGING", L-6).
//
// The tiered log made every replay bigger (~21 MB of ticks for a full battle),
// and nothing in the UI can open an old one — campaignView ships the id list but
// no component consumes it. So old replays are storage nobody can reach, and
// this sweep is what stops a long campaign accumulating them.

beforeAll(startTestDb)
afterAll(stopTestDb)
beforeEach(clearDb)

// A battle plus one tick, so the sweep has something to reclaim.
const makeBattle = async (day) => {
  const battle = await Battle.create({
    map: 'sample_battle', winner: 'blue', tickCount: 1, day,
  })
  await Tick.create({
    battle: battle._id, index: 0, units: [],
    log: [{ tier: 'basic', text: 'Turn 1' }],
  })
  return battle
}

describe('sweeping battles nobody can watch', () => {
  test("keeps the current turn's battles and deletes what came before", async () => {
    const old1 = await makeBattle(1)
    const old2 = await makeBattle(2)
    const today = await makeBattle(3)
    const campaign = { id: 'c1', day: 3, battles: [old1._id, old2._id, today._id] }

    const { deleted } = await sweepOldBattles(campaign)

    expect(deleted).toBe(2)
    expect(await Battle.countDocuments()).toBe(1)
    expect((await Battle.findOne())._id.toString()).toBe(today._id.toString())
    // The id list is pruned with them — a campaign should not carry references
    // to documents that no longer exist.
    expect(campaign.battles).toEqual([today._id.toString()])
  })

  test('deletes the TICKS, which are the storage this exists to reclaim', async () => {
    const old = await makeBattle(1)
    const today = await makeBattle(2)
    const campaign = { id: 'c1', day: 2, battles: [old._id, today._id] }

    await sweepOldBattles(campaign)

    expect(await Tick.countDocuments({ battle: old._id })).toBe(0)
    expect(await Tick.countDocuments({ battle: today._id })).toBe(1)
  })

  test('NEVER touches a battle outside the campaign — the sample demo survives', async () => {
    // The login-screen demo battle is ownerless, belongs to no turn and is in no
    // campaign's list. Sweeping it would break the front page for everyone.
    const sample = await Battle.create({
      map: 'sample_battle', winner: 'blue', tickCount: 1, day: null, user: null,
    })
    const old = await makeBattle(1)
    const campaign = { id: 'c1', day: 2, battles: [old._id] }

    await sweepOldBattles(campaign)

    expect(await Battle.findById(sample._id)).not.toBeNull()
  })

  test('a battle stored before `day` existed reads as old and is swept', async () => {
    // Null day means "belongs to no turn". Inside a campaign's list that can
    // only be a battle from before the field existed — and it cannot be watched
    // either, so it goes.
    const ancient = await makeBattle(null)
    const campaign = { id: 'c1', day: 5, battles: [ancient._id] }

    const { deleted } = await sweepOldBattles(campaign)

    expect(deleted).toBe(1)
    expect(await Battle.countDocuments()).toBe(0)
  })

  test('is a no-op on a campaign that has fought nothing', async () => {
    const campaign = { id: 'c1', day: 1, battles: [] }
    expect((await sweepOldBattles(campaign)).deleted).toBe(0)
  })

  test('is a no-op when every battle is from the current turn', async () => {
    const a = await makeBattle(4)
    const b = await makeBattle(4)
    const campaign = { id: 'c1', day: 4, battles: [a._id, b._id] }

    expect((await sweepOldBattles(campaign)).deleted).toBe(0)
    expect(await Battle.countDocuments()).toBe(2)
    expect(await Tick.countDocuments()).toBe(2)
  })
})
