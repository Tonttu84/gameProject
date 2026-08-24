import { describe, expect, test, vi } from 'vitest'
import {
  onMission,
  canTakeMission,
  availableSquads,
  missionBodies,
  missionBodiesOf,
  drawMissionOffer,
  missionBlocker,
  beginMission,
  returnMissions,
} from '../services/missions.js'
import {
  applyEffect,
  describeEffect,
  eventEligible,
  eventValence,
  missionEffectFor,
  EVENT_POOL,
} from '../services/events.js'
import { meterFillAtShare } from '../services/meter.js'

// Missions — docs/CAMPAIGN_PLAN.md, "DECISION 12 — MISSIONS".

const squad = (over = {}) => ({
  id: 1, name: '1st Cohort', prestige: 0, composition: { Soldier: 40 }, ...over,
})
const away = (over = {}) => squad({ mission: { untilDay: 7, eventId: 'ford_watch' }, ...over })
const campaignWith = (squads, over = {}) => ({ day: 4, squads, ...over })

const MISSION_EVENT = EVENT_POOL.find((e) => e.choices?.some((c) => c.effect?.type === 'mission'))

describe('the mission state', () => {
  test('a charter is away exactly while it carries a mission', () => {
    expect(onMission(squad())).toBe(false)
    expect(onMission(away())).toBe(true)
  })

  test('a stale mission still reads as away until newDay clears it', () => {
    // Presence-based, not a date comparison. The safe direction: a document
    // whose day has passed cannot be sent on a SECOND errand in the meantime —
    // returnMissions is the one thing that frees a charter.
    expect(onMission(away({ mission: { untilDay: 1, eventId: 'ford_watch' } }))).toBe(true)
  })

  test('a wiped charter cannot be sent, and neither can one already away', () => {
    // A charter at composition {} is a NORMAL state (decision 14), which is
    // exactly why it needs saying: it is on the rolls and must not be sendable.
    expect(canTakeMission(squad())).toBe(true)
    expect(canTakeMission(squad({ composition: {} }))).toBe(false)
    expect(canTakeMission(squad({ composition: { Soldier: 0 } }))).toBe(false)
    expect(canTakeMission(away())).toBe(false)
  })

  test('composition reads the same whether it is a Map or a plain object', () => {
    // Mongoose hands back Maps; tests and creation pass objects.
    expect(canTakeMission(squad({ composition: new Map([['Soldier', 3]]) }))).toBe(true)
    expect(canTakeMission(squad({ composition: new Map() }))).toBe(false)
  })

  test('the blocker names which kind of busy, in the player\'s vocabulary', () => {
    expect(missionBlocker(squad())).toBe(null)
    expect(missionBlocker(away())).toBe('mission')
    expect(missionBlocker(squad({ composition: {} }))).toBe('empty')
  })
})

describe('bodies away', () => {
  test('only charters on a mission count, summed by type', () => {
    const c = campaignWith([
      away({ id: 1, composition: { Soldier: 40, Pikeman: 5 } }),
      squad({ id: 2, composition: { Archer: 30 } }),
      away({ id: 3, composition: { Soldier: 10 } }),
    ])
    expect([...missionBodies(c).entries()].sort()).toEqual([['Pikeman', 5], ['Soldier', 50]])
    expect(missionBodiesOf(c, 'Soldier')).toBe(50)
    expect(missionBodiesOf(c, 'Archer')).toBe(0)
  })

  test('an army with nobody away reports nothing away', () => {
    expect(missionBodies(campaignWith([squad()])).size).toBe(0)
    expect(missionBodies({}).size).toBe(0)
  })
})

describe('the offer (12-1)', () => {
  test('two charters when two are free', () => {
    const c = campaignWith([squad({ id: 1 }), squad({ id: 2 }), squad({ id: 3 })])
    const offer = drawMissionOffer(c)
    expect(offer.picks).toHaveLength(2)
    expect(new Set(offer.picks).size).toBe(2)
    expect(offer.locked).toBe(null)
  })

  test('one charter and a LOCKED near-miss when only one is free', () => {
    // The locked slot is the whole point of 12-1's "1 and 1 locked out choice":
    // it names a real charter so the player learns WHY it cannot go.
    const c = campaignWith([squad({ id: 1 }), away({ id: 2 })])
    const offer = drawMissionOffer(c)
    expect(offer.picks).toEqual([1])
    expect(offer.locked).toBe(2)
  })

  test('the locked slot prefers a charter that is AWAY over one that is wiped', () => {
    // Both are unavailable; only one of them teaches the mechanic this slice
    // exists to teach.
    const c = campaignWith([squad({ id: 1 }), squad({ id: 2, composition: {} }), away({ id: 3 })])
    expect(drawMissionOffer(c).locked).toBe(3)
  })

  test('nobody free offers nothing at all', () => {
    const c = campaignWith([away({ id: 1 }), away({ id: 2 })])
    const offer = drawMissionOffer(c)
    expect(offer.picks).toEqual([])
    // A locked slot is still shown: there IS a charter, it simply cannot go.
    expect(offer.locked).toBe(1)
  })

  test('the pair is drawn from the free charters only, however the roll is shuffled', () => {
    const c = campaignWith([away({ id: 1 }), squad({ id: 2 }), squad({ id: 3 }), squad({ id: 4 })])
    for (let i = 0; i < 40; i++)
      for (const id of drawMissionOffer(c).picks) expect(id).not.toBe(1)
  })
})

describe('departure and homecoming', () => {
  test('a charter leaves for exactly the turns the effect names', () => {
    const c = campaignWith([squad()])
    const line = beginMission(c, c.squads[0], { turns: 3, eventId: 'ford_watch' })
    // untilDay is the day they are BACK: chosen on day 4, gone 3 turns, home
    // on day 7 — three turns the player plays without them.
    expect(c.squads[0].mission).toEqual({ untilDay: 7, eventId: 'ford_watch' })
    expect(line).toContain('away until day 7')
  })

  test('nobody comes home early', () => {
    const c = campaignWith([away({ mission: { untilDay: 7, eventId: 'ford_watch' } })], { day: 6 })
    expect(returnMissions(c, missionEffectFor)).toEqual([])
    expect(onMission(c.squads[0])).toBe(true)
  })

  test('a charter home on its day is freed and paid its prestige', () => {
    const c = campaignWith([away({ mission: { untilDay: 7, eventId: MISSION_EVENT.id } })], { day: 7 })
    const paid = missionEffectFor(MISSION_EVENT.id).prestige
    const lines = returnMissions(c, missionEffectFor)
    expect(onMission(c.squads[0])).toBe(false)
    expect(c.squads[0].prestige).toBe(paid)
    expect(lines[0]).toContain(`+${paid} prestige`)
  })

  test('prestige is read off the EVENT, so a retune reaches a mission already away', () => {
    // The numbers are not stored on the charter — that is the whole reason the
    // eventId is. A campaign in flight picks up a rebalance.
    const c = campaignWith([away({ mission: { untilDay: 7, eventId: 'ford_watch' } })], { day: 7 })
    returnMissions(c, () => ({ prestige: 99 }))
    expect(c.squads[0].prestige).toBe(99)
  })

  test('an event that has left the pool pays nothing rather than throwing', () => {
    // The findUpgrade/archetypeOf convention: a campaign in flight must still
    // load after a catalog edit.
    const c = campaignWith([away({ mission: { untilDay: 7, eventId: 'gone_from_the_pool' } })], { day: 7 })
    expect(() => returnMissions(c, missionEffectFor)).not.toThrow()
    expect(c.squads[0].prestige).toBe(0)
    expect(onMission(c.squads[0])).toBe(false)
  })
})

describe('the fate that asks for a charter', () => {
  test('one authored mission fate exists, and it is a CHOICE', () => {
    // 12 is explicit that the fate which takes a squad IS the fate that
    // requires one — build them together or the cost lands uncompensated.
    expect(MISSION_EVENT).toBeTruthy()
    expect(MISSION_EVENT.effect.type).toBe('choice')
    expect(MISSION_EVENT.requires.freeSquads).toBe(1)
    // And it has a way out: a demand with no refusal is not a decision.
    expect(MISSION_EVENT.choices.some((c) => c.effect?.type !== 'mission')).toBe(true)
  })

  test('it is never drawn when no charter can go (12-6)', () => {
    const ctx = (squads) => ({ day: 4, roster: {}, squads })
    expect(eventEligible(MISSION_EVENT, ctx([squad({ id: 1 })]))).toBe(true)
    expect(eventEligible(MISSION_EVENT, ctx([away({ id: 1 })]))).toBe(false)
    expect(eventEligible(MISSION_EVENT, ctx([squad({ id: 1, composition: {} })]))).toBe(false)
    expect(eventEligible(MISSION_EVENT, ctx([]))).toBe(false)
  })

  test('absent squad context reads as a fresh campaign, so the creation draw works', () => {
    // The garrison gate's convention: no context means "as a new campaign
    // would be", not "ineligible".
    expect(eventEligible(MISSION_EVENT, { day: 1, roster: {} })).toBe(true)
  })

  test('the card states BOTH halves of the trade before you commit', () => {
    // 12-4 made them flat and certain precisely so the card can say them.
    expect(describeEffect({ type: 'mission', turns: 3, prestige: 12 }))
      .toEqual(['A charter marches out for 3 turns — +12 prestige when it returns'])
  })

  test('a mission reads as neither a boon nor a blow', () => {
    expect(eventValence({ type: 'mission', turns: 3, prestige: 12 })).toBe('neutral')
  })

  test('missionEffectFor finds the effect on the branch that carries it', () => {
    expect(missionEffectFor(MISSION_EVENT.id)).toMatchObject({ type: 'mission' })
    expect(missionEffectFor('no_such_event')).toBe(null)
    // A fate with choices but no mission branch has none.
    expect(missionEffectFor('captured_courier')).toBe(null)
  })
})

describe('applying the effect', () => {
  test('a squad in ctx marches out', () => {
    const c = campaignWith([squad()])
    const log = applyEffect(c, { type: 'mission', turns: 2, prestige: 5 }, { squad: c.squads[0], eventId: 'ford_watch' })
    expect(c.squads[0].mission).toEqual({ untilDay: 6, eventId: 'ford_watch' })
    expect(log[0]).toContain('marches out')
  })

  test('no squad in ctx sends nobody, and does not throw', () => {
    // The structural sweeps push every authored fate through applyEffect
    // against skeleton campaigns; a scheduled mission beat has no picker either.
    const c = campaignWith([squad()])
    expect(() => applyEffect(c, { type: 'mission', turns: 2, prestige: 5 })).not.toThrow()
    expect(c.squads[0].mission).toBeUndefined()
  })

  test('a bundled fate carries the target down to its parts', () => {
    const c = campaignWith([squad()], { resources: { food: 1000 } })
    applyEffect(
      c,
      { type: 'multi', effects: [{ type: 'food', delta: -500 }, { type: 'mission', turns: 1, prestige: 3 }] },
      { squad: c.squads[0], eventId: 'ford_watch' },
    )
    expect(c.squads[0].mission.untilDay).toBe(5)
    expect(c.resources.food).toBe(500)
  })
})

describe('what a mission takes away (12-5)', () => {
  test('the boss-fight meter stops counting a charter that is away', () => {
    // Out of the TOTAL, not merely out of `inCamp`: they are neither exposed
    // nor keeping watch, because they are not in the valley at all.
    const base = {
      day: 4,
      roster: new Map([['Soldier', 100]]),
      raid: { assignment: new Map() },
      characters: [],
    }
    const home = meterFillAtShare({ ...base, squads: [squad({ composition: { Soldier: 40 } })] }, 0)
    const gone = meterFillAtShare({ ...base, squads: [away({ composition: { Soldier: 40 } })] }, 0)
    // With nobody raiding, the remaining army is idle in camp either way, so
    // the RATE is unchanged — what changed is who it is measured over.
    expect(gone).toBeCloseTo(home, 10)
    // And with the whole army away there is nobody left to measure.
    const empty = meterFillAtShare(
      { ...base, squads: [away({ composition: { Soldier: 100 } })] },
      0,
    )
    expect(empty).toBeGreaterThan(0)
  })

  test('an away charter does not make the meter treat the rest as raiders', () => {
    const base = {
      day: 4,
      roster: new Map([['Soldier', 100]]),
      raid: { assignment: new Map([['Soldier', 20]]) },
      characters: [],
    }
    const home = meterFillAtShare({ ...base, squads: [squad({ composition: { Soldier: 40 } })] }, 0)
    const gone = meterFillAtShare({ ...base, squads: [away({ composition: { Soldier: 40 } })] }, 0)
    // 20 raiders now weigh against 60 men rather than 100, so the army that
    // REMAINS is proportionally more exposed. This is the direction the
    // exclusion produces, recorded so a later reader does not "fix" it.
    expect(gone).toBeGreaterThan(home)
  })
})

describe('the shuffle', () => {
  test('picks are drawn at random, not always the first two in the roll', () => {
    const c = campaignWith([squad({ id: 1 }), squad({ id: 2 }), squad({ id: 3 })])
    const seen = new Set()
    for (let i = 0; i < 60; i++) for (const id of drawMissionOffer(c).picks) seen.add(id)
    expect(seen).toEqual(new Set([1, 2, 3]))
  })

  test('a single free charter is offered every time', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.99)
    try {
      const c = campaignWith([squad({ id: 5 }), away({ id: 6 })])
      expect(drawMissionOffer(c).picks).toEqual([5])
    } finally {
      spy.mockRestore()
    }
  })
})
