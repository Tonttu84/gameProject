import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import supertest from 'supertest'
import { startTestDb, stopTestDb, clearDb } from './helpers/db.js'
import { createUserAndToken } from './helpers/auth.js'
import { battleResultFixture } from './fixtures/battleResult.js'
import { catalogFixture } from './fixtures/catalog.js'
import { spellsFixture } from './fixtures/spells.js'
import { setSpellCatalog, clearSpellCatalogCache } from '../utils/spellCatalog.js'
import { clearRolls } from '../utils/dice.js'
import {
  castableSpellsFor, chosenSpellsView, planChosenSpells, spellsForSchool,
} from '../services/magic.js'
import { characterEntryFor } from '../services/characters.js'
import { MAX_CHOSEN_SPELLS } from '../utils/campaignConfig.js'

// CHOSEN SPELLS (docs/CAMPAIGN_PLAN.md "SLICE 4 — SCRIPTING"): what a caster
// reaches for first. The pure half — what he may be offered and what the server
// will accept — and the wired half, the route and what crosses to the engine.
//
// The shape being pinned throughout is S4-1's: this is a PREFERENCE, never a
// repertoire. Nothing here should ever be able to make a caster mute.

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

// A campaign shaped only as far as these functions read it.
const campaignAt = (schools) => ({
  research: {
    schools: Object.fromEntries(
      Object.entries(schools).map(([s, level]) => [s, { level, points: 0 }]),
    ),
  },
})

const mage = (paths, script = []) => ({
  id: 1, name: 'Aldric', type: 'Mage', alive: true, paths, script,
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

describe('what a caster may be offered (S4-3)', () => {
  test('both gates are enforced — his paths AND the army\'s research', () => {
    const research = campaignAt({ evocation: 1, conjuration: 0 })

    // Fire 1 with evocation 1 open: Ember, and nothing else.
    expect(castableSpellsFor(mage({ fire: 1 }), research, spellsFixture)
      .map((r) => r.spell)).toEqual(['fireball'])

    // The same man with no research open can cast nothing at all.
    expect(castableSpellsFor(mage({ fire: 1 }), campaignAt({ evocation: 0 }), spellsFixture))
      .toEqual([])

    // A path he does not command is not offered however deep the research runs.
    expect(castableSpellsFor(mage({ fire: 1 }), campaignAt({ evocation: 3, conjuration: 3 }), spellsFixture)
      .map((r) => r.spell)).toEqual(['fireball'])
  })

  test('a row is one SPELL, wearing the strongest FORM he qualifies for (S4-2)', () => {
    const deep = campaignAt({ evocation: 3 })

    // Fire 1 sees the minor form's name…
    expect(castableSpellsFor(mage({ fire: 1 }), deep, spellsFixture))
      .toEqual([expect.objectContaining({ spell: 'fireball', label: 'Ember' })])

    // …and Fire 3 sees the major's, under the SAME id. A choice made early
    // never needs re-making: it grows with the man who made it.
    expect(castableSpellsFor(mage({ fire: 3 }), deep, spellsFixture))
      .toEqual([expect.objectContaining({ spell: 'fireball', label: 'Fireball' })])
  })

  test('a granted path needs no research — bless is on a Priest\'s sheet from day one', () => {
    // S3-2 kept Holy and Unholy off The Study because they are had rather than
    // earned (M-14); this is the screen that finally names them.
    const priest = { id: 2, name: 'Mara', type: 'Priest', alive: true, paths: { holy: 2 }, script: [] }
    expect(castableSpellsFor(priest, campaignAt({}), spellsFixture)
      .map((r) => r.spell)).toEqual(['bless'])
  })
})

describe('what the server will accept (S4-5)', () => {
  const research = campaignAt({ evocation: 1, conjuration: 1 })

  test('accepts a legal list and hands back exactly what to store', () => {
    expect(planChosenSpells(mage({ fire: 1 }), research, spellsFixture, ['fireball']))
      .toEqual({ script: ['fireball'] })
  })

  test('an empty list is legal — it is how a caster is handed back his own judgement', () => {
    expect(planChosenSpells(mage({ fire: 1 }), research, spellsFixture, []))
      .toEqual({ script: [] })
  })

  test('refuses more than the cap, repeats, and a spell he cannot cast', () => {
    const over = Array.from({ length: MAX_CHOSEN_SPELLS + 1 }, () => 'fireball')
    expect(planChosenSpells(mage({ fire: 1 }), research, spellsFixture, over).error).toBeTruthy()
    expect(planChosenSpells(mage({ fire: 1 }), research, spellsFixture, ['fireball', 'fireball']).error)
      .toBeTruthy()
    // No Death path, so raise_dead is not his to choose however open the school.
    expect(planChosenSpells(mage({ fire: 1 }), research, spellsFixture, ['raise_dead']).error)
      .toBeTruthy()
    expect(planChosenSpells(mage({ fire: 1 }), research, spellsFixture, 'fireball').error)
      .toBeTruthy()
  })
})

describe('what the sheet is sent (S4-7)', () => {
  test('the slots, the options and the cap, with every row phrased', () => {
    const view = chosenSpellsView(
      mage({ fire: 1 }, ['fireball']), campaignAt({ evocation: 1 }), spellsFixture,
    )
    expect(view.max).toBe(MAX_CHOSEN_SPELLS)
    expect(view.chosen).toEqual([
      {
        spell: 'fireball', label: 'Ember', description: 'A single bolt of fire at range.',
        // Every row says where it stands on the pool, so the sheet never has
        // to test for a missing field (slice A, E-2).
        battlefield: false, poolCost: 0,
      },
    ])
    // The picker shows everything he could reach for, taken slots included.
    expect(view.options.map((r) => r.spell)).toEqual(['fireball'])
  })

  test('campaignView carries it for every caster, empty on a fresh hire', async () => {
    const { body } = await createCampaign()
    expect(body.characters.length).toBeGreaterThan(0)
    for (const c of body.characters) {
      expect(c.chosenSpells).toBeTruthy()
      expect(c.chosenSpells.max).toBe(MAX_CHOSEN_SPELLS)
      // Nobody arrives scripted, which is what makes slice 4 additive: an empty
      // list is exactly the walk every battle before it fought.
      expect(c.chosenSpells.chosen).toEqual([])
    }
  })

  test('the section is omitted entirely for a body that will never cast', () => {
    // A swordsman gets no empty picker to puzzle over — the field's ABSENCE is
    // what tells the sheet not to draw the section at all.
    const soldier = { id: 3, name: 'Bran', type: 'Soldier', alive: true, paths: {}, script: [] }
    expect(chosenSpellsView(soldier, campaignAt({}), spellsFixture).options).toEqual([])
    expect(castableSpellsFor(soldier, campaignAt({ evocation: 9 }), spellsFixture)).toEqual([])
  })
})

// ── THE BATTLEFIELD ENCHANTMENTS (slice A, E-2/E-3/E-4) ──────────────────────
//
// A battlefield spell is scripted or never cast at all (E-3), and its price is
// the army's pool rather than the caster's own body (E-2). Both facts reach the
// sheet as a SENTENCE the server wrote (17-5) — the client composes nothing, so
// what is pinned here is the text itself.
//
// The second fact worth pinning is a refusal that deliberately is NOT one: two
// casters carrying the same enchantment is a wasted line, not an illegal one,
// so the view WARNS and planChosenSpells still takes the list. The engine's
// once-per-side rule (E-4) is what actually holds, and the second completion
// fizzles unpaid.
describe('the battlefield enchantments (E-2/E-3/E-4)', () => {
  const enchanted = campaignAt({ enchantment: 2 })
  const POOL_LINE = "Draws 2 from the army's pool — once per battle, and only when scripted."

  // Nature 2 reaches Soothing Winds and nothing else in the fixture, which
  // keeps every row assertion below a one-row assertion.
  const windsMage = (script = ['soothing_winds']) => mage({ nature: 2 }, script)
  const other = (over = {}) => ({
    id: 2, name: 'Bettina', type: 'Mage', alive: true, paths: { nature: 2 }, script: [], ...over,
  })
  const withCasters = (...characters) => ({ ...enchanted, characters })

  test('a battlefield row carries its flag, its price and the server\'s sentence', () => {
    expect(castableSpellsFor(windsMage(), enchanted, spellsFixture)).toEqual([
      expect.objectContaining({
        spell: 'soothing_winds',
        label: 'Soothing Winds',
        battlefield: true,
        poolCost: 2,
        poolLine: POOL_LINE,
      }),
    ])
  })

  test('an ordinary row answers the same fields, and carries no pool sentence', () => {
    const [ember] = castableSpellsFor(mage({ fire: 1 }), campaignAt({ evocation: 1 }), spellsFixture)
    expect(ember).toMatchObject({ battlefield: false, poolCost: 0 })
    expect(ember.poolLine).toBeUndefined()
  })

  test('the sentence quotes the ROW\'s own price, never a fixed number', () => {
    // Leaden Air draws 3 where Soothing Winds draws 2 (E-6), so a retuned
    // price moves the sentence with it rather than drifting from it.
    const necromancer = mage({ death: 2 })
    const rows = castableSpellsFor(necromancer, campaignAt({ enchantment: 2 }), spellsFixture)
    expect(rows.find((r) => r.spell === 'leaden_air').poolLine)
      .toBe("Draws 3 from the army's pool — once per battle, and only when scripted.")
  })

  test('The Study carries the same fields, phrased the same way (S3-1)', () => {
    const [winds, leaden] = spellsForSchool(spellsFixture, 'enchantment', 2)
    expect(winds).toMatchObject({ battlefield: true, poolCost: 2, poolLine: POOL_LINE })
    expect(leaden).toMatchObject({ battlefield: true, poolCost: 3 })
    // ...and an ordinary school row still says nothing about a pool it never
    // touches.
    const [ember] = spellsForSchool(spellsFixture, 'evocation', 1)
    expect(ember).toMatchObject({ battlefield: false, poolCost: 0 })
    expect(ember.poolLine).toBeUndefined()
  })

  test('the picker\'s options carry it too — the price is read before it is chosen', () => {
    const view = chosenSpellsView(windsMage([]), enchanted, spellsFixture)
    expect(view.options).toEqual([expect.objectContaining({ poolLine: POOL_LINE })])
  })

  test('warns, naming him, when another living caster has the same one scripted', () => {
    const campaign = withCasters(windsMage(), other({ script: ['soothing_winds'] }))
    expect(chosenSpellsView(windsMage(), campaign, spellsFixture).chosen[0].warning)
      .toBe('Bettina has this scripted too — it can only take hold once per battle.')
  })

  test('names the first and counts the rest when several are carrying it', () => {
    const campaign = withCasters(
      windsMage(),
      other({ script: ['soothing_winds'] }),
      other({ id: 3, name: 'Cerys', script: ['soothing_winds'] }),
    )
    expect(chosenSpellsView(windsMage(), campaign, spellsFixture).chosen[0].warning)
      .toBe('Bettina and 1 other have this scripted too — it can only take hold once per battle.')
  })

  test('no warning when he is the only one carrying it', () => {
    const campaign = withCasters(windsMage(), other({ script: [] }))
    expect(chosenSpellsView(windsMage(), campaign, spellsFixture).chosen[0].warning)
      .toBeUndefined()
  })

  test('a DEAD caster\'s script warns nobody — a record casts nothing (5-9)', () => {
    const campaign = withCasters(windsMage(), other({ alive: false, script: ['soothing_winds'] }))
    expect(chosenSpellsView(windsMage(), campaign, spellsFixture).chosen[0].warning)
      .toBeUndefined()
  })

  test('an ORDINARY spell two casters both chose is not remarked on', () => {
    // Both of them casting Ember is the point — the clash only exists where the
    // effect is army-wide and takes hold once per side (E-4).
    const research = campaignAt({ evocation: 1 })
    const first = mage({ fire: 1 }, ['fireball'])
    const second = { ...other({ paths: { fire: 1 } }), script: ['fireball'] }
    const campaign = { ...research, characters: [first, second] }
    expect(chosenSpellsView(first, campaign, spellsFixture).chosen[0].warning).toBeUndefined()
  })

  test('the server ACCEPTS a battlefield spell he qualifies for, and refuses one he does not', () => {
    expect(planChosenSpells(windsMage([]), enchanted, spellsFixture, ['soothing_winds']))
      .toEqual({ script: ['soothing_winds'] })
    // Nature 2 is not Death 2: Leaden Air is not his to script, however open
    // the school stands.
    expect(planChosenSpells(windsMage([]), enchanted, spellsFixture, ['leaden_air']).error)
      .toBeTruthy()
  })

  test('a WARNED script is still accepted — the warning is not a refusal (E-2/E-3)', () => {
    const campaign = withCasters(windsMage([]), other({ script: ['soothing_winds'] }))
    expect(planChosenSpells(windsMage([]), campaign, spellsFixture, ['soothing_winds']))
      .toEqual({ script: ['soothing_winds'] })
  })
})

describe('the route (S4-4)', () => {
  const setScript = (id, characterId, script) =>
    auth(api.post(`/api/campaigns/${id}/characters/${characterId}/script`)).send({ script })

  // A Priest can cast bless with no research at all, which makes him the one
  // caster who can be scripted on turn 1 of a fresh campaign (S2-2).
  const aPriest = (body) => body.characters.find((c) => c.type === 'Priest')

  test('stores the list and hands back the campaign with it rendered', async () => {
    const { body } = await createCampaign()
    const priest = aPriest(body)
    const { body: after } = await setScript(body.id, priest.id, ['bless']).expect(200)
    expect(after.characters.find((c) => c.id === priest.id).chosenSpells.chosen)
      .toEqual([expect.objectContaining({ spell: 'bless', label: 'Blessing' })])
  })

  test('replaces rather than appends, so clearing is just a shorter list', async () => {
    const { body } = await createCampaign()
    const priest = aPriest(body)
    await setScript(body.id, priest.id, ['bless']).expect(200)
    const { body: after } = await setScript(body.id, priest.id, []).expect(200)
    expect(after.characters.find((c) => c.id === priest.id).chosenSpells.chosen).toEqual([])
  })

  test('is free in EVERY phase — it spends nothing and gates on nothing', async () => {
    const { body } = await createCampaign()
    const priest = aPriest(body)
    for (const phase of ['prepare', 'raids', 'recruit']) {
      await Campaign.findByIdAndUpdate(body.id, { phase })
      await setScript(body.id, priest.id, ['bless']).expect(200)
    }
  })

  test('is allowed while the caster is AWAY — the fiction is his judgement, not an order', async () => {
    const { body } = await createCampaign()
    const priest = aPriest(body)
    const stored = await Campaign.findById(body.id)
    // Post him to a charter and send that charter away on a mission.
    stored.characters.find((c) => c.id === priest.id).squadId = stored.squads[0].id
    stored.squads[0].mission = { untilDay: stored.day + 3, eventId: 'whatever' }
    await stored.save()

    const { body: after } = await setScript(body.id, priest.id, ['bless']).expect(200)
    const back = after.characters.find((c) => c.id === priest.id)
    expect(back.awayBlocker).toBeTruthy()          // he really is out there…
    expect(back.chosenSpells.chosen).toHaveLength(1)   // …and his preference still took
  })

  test('refuses a spell he cannot cast, and an unknown character', async () => {
    const { body } = await createCampaign()
    const priest = aPriest(body)
    await setScript(body.id, priest.id, ['raise_dead']).expect(400)
    await setScript(body.id, 9999, ['bless']).expect(400)
  })
})

describe('what crosses to the engine', () => {
  const battleInput = () => engine.runBattle.mock.calls.at(-1)[0]
  const setScriptFor = (id, characterId, script) =>
    auth(api.post(`/api/campaigns/${id}/characters/${characterId}/script`)).send({ script })

  // The pitched battle is the boss fight and commits the whole army, so the
  // army is shrunk to one charter's worth and exactly that is fielded — the
  // same shape research.test.js fields a caster with.
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

  test('the list rides the placement entry, off the RECORD', () => {
    const entry = characterEntryFor(
      mage({ fire: 1 }, ['fireball']), { q: 1, r: 2 },
    )
    expect(entry.script).toEqual(['fireball'])
  })

  test('an empty list sends no field at all — an absent one IS the default walk', () => {
    const entry = characterEntryFor(mage({ fire: 1 }, []), { q: 1, r: 2 })
    expect(entry).not.toHaveProperty('script')
  })

  test('a script in a placement REQUEST is stripped, never trusted', async () => {
    // The chosen spells are the character's own record, set from his sheet and
    // nowhere else — so a list arriving in a deploy request is forged by
    // definition, exactly as a forged `paths` is.
    const { body } = await createCampaign()
    const res = await fieldPitchedBattle(body.id, {}, { script: ['fireball'] })
    expect(res.status).toBeLessThan(400)
    const placement = battleInput().player_placement
    expect(placement.length).toBeGreaterThan(0)
    for (const entry of placement) expect(entry).not.toHaveProperty('script')
  })

  test('a caster\'s own list DOES reach the engine through his entry', async () => {
    const { body } = await createCampaign()
    const priest = body.characters.find((c) => c.type === 'Priest')
    await setScriptFor(body.id, priest.id, ['bless'])

    // Post him to the charter that will be fielded, so he rides along (5-8).
    const stored = await Campaign.findById(body.id)
    stored.characters.find((c) => c.id === priest.id).squadId = stored.squads[0].id
    await stored.save()

    const res = await fieldPitchedBattle(body.id)
    expect(res.status).toBeLessThan(400)
    const entry = battleInput().player_placement.find((e) => e.character_id === priest.id)
    expect(entry).toBeTruthy()
    expect(entry.script).toEqual(['bless'])
  })
})
