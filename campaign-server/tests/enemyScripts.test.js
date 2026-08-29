import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import supertest from 'supertest'
import { startTestDb, stopTestDb, clearDb } from './helpers/db.js'
import { createUserAndToken } from './helpers/auth.js'
import { battleResultFixture } from './fixtures/battleResult.js'
import { catalogFixture } from './fixtures/catalog.js'
import { spellsFixture } from './fixtures/spells.js'
import { setSpellCatalog, clearSpellCatalogCache } from '../utils/spellCatalog.js'
import { clearRolls, pushRoll } from '../utils/dice.js'
import { enginePaths, withEnemyScripts } from '../services/magic.js'
import {
  ENEMY_CHANNELS,
  ENEMY_SCHOOLS,
  ENEMY_SCRIPT_STORE,
  MAX_CHOSEN_SPELLS,
  RECON_LEVEL_THRESHOLDS,
} from '../utils/campaignConfig.js'

// THE ENEMY'S SCRIPTS (docs/CAMPAIGN_PLAN.md, E-7 / E-8): the host's half of
// slice 4's chosen spells. An authored, priority-ordered store; a caster takes
// the first row he qualifies for; and the encounter's sealed magic — its school
// levels AND its channel pool — is the only thing deciding which rows exist for
// him at all.
//
// Two properties carry the whole slice and are pinned hardest below: the walk is
// DETERMINISTIC (which is what lets the assignment be derived at composition
// rather than sealed onto the document), and a battlefield-bearing row goes out
// AT MOST ONCE per composition pass.
//
// The store's own numbers are placeholders and its rows are named here only
// where a rule needs a concrete case — a retune reorders the store and these
// keep testing the RULES, the convention magic.test.js already follows.

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
const { buildEnemyPlacement } = await import('../services/enemyPlacement.js')

const api = supertest(app)

const infoFixture = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  units: [],
  terrain: [],
}

// ── The pure half ───────────────────────────────────────────────────────────

// A placement entry as withCasterPaths leaves it: paths already on, in the wire
// form (every path the engine knows, zeros included).
const caster = (type, paths) => ({ unit_type: type, q: 0, r: 22, paths: enginePaths(paths) })

// The encounter's sealed block, ENEMY_SCHOOLS with whatever this case is about
// moved. Written against the constants rather than restating them, so a retune
// of the host's knowledge moves the fixture with it.
const sealed = (schools = {}, channels = ENEMY_CHANNELS) => ({
  schools: { ...ENEMY_SCHOOLS, ...schools },
  channels,
})

const scriptsIn = (placement) => placement.map((e) => e.script)

// The two rows the fixture roster can actually reach, named once. The fixture
// carries fireball / raise_dead / bless / soothing_winds / leaden_air, so store
// rows built on briar_snare, shock or hex_of_frailty are inert here — which is
// itself the right behaviour (an id the catalog does not carry is a row nobody
// qualifies for) and is asserted on its own below.
const LEADEN = ['leaden_air', 'raise_dead']
const GRAVE = ['raise_dead']

describe('the store itself (E-7)', () => {
  test('every row is a real, distinct, chooseable list', () => {
    expect(ENEMY_SCRIPT_STORE.length).toBeGreaterThan(0)
    const ids = ENEMY_SCRIPT_STORE.map((row) => row.id)
    expect(new Set(ids).size, 'two store rows share an id').toBe(ids.length)
    for (const row of ENEMY_SCRIPT_STORE) {
      // An empty row would match every caster alive and hand him nothing.
      expect(row.spells.length, `${row.id} scripts nothing`).toBeGreaterThan(0)
      // The SAME cap the player is held to (planChosenSpells): both lists ride
      // the one `script` field, so the enemy cannot be authored a longer one.
      expect(row.spells.length, `${row.id} exceeds MAX_CHOSEN_SPELLS`)
        .toBeLessThanOrEqual(MAX_CHOSEN_SPELLS)
      expect(new Set(row.spells).size, `${row.id} names a spell twice`).toBe(row.spells.length)
    }
  })
})

describe('the priority walk (E-7)', () => {
  test('a caster who matches several rows takes the earliest one', () => {
    // A Death 2 raiser under a host that has researched the enchantment and can
    // pay for it qualifies for BOTH the litany and the bare harvest. The store's
    // order is the whole of the decision.
    const [entry] = withEnemyScripts(
      [caster('Necromancer', { death: 2 })],
      sealed({ enchantment: 2 }, 3),
      spellsFixture,
    )
    expect(entry.script).toEqual(LEADEN)
    // …and the row it beat really was a match, or the case above proves nothing.
    const [second] = withEnemyScripts(
      [caster('Necromancer', { death: 2 })],
      sealed({ enchantment: 0 }, 3),
      spellsFixture,
    )
    expect(second.script).toEqual(GRAVE)
  })

  test('a row is ALL of its spells — one path short is no match', () => {
    // Death 1 reaches Raise Skeleton and not Leaden Air, so the litany is not
    // his however open the school and however deep the pool. He drops to the
    // next row rather than carrying a line he could never cast.
    const [entry] = withEnemyScripts(
      [caster('Necromancer', { death: 1 })],
      sealed({ enchantment: 2 }, 3),
      spellsFixture,
    )
    expect(entry.script).toEqual(GRAVE)
  })

  test('the school gate is the ENCOUNTER\'s, and raising it turns the row on', () => {
    // The same caster, the same pool, the same store — only the host's sealed
    // Enchantment moves. This is the dial M-19 asked for and E-8 left as the
    // only one: an act that authors a higher number gets the smarter play.
    const walk = (enchantment) => withEnemyScripts(
      [caster('Necromancer', { death: 2 })],
      sealed({ enchantment }, 3),
      spellsFixture,
    )[0].script
    expect(walk(1)).toEqual(GRAVE)
    expect(walk(2)).toEqual(LEADEN)
  })

  test('the player\'s research is not consulted — only the encounter\'s', () => {
    // Nothing in the walk takes a campaign, which is the point: the enemy's
    // research IS the encounter (E-7). Asserted through the sealed block's own
    // authority — a host sealed at nothing scripts nothing that needs a school.
    const [entry] = withEnemyScripts(
      [caster('Necromancer', { death: 2 })],
      { schools: {}, channels: 9 },
      spellsFixture,
    )
    expect(entry.script).toBeUndefined()
  })
})

describe('the pool is the lock (E-8)', () => {
  test('a pool short of the poolCost skips the row, and falls to the next', () => {
    // Leaden Air costs 3 channels. At 2 the host cannot pay it, so the litany is
    // not a row this encounter has at all and the raiser takes the harvest.
    const walk = (channels) => withEnemyScripts(
      [caster('Necromancer', { death: 2 })],
      sealed({ enchantment: 2 }, channels),
      spellsFixture,
    )[0].script
    expect(walk(2)).toEqual(GRAVE)
    expect(walk(3)).toEqual(LEADEN)
    // Equal-or-above, not strictly-above: the engine's own gate qualifies on the
    // pool in full, and a script handed out on a looser rule would only fizzle.
    expect(walk(9)).toEqual(LEADEN)
  })

  test('an ordinary row is untouched by the pool — it draws nothing', () => {
    const [entry] = withEnemyScripts(
      [caster('Necromancer', { death: 2 })],
      sealed({ enchantment: 0 }, 0),
      spellsFixture,
    )
    expect(entry.script).toEqual(GRAVE)
  })
})

describe('one battlefield script per composition pass (E-8)', () => {
  test('the second qualifying caster falls through to the next row', () => {
    // "Only 1 mage should have it scripted", applied to the host's own
    // authoring: the second completion would fizzle unpaid (E-4), so the line
    // is spent on something that can land instead.
    const placement = withEnemyScripts(
      [caster('Necromancer', { death: 2 }), caster('Necromancer', { death: 2 })],
      sealed({ enchantment: 2 }, 3),
      spellsFixture,
    )
    expect(scriptsIn(placement)).toEqual([LEADEN, GRAVE])
  })

  test('ordinary rows repeat freely — two raisers both raise', () => {
    const placement = withEnemyScripts(
      [caster('Necromancer', { death: 2 }), caster('Necromancer', { death: 2 })],
      sealed({ enchantment: 0 }, 3),
      spellsFixture,
    )
    expect(scriptsIn(placement)).toEqual([GRAVE, GRAVE])
  })

  test('the limit is the PASS, not the process — a second host is scripted afresh', () => {
    // Each composition is one side's whole placement, so building tomorrow's
    // host does not inherit today's spent enchantment.
    const once = () => withEnemyScripts(
      [caster('Necromancer', { death: 2 })],
      sealed({ enchantment: 2 }, 3),
      spellsFixture,
    )[0].script
    expect(once()).toEqual(LEADEN)
    expect(once()).toEqual(LEADEN)
  })
})

describe('what gets no script at all', () => {
  test('a caster who matches nothing is sent no `script` KEY — absence is the signal', () => {
    // Water 1 reaches nothing in the store. The field is omitted rather than set
    // to [], the chosenSpells convention: the engine reads an absent script as
    // the default walk, and an empty list would have to mean the same thing
    // twice.
    const [entry] = withEnemyScripts(
      [caster('Mage', { water: 1 })],
      sealed(),
      spellsFixture,
    )
    expect('script' in entry).toBe(false)
  })

  test('the rank and file are left alone', () => {
    const placement = withEnemyScripts(
      [{ unit_type: 'Soldier', q: 0, r: 22 }],
      sealed(),
      spellsFixture,
    )
    expect(placement[0]).toEqual({ unit_type: 'Soldier', q: 0, r: 22 })
  })

  test('a row naming a spell the catalog does not carry matches nobody', () => {
    const store = [{ id: 'phantom', spells: ['no_such_spell'] }]
    const [entry] = withEnemyScripts(
      [caster('Necromancer', { death: 2 })],
      sealed({ enchantment: 2 }, 9),
      spellsFixture,
      store,
    )
    expect(entry.script).toBeUndefined()
  })

  test('an empty roster scripts nobody rather than throwing', () => {
    // The degrade-safely shape utils/spellCatalog.js promises: a process that
    // never loaded a roster composes a host with no scripts, not a crash.
    const [entry] = withEnemyScripts([caster('Necromancer', { death: 2 })], sealed(), [])
    expect(entry.script).toBeUndefined()
  })
})

describe('the walk is deterministic — which is why nothing is sealed (E-8)', () => {
  test('the same placement and the same magic give the same scripts, every time', () => {
    const placement = [
      caster('Necromancer', { death: 2 }),
      caster('Mage', { fire: 1 }),
      { unit_type: 'Soldier', q: 1, r: 23 },
      caster('Necromancer', { death: 2 }),
    ]
    const magic = sealed({ enchantment: 2 }, 3)
    const first = withEnemyScripts(placement, magic, spellsFixture)
    const second = withEnemyScripts(placement, magic, spellsFixture)
    expect(second).toEqual(first)
    // Nothing was drawn: an assignment that consumed the shared dice queue
    // would make a reload's rebuild disagree with what the campaign stored.
    expect(scriptsIn(first)).toEqual([LEADEN, ['fireball'], undefined, GRAVE])
  })

  test('an injected store is honoured, so the rules travel with the authoring', () => {
    // The store is a parameter for the same reason `rand` is elsewhere. Also the
    // all-paths rule again, on a row that mixes two schools: the fire-only mage
    // misses raise_dead and drops to the row he can carry whole.
    const store = [
      { id: 'both', spells: ['fireball', 'raise_dead'] },
      { id: 'fire_only', spells: ['fireball'] },
    ]
    const placement = [caster('Mage', { fire: 1 }), caster('Mage', { fire: 1, death: 1 })]
    expect(scriptsIn(withEnemyScripts(placement, sealed(), spellsFixture, store)))
      .toEqual([['fireball'], ['fireball', 'raise_dead']])
  })
})

// ── The wired half: both composition sites, and the reveal ──────────────────

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
const castersIn = (placement) => placement.filter((e) => e.unit_type === 'Necromancer')

describe('buildEnemyPlacement scripts the host it composes (E-7)', () => {
  test('the sealed magic it is handed is what the casters are matched against', async () => {
    // Enchantment open and the pool deep enough: exactly one of the three
    // raisers carries the litany, the rest harvest — the once-per-pass rule
    // reaching the real composition site rather than only the pure walk.
    //
    // Death 2 is DECLARED by the craft (S2-14) and the 25% check is queued to
    // fail, so every raiser is the same man and the assertion is about the walk.
    for (let i = 0; i < 3; i++) pushRoll(100)
    const placement = await buildEnemyPlacement(
      { Necromancer: 3 },
      sealed({ enchantment: 2 }, 3),
      spellsFixture,
    )
    const scripts = castersIn(placement).map((e) => e.script)
    expect(scripts).toHaveLength(3)
    expect(scripts.filter((s) => s?.includes('leaden_air'))).toHaveLength(1)
    expect(scripts.filter((s) => JSON.stringify(s) === JSON.stringify(GRAVE))).toHaveLength(2)
  })

  test('a host sealed below the gate composes without the battlefield row', async () => {
    for (let i = 0; i < 3; i++) pushRoll(100)
    const placement = await buildEnemyPlacement(
      { Necromancer: 3 },
      sealed({ enchantment: 1 }, 3),
      spellsFixture,
    )
    for (const entry of castersIn(placement)) expect(entry.script).toEqual(GRAVE)
  })

  test('the troops beside them carry no script', async () => {
    const placement = await buildEnemyPlacement({ Soldier: 4 }, sealed(), spellsFixture)
    for (const entry of placement) expect(entry.script).toBeUndefined()
  })
})

describe('a fresh campaign\'s planned placement (creation)', () => {
  test('the host\'s raisers are scripted, against the numbers creation seals', async () => {
    const { body } = await createCampaign()
    const doc = await Campaign.findById(body.id)
    const casters = castersIn(doc.enemy.plannedPlacement)
    expect(casters.length).toBeGreaterThan(0)
    // ENEMY_SCHOOLS seals Enchantment at 1, so day one fields no battlefield
    // script at all — deliberately (the top rows are authored
    // live-when-balance-raises). What every raiser gets is the harvest.
    for (const entry of casters) expect(entry.script).toEqual(GRAVE)
    for (const entry of doc.enemy.plannedPlacement)
      if (entry.unit_type !== 'Necromancer') expect(entry.script).toBeUndefined()
  })

  test('raising the host\'s sealed Enchantment is the whole of turning the smart play on', async () => {
    // The dial, end to end: move the one number on the encounter and rebuild the
    // placement the way end-of-turn does. Proves dayResolution's site reads the
    // DOCUMENT's magic and not the authored constants.
    const { body } = await createCampaign()
    const doc = await Campaign.findById(body.id)
    doc.enemy.magic.schools.set('enchantment', 2)
    await doc.save()

    const reread = await Campaign.findById(body.id)
    const { enemyMagic } = await import('../services/magic.js')
    const placement = await buildEnemyPlacement(
      { Necromancer: 4 },
      enemyMagic(reread),
      spellsFixture,
    )
    const scripts = castersIn(placement).map((e) => e.script)
    expect(scripts.filter((s) => s?.includes('leaden_air'))).toHaveLength(1)
  })
})

describe('the raid path scripts its enemy too', () => {
  const battleInput = () => engine.runBattle.mock.calls.at(-1)[0]

  // The same seam tests/research.test.js uses to pin the SEALED caster roll: a
  // target force with raisers on it, its `casterPaths` written by hand, and no
  // champion (he draws his type from ENEMY_ARMY and could come up a Necromancer,
  // which would make the count below a dice roll — the seam has its own case).
  const launchRaidAgainst = async (campaignId, casterPaths) => {
    engine.runBattle.mockResolvedValue(battleResultFixture)
    const stored = await Campaign.findById(campaignId)
    const opp = stored.raid.opportunities[0]
    opp.targetForce = new Map([['Soldier', 10], ['Necromancer', casterPaths.length]])
    opp.casterPaths = casterPaths
    opp.capacity = 100000
    opp.bearer = null
    stored.enemy.magic.schools.set('enchantment', 2)
    await stored.save()
    const res = await auth(api.post(`/api/campaigns/${campaignId}/raids/launch`))
      .send({ parties: { [opp.id]: [stored.squads[0].id] } })
    expect(res.status).toBe(201)
    return battleInput()
  }

  test('the raid target\'s casters cross the wire scripted', async () => {
    const { body } = await createCampaign()
    const input = await launchRaidAgainst(body.id, [{ death: 2 }, { death: 2 }])
    // Derived over the card's SEALED roll, and once-per-pass on this target's
    // own composition — the raid is a side, exactly like the host.
    expect(castersIn(input.enemy_placement).map((e) => e.script)).toEqual([LEADEN, GRAVE])
  })

  test('a raid card\'s casters who reach nothing carry no script', async () => {
    const { body } = await createCampaign()
    const input = await launchRaidAgainst(body.id, [{ high: 1 }])
    for (const entry of castersIn(input.enemy_placement))
      expect(entry.script).toBeUndefined()
  })

  test('the champion takes no script — he carries no paths either', async () => {
    const { body } = await createCampaign()
    engine.runBattle.mockResolvedValue(battleResultFixture)
    const stored = await Campaign.findById(body.id)
    const opp = stored.raid.opportunities[0]
    opp.targetForce = new Map([['Soldier', 10]])
    opp.casterPaths = []
    opp.capacity = 100000
    opp.bearer = { type: 'Necromancer', items: [] }
    await stored.save()
    const res = await auth(api.post(`/api/campaigns/${body.id}/raids/launch`))
      .send({ parties: { [opp.id]: [stored.squads[0].id] } })
    expect(res.status).toBe(201)
    const champion = battleInput().enemy_placement.find((e) => e.squad_name === 'Champion')
    expect(champion).toBeTruthy()
    // The seam slice 2 left open, extended rather than quietly closed: a bearer
    // is built from his GEAR alone, so he is outside the scripting pass too.
    expect(champion.script).toBeUndefined()
  })
})

describe('the scripts are HIDDEN — the reveal never carries them', () => {
  test('even Overwhelming recon shows type and hex, and nothing of the plan', async () => {
    const { body } = await createCampaign()
    const doc = await Campaign.findById(body.id)
    doc.recon.points = RECON_LEVEL_THRESHOLDS[RECON_LEVEL_THRESHOLDS.length - 1]
    doc.raid.scoutingPoints = 0
    await doc.save()

    const res = await auth(api.get(`/api/campaigns/${body.id}`))
    expect(res.status).toBe(200)
    expect(res.body.enemy.placements.length).toBeGreaterThan(0)
    // The projection is a whitelist — campaignView reads {unit_type, q, r} off
    // each planned entry and aggregates per hex — so `script` is dropped by the
    // same construction that has always dropped `paths`. Pinned as a property of
    // the RESPONSE rather than of the projection's code, so a future projection
    // that started spreading the entry fails here.
    for (const row of res.body.enemy.placements) {
      expect(Object.keys(row).sort()).toEqual(['count', 'q', 'r', 'type'])
    }
    // QUOTED, the expectNoHiddenInfo convention: the spell roster's own
    // `description` fields contain the letters "script", so only the key itself
    // is a leak.
    expect(JSON.stringify(res.body)).not.toContain('"script"')
    // …and the truth really was there to leak.
    const stored = await Campaign.findById(body.id)
    expect(castersIn(stored.enemy.plannedPlacement).some((e) => e.script)).toBe(true)
  })
})
