import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import supertest from 'supertest'
import { startTestDb, stopTestDb, clearDb } from './helpers/db.js'
import { createUserAndToken } from './helpers/auth.js'
import { catalogFixture } from './fixtures/catalog.js'
import { spellsFixture } from './fixtures/spells.js'
import { setSpellCatalog, clearSpellCatalogCache } from '../utils/spellCatalog.js'
import { clearRolls } from '../utils/dice.js'
import { enginePaths, planShortlist, shortlistView, withEnemyScripts } from '../services/magic.js'
import { characterEntryFor } from '../services/characters.js'
import {
  ENEMY_CHANNELS, ENEMY_SCHOOLS, ENEMY_SCRIPT_STORE, MAX_SHORTLIST_SPELLS,
} from '../utils/campaignConfig.js'

// THE SHORTLIST (docs/CAMPAIGN_PLAN.md "THE CASTING AI", A-7): the fence a
// caster improvises inside once his script's opening sequence (A-6) is spent.
// The pure half — what he may be fenced to and what the server will accept —
// and the wired half, the route, the view and what crosses to the engine.
//
// Two rules carry the whole slice and are pinned hardest below:
//
//   • AN EMPTY LIST IS THE WIDEST SETTING, not the narrowest. It means the
//     whole castable roster, so a fresh hire behaves exactly as every caster
//     did before this slice and nothing here can make anybody mute.
//   • A BATTLEFIELD SPELL IS NEVER IN IT (E-3). A global is cast because it was
//     scripted, never because a lottery named it — so the options do not offer
//     one and the plan will not take one.

vi.mock('../services/engine.js', () => ({
  runBattle: vi.fn(),
  getInfo: vi.fn(),
  dumpUnits: vi.fn(),
  EngineProcessError: class EngineProcessError extends Error { name = 'EngineProcessError' },
  EngineOutputError: class EngineOutputError extends Error { name = 'EngineOutputError' },
}))

const engine = await import('../services/engine.js')
const { default: app } = await import('../app.js')
const { default: UnitType } = await import('../models/unitType.js')

const api = supertest(app)

const infoFixture = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  units: [],
  terrain: [],
}

// A campaign shaped only as far as these functions read it — chosenSpells'
// own fixture, because the two lists are judged against the same two gates.
const campaignAt = (schools) => ({
  research: {
    schools: Object.fromEntries(
      Object.entries(schools).map(([s, level]) => [s, { level, points: 0 }]),
    ),
  },
})

const mage = (paths, shortlist = []) => ({
  id: 1, name: 'Aldric', type: 'Mage', alive: true, paths, script: [], shortlist,
})

let token

beforeAll(startTestDb)
afterAll(stopTestDb)
beforeEach(async () => {
  await clearDb()
  vi.clearAllMocks()
  engine.getInfo.mockResolvedValue(infoFixture)
  await UnitType.insertMany(catalogFixture.units)
  setSpellCatalog(spellsFixture)
  ;({ token } = await createUserAndToken(api))
})
afterEach(() => { clearRolls(); clearSpellCatalogCache() })

const auth = (req) => req.set('Authorization', `Bearer ${token}`)
const createCampaign = () => auth(api.post('/api/campaigns')).send({})

describe('what the sheet is sent (A-7)', () => {
  const research = campaignAt({ evocation: 1, conjuration: 1 })

  test('the cap, the ticked rows and everything tickable, each phrased', () => {
    const view = shortlistView(mage({ fire: 1 }, ['fireball']), research, spellsFixture)
    expect(view.max).toBe(MAX_SHORTLIST_SPELLS)
    expect(view.chosen).toEqual([
      expect.objectContaining({ spell: 'fireball', label: 'Ember' }),
    ])
    expect(view.options.map((r) => r.spell)).toEqual(['fireball'])
    // The sentence about what an empty list DOES is the server's, because it is
    // the one thing about this control a player cannot guess (17-5).
    expect(view.line).toMatch(/anything he can cast/i)
  })

  test('rows wear the strongest form he qualifies for, like every other spell row', () => {
    const deep = campaignAt({ evocation: 3 })
    expect(shortlistView(mage({ fire: 3 }), deep, spellsFixture).options)
      .toEqual([expect.objectContaining({ spell: 'fireball', label: 'Fireball' })])
  })

  test('the options EXCLUDE the battlefield globals (E-3)', () => {
    // Nature 2 can cast Soothing Winds — it is on his chosen-spells picker —
    // but it is a global, so it is cast only when it is scripted and can never
    // come out of the lottery. Offering it would be a click the server refuses.
    const nature = mage({ nature: 2 })
    const enchanted = campaignAt({ enchantment: 2 })
    expect(shortlistView(nature, enchanted, spellsFixture).options).toEqual([])
  })

  test('a chosen id that is no longer offerable is dropped, never drawn label-less', () => {
    const stale = mage({ fire: 1 }, ['raise_dead'])
    expect(shortlistView(stale, campaignAt({ evocation: 1 }), spellsFixture).chosen).toEqual([])
  })

  test('an empty list is the whole roster, and says nothing is wrong', () => {
    const view = shortlistView(mage({ fire: 1 }), campaignAt({ evocation: 1 }), spellsFixture)
    expect(view.chosen).toEqual([])
    expect(view.options).toHaveLength(1)
  })

  test('campaignView carries it for every caster, empty on a fresh hire', async () => {
    const { body } = await createCampaign()
    const casters = body.characters.filter((c) => c.chosenSpells)
    expect(casters.length).toBeGreaterThan(0)
    for (const c of casters) {
      expect(c.shortlist).toBeTruthy()
      expect(c.shortlist.max).toBe(MAX_SHORTLIST_SPELLS)
      // Nobody arrives fenced, which is what makes this slice additive: an
      // empty list is the whole castable roster (A-7).
      expect(c.shortlist.chosen).toEqual([])
    }
    // …and a body that will never cast gets no checklist to puzzle over, the
    // chosenSpells contract: absence is what tells the sheet not to draw it.
    for (const c of body.characters.filter((c) => !c.chosenSpells))
      expect(c.shortlist).toBeUndefined()
  })
})

describe('what the server will accept', () => {
  const research = campaignAt({ evocation: 1, conjuration: 1 })

  test('accepts a legal list and hands back exactly what to store', () => {
    expect(planShortlist(mage({ fire: 1 }), research, spellsFixture, ['fireball']))
      .toEqual({ shortlist: ['fireball'] })
  })

  test('an empty list is legal — it is how a caster is handed back the whole roster', () => {
    expect(planShortlist(mage({ fire: 1 }), research, spellsFixture, []))
      .toEqual({ shortlist: [] })
  })

  test('refuses more than the cap, repeats, a non-array, and a spell he cannot cast', () => {
    const over = Array.from({ length: MAX_SHORTLIST_SPELLS + 1 }, (_, i) => `spell_${i}`)
    expect(planShortlist(mage({ fire: 1 }), research, spellsFixture, over).error).toBeTruthy()
    expect(planShortlist(mage({ fire: 1 }), research, spellsFixture, ['fireball', 'fireball']).error)
      .toBeTruthy()
    expect(planShortlist(mage({ fire: 1 }), research, spellsFixture, 'fireball').error)
      .toBeTruthy()
    expect(planShortlist(mage({ fire: 1 }), research, spellsFixture, ['raise_dead']).error)
      .toBeTruthy()
  })

  test('refuses a BATTLEFIELD spell he can otherwise cast, and says why (E-3)', () => {
    // The refusal a shortlist has that a script does not, and the two mistakes
    // are phrased apart: "cast only when it is scripted" is a different problem
    // from "cannot cast".
    const nature = mage({ nature: 2 })
    const enchanted = campaignAt({ enchantment: 2 })
    expect(planShortlist(nature, enchanted, spellsFixture, ['soothing_winds']).error)
      .toMatch(/scripted/)
    expect(planShortlist(nature, enchanted, spellsFixture, ['leaden_air']).error)
      .toMatch(/cannot cast/)
  })
})

describe('the route', () => {
  const setShortlist = (id, characterId, spells) =>
    auth(api.post(`/api/campaigns/${id}/characters/${characterId}/shortlist`)).send({ spells })

  // A Priest casts bless with no research at all, which makes him the one
  // caster who can be fenced on turn 1 of a fresh campaign (S2-2).
  const aPriest = (body) => body.characters.find((c) => c.type === 'Priest')

  test('stores the list and hands back the campaign with it rendered', async () => {
    const { body } = await createCampaign()
    const priest = aPriest(body)
    const { body: after } = await setShortlist(body.id, priest.id, ['bless']).expect(200)
    expect(after.characters.find((c) => c.id === priest.id).shortlist.chosen)
      .toEqual([expect.objectContaining({ spell: 'bless', label: 'Blessing' })])
  })

  test('replaces rather than appends, so clearing is just a shorter list', async () => {
    const { body } = await createCampaign()
    const priest = aPriest(body)
    await setShortlist(body.id, priest.id, ['bless']).expect(200)
    const { body: after } = await setShortlist(body.id, priest.id, []).expect(200)
    expect(after.characters.find((c) => c.id === priest.id).shortlist.chosen).toEqual([])
  })

  test('is free in EVERY phase — it spends nothing and gates on nothing', async () => {
    const { default: Campaign } = await import('../models/campaign.js')
    const { body } = await createCampaign()
    const priest = aPriest(body)
    for (const phase of ['prepare', 'raids', 'recruit']) {
      await Campaign.findByIdAndUpdate(body.id, { phase })
      await setShortlist(body.id, priest.id, ['bless']).expect(200)
    }
  })

  test('refuses a spell he cannot cast, and an unknown character', async () => {
    const { body } = await createCampaign()
    const priest = aPriest(body)
    await setShortlist(body.id, priest.id, ['raise_dead']).expect(400)
    await setShortlist(body.id, 9999, ['bless']).expect(400)
  })
})

describe('what crosses to the engine', () => {
  test('the list rides the placement entry, off the RECORD', () => {
    expect(characterEntryFor(mage({ fire: 1 }, ['fireball']), { q: 1, r: 2 }).shortlist)
      .toEqual(['fireball'])
  })

  test('an empty list sends no field at all — an absent one IS the whole roster', () => {
    expect(characterEntryFor(mage({ fire: 1 }, []), { q: 1, r: 2 }))
      .not.toHaveProperty('shortlist')
  })

  test('a body that cannot cast sends none however one got onto his record', () => {
    const soldier = { ...mage({}, ['fireball']), type: 'Soldier' }
    expect(characterEntryFor(soldier, { q: 0, r: 0 })).not.toHaveProperty('shortlist')
  })
})

// ── The host's own shortlists (E-7 + A-7) ────────────────────────────────────
//
// An authored store row MAY carry one, and it reaches the entry under the same
// two rules the row's script does: filtered against the encounter's sealed
// numbers, and omitted rather than sent empty.
describe('the enemy store', () => {
  const caster = (type, paths) => ({ unit_type: type, q: 0, r: 22, paths: enginePaths(paths) })
  const sealed = (schools = {}, channels = ENEMY_CHANNELS) => ({
    schools: { ...ENEMY_SCHOOLS, ...schools },
    channels,
  })

  test('every authored shortlist is a real, distinct, capped list', () => {
    for (const row of ENEMY_SCRIPT_STORE) {
      if (!row.shortlist) continue
      expect(row.shortlist.length, `${row.id} shortlists nothing`).toBeGreaterThan(0)
      expect(row.shortlist.length, `${row.id} exceeds MAX_SHORTLIST_SPELLS`)
        .toBeLessThanOrEqual(MAX_SHORTLIST_SPELLS)
      expect(new Set(row.shortlist).size, `${row.id} names a spell twice`)
        .toBe(row.shortlist.length)
    }
    // The rows that have one are the battlefield-bearing ones: a caster who has
    // spent his script on a single enchantment is exactly the one whose rest of
    // the battle is worth aiming.
    expect(ENEMY_SCRIPT_STORE.some((row) => row.shortlist)).toBe(true)
  })

  test('a row\'s shortlist rides onto the entry beside its script', () => {
    const store = [{ id: 'raise_and_burn', spells: ['raise_dead'], shortlist: ['raise_dead'] }]
    const [entry] = withEnemyScripts(
      [caster('Necromancer', { death: 1 })], sealed(), spellsFixture, store,
    )
    expect(entry.script).toEqual(['raise_dead'])
    expect(entry.shortlist).toEqual(['raise_dead'])
  })

  test('an id he cannot cast under the sealed numbers is dropped from it', () => {
    // Unlike the script, a PARTIAL match is fine: a shortlist is a fence, and a
    // narrower fence is still a fence. He keeps the row and loses the line.
    const store = [{ id: 'row', spells: ['raise_dead'], shortlist: ['raise_dead', 'fireball'] }]
    const [entry] = withEnemyScripts(
      [caster('Necromancer', { death: 1 })], sealed(), spellsFixture, store,
    )
    expect(entry.script).toEqual(['raise_dead'])
    expect(entry.shortlist).toEqual(['raise_dead'])
  })

  test('filtered to nothing means NO KEY — absence is the signal on both lists', () => {
    const store = [{ id: 'row', spells: ['raise_dead'], shortlist: ['fireball'] }]
    const [entry] = withEnemyScripts(
      [caster('Necromancer', { death: 1 })], sealed(), spellsFixture, store,
    )
    expect(entry.script).toEqual(['raise_dead'])
    expect('shortlist' in entry).toBe(false)
  })

  test('a row without one sends none — the whole castable roster (A-7)', () => {
    const store = [{ id: 'row', spells: ['raise_dead'] }]
    const [entry] = withEnemyScripts(
      [caster('Necromancer', { death: 1 })], sealed(), spellsFixture, store,
    )
    expect('shortlist' in entry).toBe(false)
  })

  test('a caster who matches no row at all is sent neither list', () => {
    const store = [{ id: 'row', spells: ['raise_dead'], shortlist: ['raise_dead'] }]
    const [entry] = withEnemyScripts(
      [caster('Mage', { water: 1 })], sealed(), spellsFixture, store,
    )
    expect('script' in entry).toBe(false)
    expect('shortlist' in entry).toBe(false)
  })
})
