import { describe, expect, test, beforeEach } from 'vitest'
import {
  findCharter,
  eligibleCharters,
  drawCharterOffer,
  nextSquadId,
  enrolCharter,
} from '../services/charters.js'
import {
  applyEffect,
  describeEffect,
  eventValence,
  eventValenceFor,
  eligiblePool,
  CHARTER_BEATS,
  EVENT_POOL,
} from '../services/events.js'
import { priceEffect, reachOf } from '../services/balanceSheet.js'
import { charterOfferView } from '../services/campaignView.js'
import { pushRoll, clearRolls } from '../utils/dice.js'
import {
  CHARTER_CATALOG,
  CHARTER_DRAW,
  SQUAD_ARCHETYPES,
  SQUAD_RANKS,
  STARTING_SQUADS,
} from '../utils/campaignConfig.js'

// Charter recruitment — docs/CAMPAIGN_PLAN.md, "CHARTER RECRUITMENT + SQUADS
// IN THE LAB", slice R1 (decisions R-1..R-8). The pure layer: the authored
// catalog, the draft, enrolment, and the `squad` effect's three readers
// (valence, description, the balance sheet). Route wiring — the sealed offer,
// the answer gate and the deferred path — is covered in campaigns.test.js.

const openingRows = () => CHARTER_CATALOG.filter((row) => row.opening)
const draftableRows = () => CHARTER_CATALOG.filter((row) => !row.opening)

// A campaign as the pure layer sees it: squads plus a roster bag. Both bag
// shapes are exercised, because a live doc hands these functions Mongoose Maps
// and a test hands them plain objects.
const campaignWith = (squads = [], roster = { Soldier: 300 }) => ({ squads, roster })
const freshCampaign = () =>
  campaignWith(STARTING_SQUADS.map((s) => ({ ...s, composition: { ...s.composition } })))

beforeEach(clearRolls)

// ── the catalog (R-2, R-3, R-4) ─────────────────────────────────────────────
// The sweep the slice was specified around. A charter is authored content, and
// content that quietly disagrees with the archetype it names is a company the
// reinforcement rules would refuse to refill — a bug the player meets three
// turns after the offer, when nothing connects it back to a bad row.
describe('CHARTER_CATALOG: the sweep every row must pass', () => {
  test('every row names an archetype that exists', () => {
    for (const row of CHARTER_CATALOG)
      expect(SQUAD_ARCHETYPES[row.archetype], row.id).toBeTruthy()
  })

  test('every composition stays inside its archetype and uses only capped types', () => {
    // PERMITTED TYPES ARE THE KEYS OF `caps` (the squad overhaul's decision 3):
    // a type absent from caps may not stand in that archetype at all, so a row
    // naming one would hand out a company the caps say cannot exist.
    for (const row of CHARTER_CATALOG) {
      const caps = SQUAD_ARCHETYPES[row.archetype].caps
      const entries = Object.entries(row.composition)
      expect(entries.length, row.id).toBeGreaterThan(0)
      for (const [type, n] of entries) {
        expect(caps[type], `${row.id}/${type}`).toBeDefined()
        expect(n, `${row.id}/${type}`).toBeGreaterThan(0)
        expect(n, `${row.id}/${type}`).toBeLessThanOrEqual(caps[type])
      }
    }
  })

  test('ids and names are unique — an offer must never deal the same company twice', () => {
    const ids = CHARTER_CATALOG.map((row) => row.id)
    expect(new Set(ids).size).toBe(ids.length)
    const names = CHARTER_CATALOG.map((row) => row.name)
    expect(new Set(names).size).toBe(names.length)
  })

  test('every row carries a blurb — a card that shows a name alone is not a choice', () => {
    for (const row of CHARTER_CATALOG) {
      expect(typeof row.blurb, row.id).toBe('string')
      expect(row.blurb.trim().length, row.id).toBeGreaterThan(0)
    }
  })

  test('prestige is a non-negative integer, and a few rows arrive Blooded (R-4)', () => {
    const blooded = SQUAD_RANKS.find((r) => r.label === 'Blooded').min
    for (const row of CHARTER_CATALOG) {
      const p = row.prestige ?? 0
      expect(Number.isInteger(p), row.id).toBe(true)
      expect(p, row.id).toBeGreaterThanOrEqual(0)
    }
    // The rarity lever with no new mechanism behind it: a company that arrives
    // at the first rung comes with an upgrade slot already open.
    expect(draftableRows().filter((row) => (row.prestige ?? 0) >= blooded).length)
      .toBeGreaterThan(0)
  })

  test('exactly three opening rows, and STARTING_SQUADS is derived from them', () => {
    const opening = openingRows()
    expect(opening).toHaveLength(3)
    expect(STARTING_SQUADS.map((s) => s.id)).toEqual([1, 2, 3])
    expect(STARTING_SQUADS.map((s) => ({
      name: s.name, archetype: s.archetype, composition: s.composition, charterId: s.charterId,
    }))).toEqual(opening.map((row) => ({
      name: row.name, archetype: row.archetype, composition: row.composition, charterId: row.id,
    })))
  })

  test('the catalog can never run dry on a fresh campaign', () => {
    // The one arithmetic promise the content owes the code: every seeded beat
    // must be able to deal a FULL hand, or the answer route's exhausted-catalog
    // edge (which enrols nobody) becomes reachable in ordinary play.
    expect(draftableRows().length).toBeGreaterThanOrEqual(CHARTER_BEATS.length * CHARTER_DRAW)
  })

  test('every archetype is draftable — the draft must not be one archetype wearing three names', () => {
    for (const archetype of Object.keys(SQUAD_ARCHETYPES))
      expect(draftableRows().some((row) => row.archetype === archetype), archetype).toBe(true)
  })

  test('findCharter resolves a row and tolerates one that is gone', () => {
    expect(findCharter('first_cohort').name).toBe('1st Cohort')
    expect(findCharter('no_such_row')).toBe(null)
  })
})

// ── the draft (R-2, R-6) ────────────────────────────────────────────────────
describe('drawCharterOffer', () => {
  test('never offers an opening row — you already have those', () => {
    const offer = drawCharterOffer(freshCampaign(), CHARTER_CATALOG.length)
    for (const id of offer.picks) expect(findCharter(id).opening).toBeFalsy()
  })

  test('never offers a company already on the rolls', () => {
    const held = draftableRows()[0]
    const campaign = freshCampaign()
    campaign.squads.push({ id: 4, name: held.name, charterId: held.id, composition: {} })
    const offer = drawCharterOffer(campaign, CHARTER_CATALOG.length)
    expect(offer.picks).not.toContain(held.id)
    expect(eligibleCharters(campaign).map((r) => r.id)).not.toContain(held.id)
  })

  test('draws WITHOUT replacement — no company is offered twice on one card', () => {
    for (let i = 0; i < 20; i++) {
      const picks = drawCharterOffer(freshCampaign()).picks
      expect(new Set(picks).size).toBe(picks.length)
    }
  })

  test('deals CHARTER_DRAW cards, and a SHORTER hand rather than a padded one', () => {
    expect(drawCharterOffer(freshCampaign()).picks).toHaveLength(CHARTER_DRAW)
    // Hold every draftable row but one: the offer shrinks to what is left. The
    // draw never pads itself — the upgrade draft's convention, third time.
    const rows = draftableRows()
    const campaign = campaignWith(rows.slice(1).map((row, i) => ({
      id: i + 1, name: row.name, charterId: row.id, composition: {},
    })))
    expect(drawCharterOffer(campaign).picks).toEqual([rows[0].id])
    // And an exhausted catalog deals nothing at all, rather than throwing.
    const all = campaignWith(rows.map((row, i) => ({
      id: i + 1, name: row.name, charterId: row.id, composition: {},
    })))
    expect(drawCharterOffer(all).picks).toEqual([])
  })

  test('goes through the dice seam, so a test can pin exactly who came forward', () => {
    // Indices into the shrinking eligible list, exactly as drawUpgradeOffer
    // consumes them — the queueable seam is what makes the draft testable.
    const eligible = eligibleCharters(freshCampaign()).map((r) => r.id)
    pushRoll(0)
    pushRoll(0)
    pushRoll(0)
    expect(drawCharterOffer(freshCampaign()).picks)
      .toEqual([eligible[0], eligible[1], eligible[2]])
  })

  test('a squad from before v45 carries no charterId and fences nothing off', () => {
    // The safe direction: an unknown row can only WIDEN the draw.
    const campaign = campaignWith([{ id: 1, name: 'Nameless', composition: {} }])
    expect(eligibleCharters(campaign)).toHaveLength(draftableRows().length)
  })
})

// ── enrolment (R-3, R-4) ────────────────────────────────────────────────────
describe('enrolCharter', () => {
  const row = () => findCharter('hedgerow_company')

  test('appends the company with the next id, its composition, prestige and row id', () => {
    const campaign = freshCampaign()
    const line = enrolCharter(campaign, row())
    const squad = campaign.squads.at(-1)
    expect(nextSquadId({ squads: [] })).toBe(1)
    expect(squad.id).toBe(4)
    expect(squad.name).toBe(row().name)
    expect(squad.archetype).toBe(row().archetype)
    expect(squad.composition).toEqual(row().composition)
    expect(squad.composition).not.toBe(row().composition) // copied, not shared
    expect(squad.prestige).toBe(row().prestige ?? 0)
    expect(squad.upgrades).toEqual([])
    expect(squad.charterId).toBe(row().id)
    expect(line).toMatch(/takes service under your banner/)
    expect(line).toMatch(/Hedgerow Company/)
  })

  test('a Blooded row arrives at its rung (R-4)', () => {
    const campaign = freshCampaign()
    enrolCharter(campaign, findCharter('ashmoor_remnant'))
    expect(campaign.squads.at(-1).prestige).toBe(findCharter('ashmoor_remnant').prestige)
  })

  test('the bodies join the ROSTER — a plain-object bag', () => {
    // A squad's composition is always a subset of the roster; a company
    // enrolled without this would be men who do not eat and cannot take the
    // field.
    const campaign = campaignWith([], { Soldier: 300 })
    enrolCharter(campaign, row())
    expect(campaign.roster).toEqual({ Soldier: 300 + row().composition.Soldier, Pikeman: row().composition.Pikeman })
  })

  test('the bodies join the ROSTER — a Mongoose-style Map bag', () => {
    const campaign = campaignWith([], new Map([['Soldier', 300]]))
    enrolCharter(campaign, row())
    expect(campaign.roster.get('Soldier')).toBe(300 + row().composition.Soldier)
    expect(campaign.roster.get('Pikeman')).toBe(row().composition.Pikeman)
  })

  test('ids are max + 1, not length + 1', () => {
    const campaign = campaignWith([{ id: 9, composition: {} }])
    enrolCharter(campaign, row())
    expect(campaign.squads.at(-1).id).toBe(10)
  })
})

// ── the `squad` effect (R-8) ────────────────────────────────────────────────
describe('applyEffect — squad', () => {
  const target = () => ({ ...freshCampaign(), day: 3, resources: { food: 0, materials: 0 } })

  test('enrols the company the ctx names, and says so', () => {
    const campaign = target()
    const before = campaign.squads.length
    const log = applyEffect(campaign, { type: 'squad' }, { charterId: 'fen_bows' })
    expect(campaign.squads).toHaveLength(before + 1)
    expect(campaign.squads.at(-1).charterId).toBe('fen_bows')
    expect(campaign.roster.Archer).toBe(findCharter('fen_bows').composition.Archer)
    expect(log.join(' ')).toMatch(/The Fen Bows takes service/)
  })

  test('no ctx: nothing happens and NOTHING is said', () => {
    // The structural sweeps push every authored fate through applyEffect with
    // no ctx at all; a scheduled beat with no picker in front of it must be
    // inert rather than a throw or a phantom company.
    const campaign = target()
    expect(applyEffect(campaign, { type: 'squad' })).toEqual([])
    expect(campaign.squads).toHaveLength(3)
  })

  test('a row already on the rolls: nothing happens and nothing is said', () => {
    const campaign = target()
    applyEffect(campaign, { type: 'squad' }, { charterId: 'fen_bows' })
    const after = campaign.squads.length
    expect(applyEffect(campaign, { type: 'squad' }, { charterId: 'fen_bows' })).toEqual([])
    expect(campaign.squads).toHaveLength(after)
  })

  test('an opening row, or one gone from the catalog, enrols nobody', () => {
    const campaign = target()
    expect(applyEffect(campaign, { type: 'squad' }, { charterId: 'first_cohort' })).toEqual([])
    expect(applyEffect(campaign, { type: 'squad' }, { charterId: 'no_such_row' })).toEqual([])
    expect(campaign.squads).toHaveLength(3)
  })
})

describe('the `squad` effect reads the same three ways as every other effect', () => {
  test('it is a gain (R-3): free bodies and a charter, with nothing given up', () => {
    expect(eventValence({ type: 'squad' })).toBe('good')
  })

  test('the card prices it — generically, because the offer cards carry the names', () => {
    const line = describeEffect({ type: 'squad' }).join(' ')
    // The phrase is load-bearing: the frontend detects the charter branch by it.
    expect(line).toMatch(/take service under your banner/)
  })

  test('the balance sheet prices it rather than reporting it UNPRICED', () => {
    const notes = priceEffect({ type: 'squad' }).notes.join(' ')
    expect(notes).not.toMatch(/UNPRICED/)
    expect(notes).toMatch(/charter: draft of /)
    expect(notes).toMatch(new RegExp(`draft of ${CHARTER_DRAW}`))
  })
})

// ── the beats (R-5, R-6) ────────────────────────────────────────────────────
describe('the charter beats', () => {
  const beat = (id) => EVENT_POOL.find((e) => e.id === id)

  test('three of them, on turns that interleave with the siege spine', () => {
    expect(CHARTER_BEATS.map((b) => b.day)).toEqual([3, 6, 9])
    // No day may carry two forced beats — drainScheduled would spend two of the
    // turn's three fates on scripted content.
    const spineDays = [2, 5, 8]
    for (const { day } of CHARTER_BEATS) expect(spineDays).not.toContain(day)
  })

  test('each is a chained, good choice-fate with ONE branch and no "none" (R-6)', () => {
    const pool = eligiblePool({ day: 10, roster: new Map([['Soldier', 100]]) })
    for (const { eventId } of CHARTER_BEATS) {
      const e = beat(eventId)
      expect(e, eventId).toBeTruthy()
      expect(e.chained, eventId).toBe(true)
      expect(e.severity, eventId).toBe(2)
      expect(e.effect, eventId).toEqual({ type: 'choice' })
      expect(eventValenceFor(e), eventId).toBe('good')
      expect(e.choices, eventId).toHaveLength(1)
      expect(e.choices[0].id, eventId).toBe('take_charter')
      expect(e.choices[0].effect, eventId).toEqual({ type: 'squad' })
      // Never a random draw or decoy...
      expect(pool.some((p) => p.id === eventId), eventId).toBe(false)
      // ...but the schedule drain needs a same-tier eligible peer for the decoy.
      expect(pool.some((p) => p.severity === e.severity && p.id !== eventId), eventId).toBe(true)
    }
  })

  test('the three cards are distinct — a beat met three times must not read as a bug', () => {
    const titles = CHARTER_BEATS.map(({ eventId }) => beat(eventId).title)
    expect(new Set(titles).size).toBe(3)
    const prose = CHARTER_BEATS.map(({ eventId }) => beat(eventId).description)
    expect(new Set(prose).size).toBe(3)
  })

  test('the sheet reaches them through the SPINE door, on their named turn', () => {
    // Not `chain`/"scheduled only", which is what their `chained: true` would
    // otherwise buy them: these are guaranteed on a turn, like the spine.
    for (const { eventId, day } of CHARTER_BEATS)
      expect(reachOf(beat(eventId)), eventId).toEqual({ door: 'spine', detail: `turn ${day}` })
  })
})

// ── the view (R-3) ──────────────────────────────────────────────────────────
describe('charterOfferView', () => {
  test('resolves each sealed id to the whole card — the composition IS the choice', () => {
    const view = charterOfferView({ picks: ['fen_bows', 'broken_lances'] })
    expect(view.picks.map((p) => p.id)).toEqual(['fen_bows', 'broken_lances'])
    for (const pick of view.picks)
      expect(Object.keys(pick).sort())
        .toEqual(['archetype', 'blurb', 'composition', 'id', 'name', 'prestige', 'rank'])
    expect(view.picks[1].rank).toBe('Blooded')
    expect(view.picks[0].rank).toBe('Untested')
    expect(view.picks[0].composition).toEqual(findCharter('fen_bows').composition)
  })

  test('null when the fate offered none, and a vanished row is dropped', () => {
    expect(charterOfferView(null)).toBe(null)
    expect(charterOfferView(undefined)).toBe(null)
    expect(charterOfferView({ picks: ['fen_bows', 'no_such_row'] }).picks.map((p) => p.id))
      .toEqual(['fen_bows'])
  })
})
