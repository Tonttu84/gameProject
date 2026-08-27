import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import supertest from 'supertest'
import { startTestDb, stopTestDb, clearDb } from './helpers/db.js'
import { createUserAndToken } from './helpers/auth.js'
import { catalogFixture } from './fixtures/catalog.js'
import { clearSpellCatalogCache } from '../utils/spellCatalog.js'
import { clearRolls, pushRoll } from '../utils/dice.js'
import {
  CRAFTED_UNIT_CATALOG,
  GOLEM_NAMES,
  MINDLESS_CHARACTER_TYPES,
} from '../utils/campaignConfig.js'
import {
  craftedUnitRows,
  craftedUnitView,
  planCraftUnit,
} from '../services/forge.js'
import { isCasterType, rollPaths, freshResearch } from '../services/magic.js'
import {
  allBodies, eatingBodies, isCharacterType, isMindlessType,
} from '../services/characters.js'

// The foundry — Construction slice C3 (docs/CAMPAIGN_PLAN.md C-4/C-5): the
// units the forge can raise. Same shape as forge.test.js beside it — pure
// planners over skeleton campaigns first, then the wired route.

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

const GOLEM = CRAFTED_UNIT_CATALOG.find((r) => r.id === 'crafted_golem')
const smithFor = (row, over = {}) => ({
  id: 1, name: 'Aldric', type: 'Mage', alive: true, paths: { ...row.forge.paths }, ...over,
})
const campaignWith = (over = {}) => ({
  day: 3,
  characters: [smithFor(GOLEM)],
  items: [],
  squads: [],
  resources: { mithril: 20 },
  research: {
    ...freshResearch(),
    schools: { ...freshResearch().schools, construction: { level: GOLEM.forge.level, points: 0 } },
  },
  ...over,
})

describe('the foundry catalog (C-4 / C-5 / C-6)', () => {
  test('every row carries the three gates and names the unit it raises', () => {
    expect(craftedUnitRows().length).toBeGreaterThanOrEqual(1)
    for (const row of craftedUnitRows()) {
      expect(row.forge.level).toBeGreaterThan(0)
      expect(Object.keys(row.forge.paths).length).toBeGreaterThan(0)
      expect(row.forge.mithril).toBeGreaterThan(0)
      // The foundry mints INDIVIDUALS (C-4): every unit it raises must be a
      // character type, or the route would have nowhere to put the body.
      expect(isCharacterType(row.unit), `${row.unit} is craftable but not a character type`).toBe(true)
    }
  })

  test('the golem is the mindless character — and the only mindless kind is crafted', () => {
    expect(isMindlessType('Golem')).toBe(true)
    expect(isMindlessType('Mage')).toBe(false)
    // C-4: the exception, not a precedent — every mindless type today is one
    // the foundry raises, so nothing hired can be mindless by accident.
    const crafted = new Set(CRAFTED_UNIT_CATALOG.map((r) => r.unit))
    for (const type of MINDLESS_CHARACTER_TYPES) expect(crafted.has(type)).toBe(true)
  })

  test('a golem is no caster: no paths on the wire, and rolling for one draws nothing', () => {
    expect(isCasterType('Golem')).toBe(false)
    // The dice queue is shared and counted by tests and same-day draws — a
    // mindless mint must not consume from it. An unconsumed pushed roll is
    // how we can tell: getRandom would have taken it.
    pushRoll(7)
    expect(rollPaths('Golem')).toEqual({})
    expect(rollPaths('Mage')).not.toEqual({}) // the pushed roll is consumed HERE, not above
  })
})

describe('planCraftUnit walks the gates in order (C-6)', () => {
  test('unknown row', () => {
    expect(planCraftUnit(campaignWith(), 1, 'crafted_dragon').error).toMatch(/no such work/)
  })

  test('level gate first', () => {
    const c = campaignWith({
      research: {
        ...freshResearch(),
        schools: { ...freshResearch().schools, construction: { level: GOLEM.forge.level - 1, points: 0 } },
      },
    })
    expect(planCraftUnit(c, 1, 'crafted_golem').error).toMatch(/Construction 3/)
  })

  test('mithril gate second', () => {
    const c = campaignWith({ resources: { mithril: GOLEM.forge.mithril - 1 } })
    expect(planCraftUnit(c, 1, 'crafted_golem').error).toMatch(/mithril/)
  })

  test('then the smith: existence, calling, paths, the stamp', () => {
    expect(planCraftUnit(campaignWith(), 99, 'crafted_golem').error).toMatch(/no such character/)
    const priest = campaignWith({ characters: [smithFor(GOLEM, { type: 'Priest' })] })
    expect(planCraftUnit(priest, 1, 'crafted_golem').error).toMatch(/no smith/)
    const wrongPaths = campaignWith({ characters: [smithFor(GOLEM, { paths: { fire: 3 } })] })
    expect(planCraftUnit(wrongPaths, 1, 'crafted_golem').error).toMatch(/paths/)
    const spent = campaignWith({ characters: [smithFor(GOLEM, { forgedDay: 3 })] })
    expect(planCraftUnit(spent, 1, 'crafted_golem').error).toMatch(/already forged/)
  })

  test('the happy plan resolves the pieces', () => {
    const plan = planCraftUnit(campaignWith(), 1, 'crafted_golem')
    expect(plan.error).toBeUndefined()
    expect(plan.row.id).toBe('crafted_golem')
    expect(plan.cost).toBe(GOLEM.forge.mithril)
    expect(plan.character.id).toBe(1)
  })
})

describe('craftedUnitView — the foundry block (17-5)', () => {
  test('gates pre-answered, smiths listed, rows stable when locked', () => {
    const view = craftedUnitView(campaignWith())
    const row = view.rows.find((r) => r.id === 'crafted_golem')
    expect(row.unit).toBe('Golem')
    expect(row.levelMet).toBe(true)
    expect(row.mithrilMet).toBe(true)
    expect(row.pathsText).toMatch(/Earth 2/)
    expect(row.smiths).toEqual([{ id: 1, name: 'Aldric', forgedToday: false }])

    const locked = craftedUnitView(campaignWith({ resources: { mithril: 0 } }))
    const lockedRow = locked.rows.find((r) => r.id === 'crafted_golem')
    expect(lockedRow.mithrilMet).toBe(false) // shown locked, never hidden
  })
})

describe('the golem draws no rations (C-4)', () => {
  const inCamp = {
    roster: { Soldier: 10 },
    characters: [
      { id: 1, type: 'Mage', alive: true },
      { id: 2, type: 'Golem', alive: true },
      { id: 3, type: 'Golem', alive: false }, // the fallen never ate anyway
    ],
  }

  test('eatingBodies drops the golem; allBodies keeps counting it', () => {
    expect(allBodies(inCamp).get('Golem')).toBe(1)
    expect(eatingBodies(inCamp).has('Golem')).toBe(false)
    // …and takes nothing else with it.
    expect(eatingBodies(inCamp).get('Soldier')).toBe(10)
    expect(eatingBodies(inCamp).get('Mage')).toBe(1)
  })
})

describe('POST /api/campaigns/:id/craft — the third twin', () => {
  // Open the foundry's gates by document surgery, the openTheForge
  // convention: Construction 3, an earth-2 smith, mithril enough.
  const openTheFoundry = async (id) => {
    const stored = await Campaign.findById(id)
    stored.research.schools.get('construction').level = GOLEM.forge.level
    stored.resources.mithril = GOLEM.forge.mithril + 5
    const smith = stored.characters.find((c) => c.type === 'Mage')
    smith.paths = new Map(Object.entries(GOLEM.forge.paths))
    await stored.save()
    return smith.id
  }

  test('the happy path: mithril debited, stamp set, a named golem joins the rolls', async () => {
    const { body: fresh } = await createCampaign()
    const before = fresh.characters.length
    const smithId = await openTheFoundry(fresh.id)

    const { body, status } = await auth(api.post(`/api/campaigns/${fresh.id}/craft`))
      .send({ characterId: smithId, unitId: 'crafted_golem' })
    expect(status).toBe(200)
    expect(body.resources.mithril).toBe(5)
    expect(body.characters.find((c) => c.id === smithId).forgedToday).toBe(true)

    expect(body.characters.length).toBe(before + 1)
    const golem = body.characters.at(-1)
    expect(golem.type).toBe('Golem')
    expect(GOLEM_NAMES).toContain(golem.name)
    expect(golem.alive).toBe(true)
    expect(golem.squadId).toBeNull() // loose in camp until posted
    // Mindless on the view (C-4): no hang-back field at all, paths null (not
    // "commands no path" — not a thing paths are said about), no spell slots.
    expect(golem.hangBack).toBeUndefined()
    expect(golem.paths).toBeNull()
    expect(golem.chosenSpells).toBeUndefined()
    // …but a full sheet and slots: it is a body that bears artifacts.
    expect(golem.sheet).not.toBeNull()
    expect(golem.slots?.length).toBeGreaterThan(0)

    expect(body.log.at(-1).entries.join(' ')).toMatch(/foundry/)
    const row = body.foundry.rows.find((r) => r.id === 'crafted_golem')
    expect(row.smiths).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: smithId, forgedToday: true })]),
    )
  })

  test('ONE stamp across all three twins: the crafting smith cannot then forge', async () => {
    const { body: fresh } = await createCampaign()
    const smithId = await openTheFoundry(fresh.id)
    await auth(api.post(`/api/campaigns/${fresh.id}/craft`))
      .send({ characterId: smithId, unitId: 'crafted_golem' })

    // Give him the emberedge paths too — the refusal must be the stamp's.
    const stored = await Campaign.findById(fresh.id)
    stored.characters.find((c) => c.id === smithId).paths.set('fire', 1)
    await stored.save()
    const { status, body } = await auth(api.post(`/api/campaigns/${fresh.id}/forge`))
      .send({ characterId: smithId, itemId: 'forged_emberedge' })
    expect(status).toBe(400)
    expect(body.error).toMatch(/already forged/)
  })

  test('prepare-only, like its twins', async () => {
    const { body: fresh } = await createCampaign()
    const smithId = await openTheFoundry(fresh.id)
    await Campaign.findByIdAndUpdate(fresh.id, { phase: 'raids' })
    const { status } = await auth(api.post(`/api/campaigns/${fresh.id}/craft`))
      .send({ characterId: smithId, unitId: 'crafted_golem' })
    expect(status).toBe(409)
  })

  test('a golem takes a posting but no orders: attach works, hang-back refuses', async () => {
    const { body: fresh } = await createCampaign()
    const smithId = await openTheFoundry(fresh.id)
    const { body } = await auth(api.post(`/api/campaigns/${fresh.id}/craft`))
      .send({ characterId: smithId, unitId: 'crafted_golem' })
    const golem = body.characters.at(-1)
    const squadId = body.squads[0].id

    const attach = await auth(
      api.post(`/api/campaigns/${fresh.id}/characters/${golem.id}/attach`),
    ).send({ squadId })
    expect(attach.status).toBe(200)
    expect(attach.body.characters.find((c) => c.id === golem.id).squadId).toBe(squadId)

    const order = await auth(
      api.post(`/api/campaigns/${fresh.id}/characters/${golem.id}/hang-back`),
    ).send({ hangBack: true })
    expect(order.status).toBe(400)
    expect(order.body.error).toMatch(/intent, not orders/)
  })

  test('the food readout ignores the new body: stone draws no rations', async () => {
    const { body: fresh } = await createCampaign()
    const smithId = await openTheFoundry(fresh.id)
    const { body: before } = await auth(api.get(`/api/campaigns/${fresh.id}`))
    const { body: after } = await auth(api.post(`/api/campaigns/${fresh.id}/craft`))
      .send({ characterId: smithId, unitId: 'crafted_golem' })
    expect(after.resources.foodNeedPerTurn).toBe(before.resources.foodNeedPerTurn)
  })
})
