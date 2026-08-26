import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import supertest from 'supertest'
import { startTestDb, stopTestDb, clearDb } from './helpers/db.js'
import { createUserAndToken } from './helpers/auth.js'
import { catalogFixture } from './fixtures/catalog.js'
import { clearSpellCatalogCache } from '../utils/spellCatalog.js'
import { clearRolls } from '../utils/dice.js'
import {
  ITEM_CATALOG,
  RESEARCH_POINTS_PER_MAGE,
  STARTING_MITHRIL,
} from '../utils/campaignConfig.js'
import {
  forgeRows,
  forgeView,
  meetsForgePaths,
  planForge,
  smithsFor,
} from '../services/forge.js'
import { researchingMages, researchRate, freshResearch } from '../services/magic.js'
import { applyEffect, describeEffect } from '../services/events.js'
import { applyRaidReward } from '../services/raid.js'

// The forge — Construction slice C1 (docs/CAMPAIGN_PLAN.md "THE CONSTRUCTION
// INTERVIEW", C-1..C-8). The pure half here mirrors magic.test.js's shape:
// skeleton campaigns through the planners, then the wired half through the
// route below.

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
afterEach(() => { clearRolls(); clearSpellCatalogCache() })

const auth = (req) => req.set('Authorization', `Bearer ${token}`)
const createCampaign = () => auth(api.post('/api/campaigns')).send({})

// A skeleton campaign for the pure planners — the same convention
// magic.test.js's campaignWith uses: only what the function under test reads.
const EMBEREDGE = ITEM_CATALOG.find((r) => r.id === 'forged_emberedge')
const HEART = ITEM_CATALOG.find((r) => r.id === 'forged_artificial_heart')
const mage = (over = {}) => ({
  id: 1, name: 'Aldric', type: 'Mage', alive: true, paths: { fire: 1 }, ...over,
})
const campaignWith = (over = {}) => ({
  day: 3,
  characters: [mage()],
  items: [],
  squads: [],
  resources: { mithril: 10 },
  research: {
    ...freshResearch(),
    schools: { ...freshResearch().schools, construction: { level: 1, points: 0 } },
  },
  ...over,
})

describe('the craftable rows (C-2 / C-6)', () => {
  test('a row is craftable iff it carries a forge block, and every forge block carries all three gates', () => {
    for (const row of forgeRows()) {
      expect(row.forge.level).toBeGreaterThan(0)
      expect(Object.keys(row.forge.paths).length).toBeGreaterThan(0)
      expect(row.forge.mithril).toBeGreaterThan(0)
    }
    expect(forgeRows().length).toBeGreaterThanOrEqual(3)
  })

  test('the catalog ships a binds-on-equip forging — the artificial heart (C-2)', () => {
    expect(HEART.permanent).toBe(true)
    expect(HEART.target).toBe('character')
    expect(HEART.forge).toBeTruthy()
  })
})

describe('who may smith what (C-1 / C-6)', () => {
  test('paths gate: the smith must himself command every path the row asks', () => {
    expect(meetsForgePaths(mage(), EMBEREDGE)).toBe(true)
    expect(meetsForgePaths(mage({ paths: { earth: 2 } }), EMBEREDGE)).toBe(false)
    expect(meetsForgePaths(mage({ paths: { earth: 2 } }), HEART)).toBe(true)
    expect(meetsForgePaths(mage({ paths: { earth: 1 } }), HEART)).toBe(false)
  })

  test('eligibility is location-blind (C-1): a mage posted to a squad, even one away on a mission, still smiths', () => {
    const c = campaignWith({
      characters: [mage({ squadId: 7 })],
      squads: [{ id: 7, mission: { untilDay: 9, eventId: 'x' } }],
    })
    expect(planForge(c, 1, 'forged_emberedge').error).toBeUndefined()
    expect(smithsFor(c, EMBEREDGE)).toEqual([{ id: 1, name: 'Aldric', forgedToday: false }])
  })

  test('planForge walks the gates in order: level, mithril, smith, paths, the stamp', () => {
    const low = campaignWith({ research: freshResearch() }) // construction 0
    expect(planForge(low, 1, 'forged_emberedge').error).toMatch(/Construction 1/)

    const poor = campaignWith({ resources: { mithril: 3 } })
    expect(planForge(poor, 1, 'forged_emberedge').error).toMatch(/mithril/)

    const c = campaignWith()
    expect(planForge(c, 99, 'forged_emberedge').error).toMatch(/no such character/)
    expect(planForge(c, 1, 'no_such_item').error).toMatch(/cannot be forged/)
    expect(planForge(c, 1, 'gear_iron_helm').error).toMatch(/cannot be forged/)

    const priest = campaignWith({
      characters: [{ id: 1, name: 'Odo', type: 'Priest', alive: true, paths: { fire: 2 } }],
    })
    expect(planForge(priest, 1, 'forged_emberedge').error).toMatch(/no smith/)

    const wrongPaths = campaignWith({ characters: [mage({ paths: { water: 2 } })] })
    expect(planForge(wrongPaths, 1, 'forged_emberedge').error).toMatch(/paths/)

    const spent = campaignWith({ characters: [mage({ forgedDay: 3 })] })
    expect(planForge(spent, 1, 'forged_emberedge').error).toMatch(/already forged/)
    // …and the stamp expires with the day moving on, nothing ever clears it.
    const yesterday = campaignWith({ characters: [mage({ forgedDay: 2 })] })
    expect(planForge(yesterday, 1, 'forged_emberedge').error).toBeUndefined()
  })

  test('a valid plan resolves the smith, the row and the price', () => {
    const plan = planForge(campaignWith(), 1, 'forged_emberedge')
    expect(plan).toMatchObject({ cost: EMBEREDGE.forge.mithril })
    expect(plan.row.id).toBe('forged_emberedge')
    expect(plan.character.name).toBe('Aldric')
  })
})

describe("forging's research price (C-6)", () => {
  test('a mage who forged today is excluded from the accrual — his points simply never arrive', () => {
    const c = campaignWith({
      characters: [mage(), mage({ id: 2, name: 'Berthold', forgedDay: 3 })],
    })
    expect(researchingMages(c)).toBe(1)
    expect(researchRate(c)).toBe(RESEARCH_POINTS_PER_MAGE)
  })

  test('the exclusion lasts one day: yesterday’s stamp studies again', () => {
    const c = campaignWith({ characters: [mage({ forgedDay: 2 })] })
    expect(researchingMages(c)).toBe(1)
  })

  test('a skeleton campaign with no day at all keeps every mage studying', () => {
    expect(researchingMages({ characters: [mage()] })).toBe(1)
  })
})

describe('the view (C-6, both doors render from it)', () => {
  test('rows carry the three gates resolved and phrased, and the qualifying smiths', () => {
    const view = forgeView(campaignWith())
    expect(view.level).toBe(1)
    const ember = view.rows.find((r) => r.id === 'forged_emberedge')
    expect(ember).toMatchObject({
      levelMet: true, mithrilMet: true, held: false,
      mithril: EMBEREDGE.forge.mithril, pathsText: 'Fire 1',
    })
    expect(ember.smiths).toEqual([{ id: 1, name: 'Aldric', forgedToday: false }])
    // Locked rows are shown locked rather than hidden — the ladder reads.
    const heart = view.rows.find((r) => r.id === 'forged_artificial_heart')
    expect(heart.levelMet).toBe(false)
    expect(heart.smiths).toEqual([])
    // The binding warning rides the same describeItem phrasing the store uses.
    expect(heart.binding).toMatch(/it stays/)
  })
})

describe('mithril arrives by four channels (C-7)', () => {
  test('the event tap: applyEffect moves the resource and the reveal phrases it', () => {
    const c = { resources: { mithril: 2 } }
    applyEffect(c, { type: 'mithril', delta: +3 })
    expect(c.resources.mithril).toBe(5)
    applyEffect(c, { type: 'mithril', delta: -99 })
    expect(c.resources.mithril).toBe(0) // floored like every resource
    expect(describeEffect({ type: 'mithril', delta: +3 })).toEqual(['Mithril +3'])
  })

  test('the raid tap: a strongbox in a won supply train reaches the stores', () => {
    const c = {
      resources: { food: 0, materials: 0, gold: 0, horses: 0, mithril: 1 },
      roster: new Map(),
      log: [],
    }
    const entries = applyRaidReward(c, {
      type: 'loot_supplies',
      reward: { food: 1000, materials: 5, gold: 2, mithril: 4 },
    })
    expect(c.resources.mithril).toBe(5)
    expect(entries.join(' ')).toMatch(/strongbox/)
  })
})

describe('POST /api/campaigns/:id/forge — the one action, whichever door (C-6)', () => {
  // Open the gates a fresh campaign has shut: Construction 1, a mage whose
  // paths are known rather than rolled. Direct document surgery, the same
  // convention research.test.js uses to reach mid-campaign states.
  const openTheForge = async (id) => {
    const stored = await Campaign.findById(id)
    stored.research.schools.get('construction').level = 1
    const smith = stored.characters.find((c) => c.type === 'Mage')
    smith.paths = new Map([['fire', 1]])
    await stored.save()
    return smith.id
  }

  test('the happy path: mithril debited, stamp set, item in the store, log written', async () => {
    const { body: fresh } = await createCampaign()
    expect(fresh.resources.mithril).toBe(STARTING_MITHRIL)
    const smithId = await openTheForge(fresh.id)

    const { body, status } = await auth(api.post(`/api/campaigns/${fresh.id}/forge`))
      .send({ characterId: smithId, itemId: 'forged_emberedge' })
    expect(status).toBe(200)
    expect(body.resources.mithril).toBe(STARTING_MITHRIL - EMBEREDGE.forge.mithril)
    expect(body.items.map((r) => r.id)).toContain('forged_emberedge')
    expect(body.characters.find((c) => c.id === smithId).forgedToday).toBe(true)
    const ember = body.forge.rows.find((r) => r.id === 'forged_emberedge')
    // Other starting mages may have rolled Fire too — assert on OUR smith.
    expect(ember.smiths).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: smithId, forgedToday: true })]),
    )
    expect(body.log.at(-1).entries.join(' ')).toMatch(/forge/)
  })

  test('the once-per-turn stamp holds at the route: the same smith cannot forge twice today', async () => {
    const { body: fresh } = await createCampaign()
    const smithId = await openTheForge(fresh.id)
    await auth(api.post(`/api/campaigns/${fresh.id}/forge`))
      .send({ characterId: smithId, itemId: 'forged_emberedge' })
    // The same row again — kit stacks (9-6), so the ITEM gates all pass and
    // the refusal that fires is the stamp's.
    const { status, body } = await auth(api.post(`/api/campaigns/${fresh.id}/forge`))
      .send({ characterId: smithId, itemId: 'forged_emberedge' })
    expect(status).toBe(400)
    expect(body.error).toMatch(/already forged/)
  })

  test('prepare-only, like fortify: a turn past the phase refuses', async () => {
    const { body: fresh } = await createCampaign()
    const smithId = await openTheForge(fresh.id)
    await Campaign.findByIdAndUpdate(fresh.id, { phase: 'raids' })
    const { status } = await auth(api.post(`/api/campaigns/${fresh.id}/forge`))
      .send({ characterId: smithId, itemId: 'forged_emberedge' })
    expect(status).toBe(409) // rejectIfPhasePassed's code, same as fortify
  })

  test('a forged item is a NORMAL store item (C-2): it equips like loot, and the heart never comes off', async () => {
    const { body: fresh } = await createCampaign()
    const stored = await Campaign.findById(fresh.id)
    stored.research.schools.get('construction').level = HEART.forge.level
    const smith = stored.characters.find((c) => c.type === 'Mage')
    smith.paths = new Map([['earth', 2]])
    await stored.save()

    await auth(api.post(`/api/campaigns/${fresh.id}/forge`))
      .send({ characterId: smith.id, itemId: 'forged_artificial_heart' })
    const { status } = await auth(
      api.post(`/api/campaigns/${fresh.id}/characters/${smith.id}/equip`),
    ).send({ slot: 'torso', index: 0, itemId: 'forged_artificial_heart' })
    expect(status).toBe(200)

    const { status: refusal, body } = await auth(
      api.post(`/api/campaigns/${fresh.id}/characters/${smith.id}/unequip`),
    ).send({ slot: 'torso', index: 0 })
    expect(refusal).toBe(400)
    expect(body.error).toMatch(/cannot be taken back/)
  })
})
