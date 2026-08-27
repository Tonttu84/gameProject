import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import supertest from 'supertest'
import { startTestDb, stopTestDb, clearDb } from './helpers/db.js'
import { createUserAndToken } from './helpers/auth.js'
import { catalogFixture } from './fixtures/catalog.js'
import { clearSpellCatalogCache } from '../utils/spellCatalog.js'
import { clearRolls } from '../utils/dice.js'
import {
  CONSTRUCTION_CATALOG,
  FORTIFICATION_PRESETS,
  SPELL_PATHS,
  STARTING_MITHRIL,
} from '../utils/campaignConfig.js'
import {
  constructionRows,
  constructionSidesFor,
  constructionView,
  planConstruction,
} from '../services/constructions.js'
import { walledSides, fortifiedSidesFor } from '../services/fortification.js'
import { freshResearch } from '../services/magic.js'
import { forgeLedgerRows } from '../services/balanceSheet.js'

// Constructions — Construction slice C2 (docs/CAMPAIGN_PLAN.md "THE
// CONSTRUCTION INTERVIEW", C-3). The pure half mirrors forge.test.js's shape:
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

const SMOKEHOUSE = CONSTRUCTION_CATALOG.find((r) => r.id === 'works_smokehouse')
const BASTIONS = CONSTRUCTION_CATALOG.find((r) => r.id === 'works_flanking_bastions')
const mage = (over = {}) => ({
  id: 1, name: 'Aldric', type: 'Mage', alive: true, paths: { nature: 1 }, ...over,
})
const campaignWith = (over = {}) => ({
  day: 3,
  characters: [mage()],
  constructions: [],
  squads: [],
  resources: { mithril: 10 },
  research: {
    ...freshResearch(),
    schools: { ...freshResearch().schools, construction: { level: 1, points: 0 } },
  },
  ...over,
})

describe('the catalog holds the C-3 line', () => {
  test('every row carries all three gates (C-6), in the same forge-block shape the items use', () => {
    for (const row of constructionRows()) {
      expect(row.forge.level).toBeGreaterThan(0)
      expect(Object.keys(row.forge.paths).length).toBeGreaterThan(0)
      expect(row.forge.mithril).toBeGreaterThan(0)
      for (const path of Object.keys(row.forge.paths)) expect(SPELL_PATHS).toContain(path)
    }
    expect(constructionRows().length).toBeGreaterThanOrEqual(3)
  })

  test('effects use ONLY the existing campaign-modifier channel, permanent and never raidable', () => {
    // C-3: a construction wanting a genuinely new capability is content
    // blocked on its own engine slice. This sweep is the fence: a new effect
    // type here must first argue its way past it.
    for (const row of constructionRows()) {
      for (const effect of row.effects ?? []) {
        expect(effect.type).toBe('forage_modifier')
        expect(effect.raidable).toBe(false)
        expect(effect.turnsLeft).toBeUndefined()
        // The modifier id is the row id, so re-granting can never collide
        // with a fate's modifier or another row's.
        expect(effect.id).toBe(row.id)
      }
    }
  })

  test('sides use the exact FORTIFICATION_PRESETS entry shape, and never duplicate a preset side', () => {
    const presetKeys = new Set(
      Object.values(FORTIFICATION_PRESETS).flat().map((s) => `${s.q},${s.r},${s.dir}`),
    )
    for (const row of constructionRows()) {
      for (const side of row.sides ?? []) {
        expect(side.q).toEqual(expect.any(Number))
        expect(side.r).toEqual(expect.any(Number))
        expect(['E', 'W', 'NE', 'NW', 'SE', 'SW']).toContain(side.dir)
        expect(side.durability).toBeGreaterThan(0)
        expect(presetKeys.has(`${side.q},${side.r},${side.dir}`)).toBe(false)
      }
    }
  })

  test('every row does SOMETHING, through at least one of the two channels', () => {
    for (const row of constructionRows())
      expect((row.effects?.length ?? 0) + (row.sides?.length ?? 0)).toBeGreaterThan(0)
  })

  test('the ladder is a ladder: some row needs more than Construction 1', () => {
    expect(constructionRows().some((row) => row.forge.level > 1)).toBe(true)
  })

  test('no forgeable row escapes the balance sheet ledger', () => {
    const ledger = new Set(forgeLedgerRows().map((row) => row.id))
    for (const row of constructionRows()) expect(ledger.has(row.id)).toBe(true)
  })
})

describe('planConstruction walks the gates in planForge’s order', () => {
  test('row gates first: existence, level, already-built, mithril', () => {
    expect(planConstruction(campaignWith(), 1, 'no_such_works').error).toMatch(/no such working/)

    const low = campaignWith({ research: freshResearch() }) // construction 0
    expect(planConstruction(low, 1, 'works_smokehouse').error).toMatch(/Construction 1/)

    const standing = campaignWith({ constructions: ['works_smokehouse'] })
    expect(planConstruction(standing, 1, 'works_smokehouse').error).toMatch(/already stand/)

    const poor = campaignWith({ resources: { mithril: 2 } })
    expect(planConstruction(poor, 1, 'works_smokehouse').error).toMatch(/mithril/)
  })

  test('then the smith, through the same C-1 eligibility forging uses', () => {
    const c = campaignWith()
    expect(planConstruction(c, 99, 'works_smokehouse').error).toMatch(/no such character/)

    const priest = campaignWith({
      characters: [{ id: 1, name: 'Odo', type: 'Priest', alive: true, paths: { nature: 2 } }],
    })
    expect(planConstruction(priest, 1, 'works_smokehouse').error).toMatch(/no smith/)

    const wrongPaths = campaignWith({ characters: [mage({ paths: { water: 2 } })] })
    expect(planConstruction(wrongPaths, 1, 'works_smokehouse').error).toMatch(/paths/)

    const spent = campaignWith({ characters: [mage({ forgedDay: 3 })] })
    expect(planConstruction(spent, 1, 'works_smokehouse').error).toMatch(/already forged/)
    // …and yesterday's stamp builds again — one shared stamp, one day.
    const yesterday = campaignWith({ characters: [mage({ forgedDay: 2 })] })
    expect(planConstruction(yesterday, 1, 'works_smokehouse').error).toBeUndefined()
  })

  test('a valid plan resolves the builder, the row and the price', () => {
    const plan = planConstruction(campaignWith(), 1, 'works_smokehouse')
    expect(plan).toMatchObject({ cost: SMOKEHOUSE.forge.mithril })
    expect(plan.row.id).toBe('works_smokehouse')
    expect(plan.character.name).toBe('Aldric')
  })
})

describe('the battlefield half derives beside the fort’s own (C-3)', () => {
  test('constructionSidesFor: nothing standing, nothing walled; bastions standing, their sides', () => {
    expect(constructionSidesFor(campaignWith())).toEqual([])
    const c = campaignWith({ constructions: ['works_flanking_bastions'] })
    expect(constructionSidesFor(c)).toHaveLength(BASTIONS.sides.length)
    expect(constructionSidesFor(c)[0]).toEqual({ q: 0, r: 7, dir: 'SE', durability: 130 })
    // A campaign-side row contributes no walls.
    expect(constructionSidesFor(campaignWith({ constructions: ['works_smokehouse'] }))).toEqual([])
  })

  test('walledSides is the one composition site: fort presets plus standing works', () => {
    const c = campaignWith({ fortificationLevel: 1, constructions: ['works_flanking_bastions'] })
    const sides = walledSides('sample_battle', c)
    expect(sides).toEqual([
      ...fortifiedSidesFor('sample_battle', 1),
      ...BASTIONS.sides.map(({ q, r, dir, durability }) => ({ q, r, dir, durability })),
    ])
    // Degrades to just the works on a skeleton with no fort level at all.
    expect(walledSides('sample_battle', campaignWith())).toEqual([])
  })
})

describe('the view (both this block and the forge’s render one ladder)', () => {
  test('rows carry the gates resolved, the effects phrased, and the standing flag', () => {
    const view = constructionView(campaignWith())
    const smoke = view.rows.find((r) => r.id === 'works_smokehouse')
    expect(smoke).toMatchObject({
      levelMet: true, mithrilMet: true, built: false,
      mithril: SMOKEHOUSE.forge.mithril, pathsText: 'Nature 1',
    })
    expect(smoke.effects.join(' ')).toMatch(/foraging/)
    expect(smoke.smiths).toEqual([{ id: 1, name: 'Aldric', forgedToday: false }])

    // Locked rows are shown locked rather than hidden — the ladder reads.
    const bastions = view.rows.find((r) => r.id === 'works_flanking_bastions')
    expect(bastions.levelMet).toBe(false)
    expect(bastions.effects.join(' ')).toMatch(/Walls 8 hexsides/)

    const built = constructionView(campaignWith({ constructions: ['works_smokehouse'] }))
    expect(built.rows.find((r) => r.id === 'works_smokehouse').built).toBe(true)
  })
})

describe('POST /api/campaigns/:id/construct — the forge route’s twin (C-3/C-6)', () => {
  // Open the gates a fresh campaign has shut — forge.test.js's convention.
  const openTheWorks = async (id, { level = 1, paths = [['nature', 1]] } = {}) => {
    const stored = await Campaign.findById(id)
    stored.research.schools.get('construction').level = level
    const smith = stored.characters.find((c) => c.type === 'Mage')
    smith.paths = new Map(paths)
    await stored.save()
    return smith.id
  }

  test('the happy path: mithril debited, stamp set, the works stand, the modifier lands, log written', async () => {
    const { body: fresh } = await createCampaign()
    const smithId = await openTheWorks(fresh.id)

    const { body, status } = await auth(api.post(`/api/campaigns/${fresh.id}/construct`))
      .send({ characterId: smithId, constructionId: 'works_smokehouse' })
    expect(status).toBe(200)
    expect(body.resources.mithril).toBe(STARTING_MITHRIL - SMOKEHOUSE.forge.mithril)
    expect(body.characters.find((c) => c.id === smithId).forgedToday).toBe(true)
    expect(body.constructions.rows.find((r) => r.id === 'works_smokehouse').built).toBe(true)
    // The campaign-side half went through the fates' own channel: the standing
    // pressure card is there, permanent, phrased by the same describeEffect.
    const card = body.forage.modifiers.find((m) => m.id === 'works_smokehouse')
    expect(card).toBeTruthy()
    expect(card.turnsLeft).toBeNull()
    expect(body.log.at(-1).entries.join(' ')).toMatch(/now stands/)
  })

  test('a construction stands once: the second build refuses', async () => {
    const { body: fresh } = await createCampaign()
    const smithId = await openTheWorks(fresh.id)
    await auth(api.post(`/api/campaigns/${fresh.id}/construct`))
      .send({ characterId: smithId, constructionId: 'works_smokehouse' })
    // Clear the stamp so the refusal that fires is the built gate's, not the
    // stamp's.
    const stored = await Campaign.findById(fresh.id)
    stored.characters.find((c) => c.id === smithId).forgedDay = null
    await stored.save()
    const { status, body } = await auth(api.post(`/api/campaigns/${fresh.id}/construct`))
      .send({ characterId: smithId, constructionId: 'works_smokehouse' })
    expect(status).toBe(400)
    expect(body.error).toMatch(/already stand/)
  })

  test('ONE stamp across the forge and the works: a mage who built cannot also forge today', async () => {
    const { body: fresh } = await createCampaign()
    const smithId = await openTheWorks(fresh.id, { paths: [['fire', 1]] })
    await auth(api.post(`/api/campaigns/${fresh.id}/construct`))
      .send({ characterId: smithId, constructionId: 'works_warding_beacons' })
    const { status, body } = await auth(api.post(`/api/campaigns/${fresh.id}/forge`))
      .send({ characterId: smithId, itemId: 'forged_emberedge' })
    expect(status).toBe(400)
    expect(body.error).toMatch(/already forged/)
  })

  test('prepare-only, like the forge beside it', async () => {
    const { body: fresh } = await createCampaign()
    const smithId = await openTheWorks(fresh.id)
    await Campaign.findByIdAndUpdate(fresh.id, { phase: 'raids' })
    const { status } = await auth(api.post(`/api/campaigns/${fresh.id}/construct`))
      .send({ characterId: smithId, constructionId: 'works_smokehouse' })
    expect(status).toBe(409)
  })

  test('a battlefield row’s walls reach the fortification view the placement grid draws', async () => {
    const { body: fresh } = await createCampaign()
    const smithId = await openTheWorks(fresh.id, { level: 2, paths: [['earth', 2]] })
    const { body, status } = await auth(api.post(`/api/campaigns/${fresh.id}/construct`))
      .send({ characterId: smithId, constructionId: 'works_flanking_bastions' })
    expect(status).toBe(200)
    expect(body.fortification.sides).toEqual(
      expect.arrayContaining([{ q: 0, r: 7, dir: 'SE', durability: 130 }]),
    )
  })
})
