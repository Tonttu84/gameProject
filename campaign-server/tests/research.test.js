import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import supertest from 'supertest'
import { startTestDb, stopTestDb, clearDb } from './helpers/db.js'
import { createUserAndToken } from './helpers/auth.js'
import { battleResultFixture } from './fixtures/battleResult.js'
import { catalogFixture } from './fixtures/catalog.js'
import { clearRolls } from '../utils/dice.js'
import {
  CHANNELS_BY_BANNER_TIER,
  ENEMY_SCHOOLS,
  RESEARCH_DEFAULT_FOCUS,
  RESEARCH_POINTS_PER_MAGE,
  SPELL_PATHS,
  SPELL_SCHOOLS,
  STARTING_CHARACTERS,
} from '../utils/campaignConfig.js'

// The magic campaign layer's WIRED half (docs/CAMPAIGN_PLAN.md "▶ SLICE 2"):
// the focus route, what campaignView projects, the end-of-turn accrual, and the
// `magic` block both battle-input builders send. The pure half — the hire roll,
// the research arithmetic, the channel table — lives in magic.test.js.

vi.mock('../services/engine.js', () => ({
  runBattle: vi.fn(),
  getInfo: vi.fn(),
  dumpUnits: vi.fn(),
  EngineProcessError: class EngineProcessError extends Error { name = 'EngineProcessError' },
  EngineOutputError: class EngineOutputError extends Error { name = 'EngineOutputError' },
}))

const engine = await import('../services/engine.js')
const { default: app } = await import('../app.js')
const { default: Campaign } = await import('../models/campaign.js')
const { default: UnitType } = await import('../models/unitType.js')

const api = supertest(app)

const infoFixture = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  units: [],
  terrain: [],
}

let token

beforeAll(startTestDb)
afterAll(stopTestDb)
beforeEach(async () => {
  await clearDb()
  vi.clearAllMocks()
  engine.getInfo.mockResolvedValue(infoFixture)
  await UnitType.insertMany(catalogFixture.units)
  ;({ token } = await createUserAndToken(api))
})
afterEach(clearRolls)

const auth = (req) => req.set('Authorization', `Bearer ${token}`)
const createCampaign = () => auth(api.post('/api/campaigns')).send({})
const endTurn = async (id) => {
  await Campaign.findByIdAndUpdate(id, { phase: 'recruit' })
  return auth(api.post(`/api/campaigns/${id}/end-day`)).send({})
}

describe('a fresh campaign (S2-2 / S2-3 / S2-9)', () => {
  test('starts with all four schools at 0 — the three Mages can cast nothing on day 1', async () => {
    const { body } = await createCampaign()
    expect(Object.keys(body.research.schools).sort()).toEqual([...SPELL_SCHOOLS].sort())
    for (const school of SPELL_SCHOOLS)
      expect(body.research.schools[school]).toMatchObject({ level: 0, points: 0 })
  })

  test('carries a focus, so turn 1 has somewhere to study', async () => {
    const { body } = await createCampaign()
    expect(body.research.focus).toBe(RESEARCH_DEFAULT_FOCUS)
    expect(body.research.allies).toBe(0)
  })

  test('rolls paths for every starting caster, and the sheet names them', async () => {
    const { body } = await createCampaign()
    expect(body.characters).toHaveLength(STARTING_CHARACTERS.length)
    for (const c of body.characters) {
      expect(c.paths.length).toBeGreaterThan(0)
      for (const row of c.paths) {
        expect(SPELL_PATHS).toContain(row.path)
        expect(row.level).toBeGreaterThan(0)
        expect(row.label).toBeTruthy() // phrased server-side (17-5)
      }
    }
  })

  test('every starting Priest is flat Holy 2 — the certainty the lane sells', async () => {
    const { body } = await createCampaign()
    for (const c of body.characters.filter((x) => x.type === 'Priest'))
      expect(c.paths).toEqual([{ path: 'holy', label: 'Holy', level: 2 }])
  })

  test('a starting Mage never draws Holy or Unholy', async () => {
    const { body } = await createCampaign()
    for (const c of body.characters.filter((x) => x.type === 'Mage'))
      for (const row of c.paths) expect(['holy', 'unholy']).not.toContain(row.path)
  })

  test('seals the host\'s schools at creation, and never shows them to the player', async () => {
    const { body } = await createCampaign()
    const stored = await Campaign.findById(body.id)
    expect(Object.fromEntries(stored.enemy.magic.schools)).toEqual(ENEMY_SCHOOLS)
    expect(JSON.stringify(body)).not.toContain('"magic"')
  })

  test('seals paths onto the host\'s planned casters (S2-10)', async () => {
    const { body } = await createCampaign()
    const stored = await Campaign.findById(body.id)
    const casters = stored.enemy.plannedPlacement.filter((e) => e.unit_type === 'Necromancer')
    expect(casters.length).toBeGreaterThan(0)
    for (const caster of casters) {
      // Death 2 at least: S2-9 says the host keeps raising, so no roll may
      // leave one of their raisers unable to.
      expect(caster.paths.death).toBeGreaterThanOrEqual(2)
      // The full map, zeros included — otherwise Necromancer()'s Death 1 seed
      // would stand beside a roll that meant to replace it.
      expect(Object.keys(caster.paths).sort()).toEqual([...SPELL_PATHS].sort())
    }
  })
})

describe('choosing what to study (S2-12)', () => {
  test('sets the focus and answers with the campaign view', async () => {
    const { body } = await createCampaign()
    const res = await auth(api.post(`/api/campaigns/${body.id}/research`)).send({ school: 'conjuration' })
    expect(res.status).toBe(200)
    expect(res.body.research.focus).toBe('conjuration')
  })

  test('is freely re-settable — nothing is spent, so a misclick costs nothing', async () => {
    const { body } = await createCampaign()
    for (const school of ['conjuration', 'enchantment', 'evocation']) {
      const res = await auth(api.post(`/api/campaigns/${body.id}/research`)).send({ school })
      expect(res.status).toBe(200)
      expect(res.body.research.focus).toBe(school)
    }
  })

  test('refuses a school that does not exist', async () => {
    const { body } = await createCampaign()
    const res = await auth(api.post(`/api/campaigns/${body.id}/research`)).send({ school: 'necromancy' })
    expect(res.status).toBe(400)
  })

  test('is a CAMP decision: refused once the turn has walked past Prepare', async () => {
    const { body } = await createCampaign()
    // Past prepare, the omens and the raid board have been seen — information
    // the choice is not supposed to get.
    await Campaign.findByIdAndUpdate(body.id, { phase: 'raids' })
    const res = await auth(api.post(`/api/campaigns/${body.id}/research`)).send({ school: 'conjuration' })
    // 409, the turn's own "that decision is made" — the same answer every other
    // phase-gated route gives, rather than a 400 that would read as bad input.
    expect(res.status).toBe(409)
  })

  test('refuses a campaign that is over, and one that is not yours', async () => {
    const { body } = await createCampaign()
    await Campaign.findByIdAndUpdate(body.id, { status: 'won' })
    expect((await auth(api.post(`/api/campaigns/${body.id}/research`)).send({ school: 'evocation' })).status).toBe(400)
    expect((await api.post(`/api/campaigns/${body.id}/research`).send({ school: 'evocation' })).status).toBe(401)
  })
})

describe('the fortnight\'s study (S2-6 / S2-7)', () => {
  test('accrues at end of turn, into the focused school only', async () => {
    const { body } = await createCampaign()
    await auth(api.post(`/api/campaigns/${body.id}/research`)).send({ school: 'conjuration' })
    await endTurn(body.id)
    const after = await auth(api.get(`/api/campaigns/${body.id}`))
    const mages = STARTING_CHARACTERS.filter((c) => c.type === 'Mage').length
    const gained = mages * RESEARCH_POINTS_PER_MAGE
    const school = after.body.research.schools.conjuration
    // Three Mages open a school at the end of turn 1: the points bought level 1.
    expect(school.level * 30 + school.points).toBe(gained)
    expect(after.body.research.schools.evocation).toMatchObject({ level: 0, points: 0 })
  })

  test('says so in the day report, so the first unlock is an event the player feels', async () => {
    const created = await createCampaign()
    const { body } = await endTurn(created.body.id)
    expect(body.report.entries.join(' ')).toMatch(/Evocation/i)
  })
})

describe('what the engine is told (S2-8 / S2-9 / M-19)', () => {
  const battleInput = () => engine.runBattle.mock.calls.at(-1)[0]

  // The pitched battle is the boss fight (it fires only while bossFightDue) and
  // it commits the WHOLE army, so the army is shrunk to one charter's worth of
  // Soldiers and exactly that is fielded. Characters live outside `roster` and
  // ride along automatically when their charter goes (5-8), which is what lets
  // the caster case below post a Mage without touching the gate.
  const ARMY = 4
  const fieldPitchedBattle = async (campaignId, extraBody = {}, forgeEntry = {}) => {
    engine.runBattle.mockResolvedValue(battleResultFixture)
    const stored = await Campaign.findById(campaignId)
    const squad = stored.squads[0]
    squad.composition = new Map([['Soldier', ARMY]])
    for (const other of stored.squads.slice(1)) other.composition = new Map()
    stored.roster = new Map([['Soldier', ARMY]])
    stored.bossFightDue = true
    stored.phase = 'deploy'
    await stored.save()
    const placement = Array.from({ length: ARMY }, () => ({
      unit_type: 'Soldier', q: 4, r: 4, squad_id: squad.id, ...forgeEntry,
    }))
    return auth(api.post(`/api/campaigns/${campaignId}/battles`))
      .send({ player_placement: placement, ...extraBody })
  }

  test('the pitched battle carries a magic block for both sides', async () => {
    const { body } = await createCampaign()
    const res = await fieldPitchedBattle(body.id)
    expect(res.status).toBeLessThan(400)
    const input = battleInput()
    expect(input.magic.blue.schools).toEqual(
      Object.fromEntries(SPELL_SCHOOLS.map((s) => [s, 0])), // day 1: nothing researched
    )
    expect(input.magic.red.schools).toEqual(ENEMY_SCHOOLS)
  })

  test('the player\'s channels count the squads ON THE FIELD, and no others (S2-8)', async () => {
    const { body } = await createCampaign()
    await fieldPitchedBattle(body.id)
    // The starting charters carry no banner and are below the banner rung, so
    // the plain tier is what a fresh army channels — which is nothing.
    expect(battleInput().magic.blue.channels).toBe(CHANNELS_BY_BANNER_TIER.plain)
  })

  test('a player caster reaches the field with the full path map, zeros included', async () => {
    const { body } = await createCampaign()
    const stored = await Campaign.findById(body.id)
    const squad = stored.squads[0]
    // Post a Mage to the charter that is taking the field: attached characters
    // ride along automatically (5-8), so this is the whole of getting him there.
    const mage = stored.characters.find((c) => c.type === 'Mage')
    await auth(api.post(`/api/campaigns/${body.id}/characters/${mage.id}/attach`))
      .send({ squadId: squad.id })
    const res = await fieldPitchedBattle(body.id)
    expect(res.status).toBeLessThan(400)
    const entry = battleInput().player_placement.find((e) => e.character_id === mage.id)
    expect(entry).toBeTruthy()
    expect(Object.keys(entry.paths).sort()).toEqual([...SPELL_PATHS].sort())
    // What the record says, and only that — his rolled level, and 0 everywhere
    // the roll did not reach.
    const rolled = Object.fromEntries(mage.paths)
    for (const path of SPELL_PATHS) expect(entry.paths[path]).toBe(rolled[path] ?? 0)
  })

  test('an ordinary trooper is sent no paths at all', async () => {
    const { body } = await createCampaign()
    await fieldPitchedBattle(body.id)
    for (const entry of battleInput().player_placement)
      if (entry.character_id == null) expect(entry.paths).toBeUndefined()
  })

  test('a forged `paths` in the request body is overwritten, never trusted', async () => {
    const { body } = await createCampaign()
    await fieldPitchedBattle(body.id, {}, { paths: { fire: 9, holy: 9 } })
    for (const entry of battleInput().player_placement)
      expect(entry.paths?.fire).not.toBe(9)
  })

  test('a forged `magic` block in the request body never reaches the engine', async () => {
    const { body } = await createCampaign()
    await fieldPitchedBattle(body.id, {
      magic: { blue: { schools: { evocation: 9 }, channels: 99 } },
    })
    expect(battleInput().magic.blue.schools.evocation).toBe(0)
    expect(battleInput().magic.blue.channels).toBe(CHANNELS_BY_BANNER_TIER.plain)
  })

  test('a raid carries the same block, and its enemy casters field their SEALED roll', async () => {
    engine.runBattle.mockResolvedValue(battleResultFixture)
    const { body } = await createCampaign()
    const stored = await Campaign.findById(body.id)
    // Force a target the raid can actually fight, with a caster on it.
    const opp = stored.raid.opportunities[0]
    stored.raid.opportunities[0].targetForce = new Map([['Soldier', 10], ['Necromancer', 2]])
    stored.raid.opportunities[0].casterPaths = [{ death: 4 }, { death: 5 }]
    stored.raid.opportunities[0].capacity = 100000
    await stored.save()
    const res = await auth(api.post(`/api/campaigns/${body.id}/raids/launch`))
      .send({ parties: { [opp.id]: [stored.squads[0].id] } })
    expect(res.status).toBe(201)
    const input = battleInput()
    expect(input.magic.red.schools).toEqual(ENEMY_SCHOOLS)
    const casters = input.enemy_placement.filter((e) => e.unit_type === 'Necromancer')
    expect(casters.map((c) => c.paths.death).sort()).toEqual([4, 5])
  })
})
