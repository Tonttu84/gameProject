import { getCatalog } from '../utils/catalog.js'
import {
  armyFoodPerTurn,
  reconBand,
  reconLevel,
  squadRank,
  nextRank,
  SCOUTING_BANDS,
} from '../utils/capabilities.js'
import {
  FORAGE_KG_PER_POINT,
  FORAGE_FOOD_SHARE,
  FORAGE_MATERIALS_SHARE,
  AUGURY_DEBUG_SHOW_TRUTH,
  MAP_NAME,
  ENEMY_SUPPLY_BANDS,
  RAID_SCOUT_COST_ADD,
  RAID_SCOUT_COST_REVEAL,
  bandLabel,
} from '../utils/campaignConfig.js'
import { armyTotal } from './enemyHost.js'
import { squadCaps, squadIntake, looseRoster, forecastRefills } from './squadReinforce.js'
import { allBodies, wornItems, characterMods, awayBlocker } from './characters.js'
import {
  squadUpgrades,
  slotsFor,
  slotsUsed,
  upgradeSlotCost,
  picksAvailable,
  findUpgrade,
} from './squadUpgrades.js'
import { bannerTier, describeItem, squadBanner, storedItems } from './items.js'
import { meterBand, meterFillAtShare, remainingBracket } from './meter.js'
import { missionBlocker } from './missions.js'
import { garrisonLevel } from './garrison.js'
import { displayBracket } from './recon.js'
import {
  forageCapacityKg, forageYieldMultiplier, applyForageModifiers, foldForageModifiers,
} from './forage.js'
import { fortifyCost, fortifyWorkerCost, atFortCap, fortifiedSidesFor } from './fortification.js'
import { eventValenceFor, choiceRung, describeEffect, optionCard, rungOf } from './events.js'

// The charters a mission fate offered, resolved for display: a name and rank
// for each pick, and for the LOCKED slot the name plus the one word for why it
// cannot go (12-1/12-2). ONE resolver, exported, because the same offer has to
// appear on two screens — the tent's reveal card and the choices-only overlay —
// and two of these would drift the first time the wording changed.
//
// Nothing here is redrawn: it reads the sealed offer off the decision.
export const missionOfferView = (campaign, offer) => {
  if (!offer) return null
  const find = (id) => (campaign.squads ?? []).find((sq) => sq.id === id)
  const locked = find(offer.locked)
  return {
    picks: [...(offer.picks ?? [])]
      .map(find)
      .filter(Boolean)
      .map((sq) => ({ id: sq.id, name: sq.name, rank: squadRank(sq.prestige) })),
    locked: locked
      ? { id: locked.id, name: locked.name, blocker: missionBlocker(locked) }
      : null,
  }
}

// Has the turn's true/false uncertainty finished doing its job? ONE predicate,
// because the augur's cards and the raid board must never disagree about what
// the player is allowed to know (2026-08-10).
//
// The uncertainty exists to price the REROLL — that is the only decision it
// gates (confirmed with the user). So it lifts the moment that decision is
// over, by either route: the reroll is spent, or the fates are accepted with it
// unspent. The second half is new; before it, a player who hoarded the reroll
// walked into the raids phase with counter cards they still could not read.
const auguryTruthRevealed = (augury) =>
  AUGURY_DEBUG_SHOW_TRUTH || augury.rerollsRemaining <= 0 || augury.accepted === true

// The named threat behind a counter_event raid card, or null when there is
// nothing to say. See the `threat` field in the raid view for why this waits
// for the truth rather than showing from the moment the card is dealt.
//
// The rung comes from slot.firedRungName — the one acceptFates recorded and
// pinned, so the card describes the effect that will ACTUALLY land rather than
// re-deriving it from a scouting band that may have moved since. The rung name
// itself is not exposed: this is a threat readout, not a recon readout.
const counterThreat = (campaign, opp) => {
  if (opp.type !== 'counter_event' || opp.resolved) return null
  if (!campaign.augury || !auguryTruthRevealed(campaign.augury)) return null
  const slot = campaign.augury.slots?.[opp.reward?.slot]
  if (!slot?.trueEvent) return null
  const fired = rungOf(slot.trueEvent, slot.firedRungName ?? 'blind')
  return {
    title: fired.title,
    description: fired.description,
    // Abstract, never a rolled outcome — describeEffect's whole contract.
    effect: describeEffect(fired.effect),
  }
}
import { findRecruitEntry, resolveHire } from './recruit.js'
import { thinsEnemyHost } from './raid.js'

// What a raid card buys you that ISN'T loot, as phrases. The standing rule
// (user, 2026-08-10) is that no card may show flavour alone; `reward` covers
// the numeric payoffs and `threat` covers a counter_event, but two payoffs fell
// through both and left cards promising nothing:
//   - the KILL. destroy_detachment states its stripped-field gold and never the
//     thing it is named for, and a thins-enemy garrison_sortie ("A Coordinated
//     Sally") rendered no reward line WHATSOEVER — its whole payoff is the
//     besiegers' losses plus hidden resolve, and raid.js strips thinsEnemy out
//     of the reward object as a control flag, so rewardParts had nothing left.
//   - the LIFT. A persistent forage-modifier card said what it undid in flavour
//     only; the pressure's actual bite lived on the forage panel, a screen away.
// No numbers are added here: the casualties are the target force the card
// already brackets above, and the lift reuses describeEffect, so an enemy-side
// pressure stays the same phrase it is on the forage panel.
//
// Resolve stays SILENT on purpose — a won sortie feeds the garrison track, but
// that track gates events by threshold and is never a number to the player
// (adjustResolve logs nothing either). The sally's stated payoff is the losses
// it inflicts; its standing is felt, not read.
const raidPayoff = (campaign, opp) => {
  if (opp.resolved) return []
  const parts = []
  if (thinsEnemyHost(opp)) parts.push('The enemy host is the thinner for it')
  if (opp.modifierId) {
    // Naming the pressure is no wider than the card already is: its own title
    // and description name the thing (forageModifierFlavor), and the effect
    // goes through the one formatter, which keeps an enemyDrain pressure a
    // phrase exactly as the forage panel does.
    const modifier = (campaign.forage?.modifiers ?? []).find((m) => m.id === opp.modifierId)
    if (modifier) {
      const now = describeEffect({
        type: 'forage_modifier',
        target: modifier.target,
        factor: modifier.factor,
        deltaKg: modifier.deltaKg,
      })
      parts.push(
        now.length > 0
          ? `Ends "${modifier.label}" (now: ${now.join(', ')})`
          : `Ends "${modifier.label}"`,
      )
    }
  }
  return parts
}

// THE single serializer between campaign documents and the client. Hidden
// information — enemy.army, enemy.plannedPlacement, the augury's true/decoy
// events and prediction internals (total/threshold/accurate — the raw dice
// roll alone can't reconstruct accuracy without the hidden bonuses),
// forage.enemyDrainKg below the Outmatched recon band — exists only
// server-side; every route responds with campaignView(campaign), never a raw
// document. tests/campaigns.test.js asserts the discipline.
//
// Async because it derives display values (food need, forage capacity) from
// the cached unit catalog — the client never re-implements campaign math.

// The fates as the player sees them: after consulting, one shown card per
// slot WITH that slot's odds (the number the vision was rolled against — the
// reroll minigame needs it). NEVER the true/false pair, shownTrue, or an
// event's hidden legibility (baseAccuracy) — those stay hidden until the
// end-of-turn reveal.
const auguryView = (augury) => {
  // Each vision card gains its slot's TRUE card once the turn's reroll is
  // spent — the payoff beat of the reroll minigame (user, 2026-07-05). While
  // AUGURY_DEBUG_SHOW_TRUTH is on (playtesting) the truth shows immediately
  // on consult instead.
  const truthRevealed = auguryTruthRevealed(augury)
  return {
    consulted: augury.consulted,
    // Fates sealed at the tent (own info): tells the client whether the
    // accept beat still awaits or the player can march.
    accepted: augury.accepted === true,
    rerollsRemaining: augury.rerollsRemaining,
    visions: augury.consulted
      ? augury.slots.map((slot) => ({
          ...visionCard(slot.shownTrue ? slot.trueEvent : slot.falseEvent),
          odds: slot.odds,
          truth: truthRevealed ? visionCard(slot.trueEvent) : null,
        }))
      : null,
  }
}

// Descending {min, label} table → the first phrase the value qualifies for.
// bandLabel now lives in utils/campaignConfig.js, beside the band tables — it
// had been defined identically here and in raid.js (imported below).

// A raid target's reward as the player may see it (mini-game reveal, Stage 4
// Part 2.5): a range until the reward field is bought (rewardReveal >= 1), then
// the exact numbers — but ONLY the numeric keys the range already bracketed
// (food/materials/gold/horses/roster). A counter_event's reward is {slot}, which has no
// range (rewardRange is null) and would out which fate is bad, so it stays
// null on BOTH channels — the exact side is keyed off rewardRange, never the
// raw reward, so `slot` can't leak even once revealed.
const rewardView = (opp) => {
  const range = opp.rewardRange
  if (!range) return null
  if (opp.rewardReveal < 1) return range
  const exact = {}
  if (range.food) exact.food = opp.reward.food
  if (range.materials) exact.materials = opp.reward.materials
  if (range.gold) exact.gold = opp.reward.gold
  if (range.horses) exact.horses = opp.reward.horses
  if (range.roster) {
    exact.roster = {}
    for (const type of Object.keys(range.roster)) exact.roster[type] = opp.reward.roster[type]
  }
  return exact
}

// The graduated enemy reveal (Stage 4 1b): the scouting band decides how much
// of the hidden enemy the serializer lets through, keys ACCUMULATING with
// rank — Blind: nothing (the host is unseen); Outmatched/Contested: + bucketed
// strength phrase and supply state; Superior: + composition by category %;
// Overwhelming: + exact counts and the REAL planned placement (aggregated per
// hex for the placement grid). Everything stays a phrase or a band until the
// top rung — tests/campaigns.test.js pins the exact key set per band. (Whether
// the enemy offers battle is the top-level campaign.bossFightDue flag now, not
// an enemy-view key — the retired stance concept.)
const enemyView = (enemy, band, level, countBracket, catalog, revealed = false) => {
  const view = {}
  // A free reveal (Stage 4 1c, the anticipated Night Raid's prisoners) opens
  // the full Overwhelming tier for the turn regardless of the band; the
  // `revealed` flag tells the client (and the hidden-info tests) why.
  if (revealed) {
    band = 'Overwhelming'
    view.revealed = true
  }
  const rank = SCOUTING_BANDS.indexOf(band)
  if (rank >= SCOUTING_BANDS.indexOf('Outmatched')) {
    // Numeric estimate of the total host (recon R2) — replaces the old banded
    // strength phrase. Stored offsets against the LIVE count (so casualties slide
    // it without leaking width); a free reveal (prisoners) shows it exact.
    const total = armyTotal(enemy.army)
    view.count = revealed ? { low: total, high: total } : displayBracket(countBracket, total, level)
    // S4: the host's supply state — no longer "turns of stockpile left" but
    // last turn's verdict on whether it fed itself off the shrinking rings.
    // ACCURATE, never bracketed or fuzzed like `count`: the scouts either got
    // close enough to see the state of their camp or they didn't, and this gate
    // (Outmatched+) is what decides that. Already computed at end-day, so the
    // view just reports it.
    view.supplies = enemy.supplyState ?? ENEMY_SUPPLY_BANDS[0].label
  }
  if (rank >= SCOUTING_BANDS.indexOf('Superior')) {
    // Category shares by headcount, rounded — "mostly foot, a little horse".
    const counts = {}
    let total = 0
    for (const [type, count] of enemy.army) {
      if (count <= 0) continue
      const category = catalog.get(type)?.category ?? 'Unknown'
      counts[category] = (counts[category] ?? 0) + count
      total += count
    }
    view.composition = Object.fromEntries(
      Object.entries(counts).map(([category, n]) => [category, Math.round((100 * n) / total)]),
    )
  }
  if (rank >= SCOUTING_BANDS.indexOf('Overwhelming')) {
    view.units = Object.fromEntries(enemy.army)
    const perHex = new Map()
    for (const { unit_type, q, r } of enemy.plannedPlacement ?? []) {
      const key = `${unit_type}|${q}|${r}`
      perHex.set(key, (perHex.get(key) ?? 0) + 1)
    }
    view.placements = [...perHex.entries()].map(([key, count]) => {
      const [type, q, r] = key.split('|')
      return { type, q: Number(q), r: Number(r), count }
    })
  }
  return view
}

const visionCard = ({ id, title, description, severity, effect }) => ({
  id,
  title,
  description,
  severity,
  // The shown card's mood (good/bad/neutral), derived from its own effect so
  // the augur's header labels the flavour on display — never the hidden truth.
  // No leak: the shown card's nature is already fully visible. A choice event
  // has no single effect, so its declared valence (pool lookup) is used.
  valence: eventValenceFor({ id, effect }),
  effect, // what WOULD happen if the vision is true — not a leak
  // The same thing in words: what this MECHANICALLY does (user, 2026-08-10 —
  // "not perfect knowledge, but a clear description on a mechanical level").
  // Formatted here rather than in the client so there is one place that knows
  // how an effect reads, and so the disclosure rules baked into describeEffect
  // (hidden state stays silent, enemy figures stay phrases) cannot be
  // sidestepped by a component formatting the raw effect itself.
  effectText: describeEffect(effect),
})

export async function campaignView(campaign) {
  const catalog = await getCatalog()
  // Tonight's automatic refill, charter by charter, decided but not done
  // (13-6). One walk for the whole army rather than a plan per squad, because
  // the charters share one pool and one purse and fill in roll order (13-4) —
  // the last charter's forecast has to know what the first will take.
  const sizeOf = new Map([...catalog.values()].map((t) => [t.name, t.size]))
  const refills = forecastRefills(campaign, sizeOf)
  const points = campaign.recon?.points ?? 0
  const band = reconBand(points)
  const level = reconLevel(points)
  // The one enemy-side forage gate (S2 decision 14, extended to S3's modifiers):
  // Outmatched recon or better sees the enemy's drain and what's bending it.
  const reconOpen = SCOUTING_BANDS.indexOf(band) >= SCOUTING_BANDS.indexOf('Outmatched')
  // The player's own standing pressures, folded once for the scalars below.
  const playerBend = foldForageModifiers(campaign.forage.modifiers, 'playerYield')
  // Named once because `remaining` is derived from the ESTIMATE, not from the
  // true meter value — see remainingBracket in services/meter.js for why that
  // distinction is the whole gate.
  const meterEstimate = displayBracket(campaign.recon?.brackets?.meter, campaign.meter.value, level)
  return {
    id: campaign.id,
    day: campaign.day,
    status: campaign.status,
    battleFoughtToday: campaign.battleFoughtToday,
    // Which phase of the one-way turn the player is in (own info — it IS their
    // own progress). The client routes its screens off this rather than local
    // state, so a mid-turn reload lands where the turn actually stands, and
    // every screen behind it renders read-only.
    phase: campaign.phase,
    // The boss-fight meter (docs/CAMPAIGN_PLAN.md "Boss-fight campaign loop"):
    // hidden by default. At recon level 0 only the banded phrase crosses the
    // wire; recon R2 adds a numeric `estimate` [low, high] above that (null at
    // level 0), narrowing with the recon level and exact ({v, v}) at the top —
    // same discipline as the enemy `count` below. `bossFightDue` itself is own
    // info — it's what unlocks the decisive battle, not a secret.
    //
    // `remaining` (2026-08-10) is the gap left to the threshold, so the forage
    // panel can say turns-to-breach instead of a raw "+80" against a scale the
    // player cannot see. It is a DELIBERATE widening and carries no new
    // information: it is computed from `estimate` alone, so it is null while
    // Blind and no narrower than what recon has already sold.
    meter: {
      band: meterBand(campaign.meter.value),
      estimate: meterEstimate,
      remaining: remainingBracket(meterEstimate),
    },
    bossFightDue: campaign.bossFightDue,
    // Garrison Resolve (docs/CAMPAIGN_PLAN.md "Garrison-support epic"): shown as
    // one of three LEVEL words (low/normal/determined) — the HUD renders a gauge
    // from it. The raw resolve number stays server-side (it's what the
    // wall-slow/sally/surrender read); the level is the player's read. Defaults
    // to the starting level for a campaign that predates the field.
    garrison: { level: garrisonLevel(campaign.garrison?.resolve) },
    resources: {
      food: campaign.resources.food,
      materials: campaign.resources.materials,
      // Recruit phase (docs/CAMPAIGN_PLAN.md): gold funds caster hires,
      // horses fund Cavalry/LightCavalry hires. Own info, not hidden.
      gold: campaign.resources.gold,
      horses: campaign.resources.horses,
      // What the current roster will eat at the coming end-of-turn.
      foodNeedPerTurn: armyFoodPerTurn(allBodies(campaign), catalog),
    },
    roster: Object.fromEntries(campaign.roster),
    // Persistent, player-facing squads (own info, not hidden — same tier as
    // fortificationLevel). A squad's composition is always a subset already
    // reflected inside `roster` above; the client derives the loose
    // (unassigned) remainder the same way it already derives forage
    // availability — roster minus what's committed elsewhere.
    // `prestige` is the raw permanent rank score and `rank` its word — both own
    // info, nothing hidden. The word is derived here rather than client-side so
    // the ladder's thresholds stay one server-side constant (SQUAD_RANKS); a
    // squad at composition {} is a WIPED charter, still on the rolls and still
    // carrying its record, which the client should render as rebuilding rather
    // than as an error.
    // `archetype` is the stored id; `caps` and `intake` are RESOLVED from it
    // here rather than shipped as an id for the client to look up, which is
    // what keeps SQUAD_ARCHETYPES single-sourced (and is why the document
    // stores the bare id).
    // Characters (slice 5, kitted out by 9a). All own info, so the whole list
    // ships — including the DEAD, who stay on the rolls (5-9) and whom the panel
    // shows as a roll of honour, still carrying whatever they were not stripped
    // of. `experience`/`wounds` stay unprojected: they are still empty seams,
    // and shipping an empty array invites a client to render a system that does
    // not exist yet.
    characters: (campaign.characters ?? []).map((c) => {
      // The body plan (5-6) and what fills it, so 9b's sheet can draw the empty
      // slots as well as the full ones. Sent per character rather than as a
      // per-type table: the client asks "what can THIS person wear", and a
      // lookup table would be a second thing to keep in step.
      const anatomy = catalog.get(c.type)?.anatomy ?? null
      const plan = anatomy
        ? { head: anatomy.head, torso: anatomy.torso, legs: anatomy.legs,
            hand: anatomy.hand, misc: anatomy.misc }
        : null
      return {
        id: c.id,
        name: c.name,
        type: c.type,
        squadId: c.squadId ?? null,
        hangBack: c.hangBack ?? false,
        alive: c.alive,
        diedDay: c.diedDay ?? null,
        anatomy: plan,
        // Resolved and PHRASED (17-5), exactly like the store rows below: the
        // client holds no catalog and composes no sentence, so a helm reads the
        // same on the sheet as it does in the store.
        items: wornItems(c, plan).map(({ slot, index, row }) => ({
          slot,
          index: index ?? 0,
          id: row.id,
          name: row.name,
          blurb: row.blurb,
          permanent: row.permanent ?? false,
          unique: row.unique ?? false,
          ...describeItem(row),
        })),
        // The DERIVED stat bag (5-3), so the sheet can show base-plus-modifier
        // without re-deriving it client-side — one canonical computation site.
        mods: characterMods(c, plan),
        // Why they cannot be re-kitted right now, or null (9-8/9-9). A phrase
        // rather than a boolean, because the client renders sentences it never
        // composes and "out raiding" and "on a mission" read differently.
        awayBlocker: c.alive ? awayBlocker(campaign, c) : null,
      }
    }),
    // The item STORE (slice 6): everything held that is on nothing. Rows are
    // sent RESOLVED, like upgrades, because the client has no copy of the
    // catalog — and `kind`/`target` ride along because the slot the player
    // clicked is what filters this list (6-14), so the client needs to know
    // what each row IS, not only what it is called.
    // `permanent` and the three PHRASED lines ride along (17-5): the store's
    // browse mode has to state what an item does before it is on anything, and
    // the client composes no sentence of its own — describeItem is the single
    // wording site for both modes.
    items: storedItems(campaign).map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      blurb: row.blurb,
      target: row.target,
      permanent: row.permanent ?? false,
      ...describeItem(row),
    })),
    squads: campaign.squads.map((squad) => ({
      id: squad.id,
      name: squad.name,
      composition: Object.fromEntries(squad.composition),
      prestige: squad.prestige ?? 0,
      rank: squadRank(squad.prestige),
      // The rung above and the prestige it takes — {label, at}, or null at the
      // top of the ladder (13-14). Shipped, never re-derived client-side: the
      // thresholds are one server-side constant. The screen states the number
      // and promises nothing about what the rung is worth.
      nextRank: nextRank(squad.prestige),
      archetype: squad.archetype ?? null,
      // Away on a mission, or null (decision 12). The DAY it is back rather
      // than turns remaining: the client re-derives nothing about the calendar,
      // and a stored countdown would need decrementing every turn — one more
      // thing to get wrong. A raid is a separate state and stays in
      // raid.squadAssignment (12-3), so the screen renders three states from
      // two fields.
      mission: squad.mission ? { untilDay: squad.mission.untilDay } : null,
      // Caps and intake already carry the squad's upgrades (squadReinforce
      // resolves the archetype row THROUGH them), so what the screen shows is
      // what the end-of-turn refill will actually work to.
      caps: squadCaps(squad),
      intake: squadIntake(squad),
      // TONIGHT'S REFILL, forecast (13-6): who joins, what it costs, or the one
      // word for why nobody does. It is `planAutoRefill`'s own output — the very
      // arithmetic the end-of-turn pass runs — so the screen and the turn cannot
      // drift apart.
      //
      // It is a PREDICTION, not a promise, and the screen must say so: it is
      // computed against tonight's pool and purse, and a raid fought afterwards
      // moves both. `blocked` is one of pool/cost/space/intake/full/none (see
      // refillBlocker) and is null whenever a plan exists.
      refill: (({ plan, blocked }) => ({
        outputs: plan?.outputs ?? {},
        cost: plan?.cost ?? {},
        bodies: plan?.bodies ?? 0,
        blocked,
      }))(refills.get(squad.id) ?? { plan: null, blocked: 'none' }),
      // Slice 4a. Rows are sent RESOLVED (name + blurb) because the client has
      // no copy of the catalog and a blurb is display text, not a rule. What
      // the client sends BACK is always the id.
      upgrades: squadUpgrades(squad).map(({ id, name, blurb }) => ({ id, name, blurb })),
      // How much of the ladder this squad has already spent (4d). Sent beside
      // upgradeSlots/upgradePicks because a two-slot row makes "picks" and
      // "slots held" different numbers for the first time: two rows taken can
      // be three slots gone.
      upgradeSlotsUsed: slotsUsed(squad),
      // Own info, all derived from prestige: how many slots the rank is worth,
      // how many are still unfilled, and whether the banner has been reached.
      upgradeSlots: slotsFor(squad),
      upgradePicks: picksAvailable(squad),
      // The TIER word, not a boolean (slice 6, 6-8): 'plain' | 'basic' | 'item'.
      // Derived on every read, so a retuned rank ladder reaches campaigns in
      // flight. `bannerItem` is the bound relic resolved, or null — sent like
      // upgrades are, because the client has no copy of the catalog.
      banner: bannerTier(squad),
      bannerItem: squadBanner(squad)
        ? (({ id, name, blurb }) => ({ id, name, blurb }))(squadBanner(squad))
        : null,
      // The pending draft, or null. Resolved the same way; `rank` is the rung
      // that paid for it, which is what the panel headlines the choice with.
      // `slots` rides along per option (4d): a row that costs two would
      // otherwise look free on the card, and the player would spend a future
      // draft without being told. Resolved from the row like name and blurb, so
      // a re-priced row reaches an offer already on screen.
      upgradeOffer: squad.upgradeOffer
        ? {
            rank: squad.upgradeOffer.rank,
            options: [...squad.upgradeOffer.options]
              .map(findUpgrade)
              .filter(Boolean)
              .map((row) => ({
                id: row.id,
                name: row.name,
                blurb: row.blurb,
                slots: upgradeSlotCost(row),
              })),
          }
        : null,
    })),
    // The unassigned remainder per type — roster minus every charter's
    // composition. It is what the end-of-turn refill eats (13-2), and 13-13
    // protects none of it, so this number is both "who is left to hand-place at
    // deploy" and "how much the charters can take on tonight".
    loose: looseRoster(campaign),
    // Civilian labour pool (own info): available = total − used. Forts and
    // Recruit hires both spend it; the client gates their buttons on
    // `available`.
    workers: {
      total: campaign.workers.total,
      used: campaign.workers.used,
      available: campaign.workers.total - campaign.workers.used,
    },
    // Own info (not hidden): the fort level, what the next level costs in
    // materials AND workers (both null at cap), and the actual walled sides so
    // the placement grid can draw the wall the player deploys behind.
    // fortifiedSides reuses the same source the battle input does, so screen
    // and battle can't drift.
    fortification: {
      level: campaign.fortificationLevel,
      atCap: atFortCap(campaign.fortificationLevel),
      nextCost: atFortCap(campaign.fortificationLevel)
        ? null
        : fortifyCost(campaign.fortificationLevel),
      nextWorkerCost: atFortCap(campaign.fortificationLevel)
        ? null
        : fortifyWorkerCost(campaign.fortificationLevel),
      sides: fortifiedSidesFor(MAP_NAME, campaign.fortificationLevel),
    },
    // Effort slider (S2, docs/CAMPAIGN_PLAN.md "Effort slider"): foraging is
    // passive now — no per-unit assignment, just the player's slider share of
    // the day's pool. The client previews both sides of a DRAFT share purely
    // by multiplying the scalars below (pool, kgPerPoint, the two food/
    // materials shares) — no formula lives in the client, same discipline as
    // the old per-unit kgPerUnit table.
    forage: {
      rings: campaign.forage.rings.map(({ ring, richness, initialRichness }) => ({
        ring,
        richness,
        initialRichness,
      })),
      pool: campaign.forage.pool,
      share: campaign.forage.share,
      // kg one pool point gathers at the CURRENT scouting band (Stage 4 1d's
      // posture multiplier folded in) — pool × share × this = the food+
      // materials preview; pool × (1 − share) = the scouting-points preview.
      // Standing playerYield pressures (S3) ride in the SCALARS, not a finished
      // total: the client interpolates capacity as the slider moves, so folding
      // the factor into kgPerPoint keeps its preview honest at every position,
      // and flatKg carries the additive half of the same formula
      // (max(0, points × kgPerPoint + flatKg) — what applyForageModifiers does).
      kgPerPoint: FORAGE_KG_PER_POINT * forageYieldMultiplier(band) * playerBend.factor,
      flatKg: playerBend.deltaKg,
      foodShare: FORAGE_FOOD_SHARE,
      materialsShare: FORAGE_MATERIALS_SHARE,
      capacityKg: applyForageModifiers(
        forageCapacityKg(campaign.forage.pool * campaign.forage.share, band),
        campaign.forage.modifiers,
        'playerYield',
      ),
      // The pressures themselves, as labels the panel can list. A playerYield
      // one is the player's own foraging and always visible; an enemyDrain one
      // is enemy-side fact, so it's held behind the SAME recon gate as
      // enemyDrainKg below — label and all, or the gated number leaks by name.
      modifiers: (campaign.forage.modifiers ?? [])
        .filter((m) => m.target === 'playerYield' || reconOpen)
        .map((m) => ({
          id: m.id, label: m.label, target: m.target, turnsLeft: m.turnsLeft ?? null,
          // What the pressure DOES. The label and the duration between them
          // said a thing was happening and for how long, but never how much it
          // cost — so the line carried a name and no information (user,
          // 2026-08-10). Same describeEffect the fates use, fed the modifier's
          // own terms, so an enemy-side pressure stays a phrase here exactly as
          // it does there.
          effectText: describeEffect({
            type: 'forage_modifier',
            target: m.target,
            factor: m.factor,
            deltaKg: m.deltaKg,
          }),
        })),
      // The boss-fight meter's fill at either extreme of the slider (decision
      // 13's "live preview of ... the pitched-battle effect") — linear in
      // share, so the client interpolates for any draft position without the
      // meter's own constants ever crossing the wire.
      meterFillAtNoForage: meterFillAtShare(campaign, 0),
      meterFillAtFullForage: meterFillAtShare(campaign, 1),
      // The enemy's abstract drain (decision 14): recon-gated like the enemy
      // view below — "unknown" (null) under Outmatched, the real number above.
      enemyDrainKg: reconOpen
        ? applyForageModifiers(campaign.forage.enemyDrainKg, campaign.forage.modifiers, 'enemyDrain')
        : null,
    },
    // Raid opportunities (Stage 4 Part 2 + the 2.5 scouting mini-game): the
    // hidden targetForce and reward stay server-side; the player sees per-type
    // enemy RANGES and (where the reward has numbers) a reward range, each of
    // which spending scouting points pins to the exact value (enemyReveal /
    // rewardReveal >= 1). strengthBand stays a coarse always-on summary. A
    // resolved opportunity shows its outcome; the battle replay is the reveal
    // of what the party actually met.
    raid: {
      opportunities: campaign.raid.opportunities.map((opp) => ({
        id: opp.id,
        type: opp.type,
        title: opp.title,
        description: opp.description,
        strengthBand: opp.strengthBand,
        capacity: opp.capacity,
        source: opp.source,
        // Persistent cards (S3) are worth flagging to the player: this one will
        // still be here next turn, so scouting spent on it keeps its value and
        // there's no pressure to take it today. modifierId stays server-side —
        // the card's own flavour already says what beating it undoes.
        persistent: opp.persistent ?? false,
        // Range pre-reveal, exact once bought — per unit TYPE, never one
        // headcount (a fantasy roster reads "3 Giants + 20 spearmen").
        enemy: opp.enemyReveal >= 1 ? Object.fromEntries(opp.targetForce) : opp.enemyRange,
        enemyReveal: opp.enemyReveal,
        reward: rewardView(opp),
        rewardReveal: opp.rewardReveal,
        // What a counter_event card actually buys you. Its reward is {slot} —
        // no loot, just a blow that never falls — so without this the card is
        // pure flavour and cannot be priced against its party budget (user,
        // 2026-08-10). Named threat + the abstract cost of it landing; the
        // VERDICT (whether it lands, whether the scouts turn it) is still held
        // back to end-day, which is the 2026-07-18 deferral this must not undo.
        //
        // Held back until auguryTruthRevealed, and that gate is the design:
        // while the reroll decision is still live, naming the true fate here
        // would hand the player the answer for free. The card's
        // mere EXISTENCE already leaks "this slot is truly bad" — it is keyed
        // off slot.trueEvent — but the board is not rendered before accept and
        // the phase march is one-way, so that leak buys nothing. This does not
        // widen it.
        threat: counterThreat(campaign, opp),
        // The non-loot half of what winning buys — see raidPayoff. Without it
        // a sortie card promised nothing at all and a destroy card promised
        // only the coin picked off the field afterwards.
        payoff: raidPayoff(campaign, opp),
        resolved: opp.resolved,
        outcome: opp.resolved ? opp.outcome : null,
      })),
      // Troops already committed to a raid today (own resources — no hidden
      // info here), so the party-builder can share one pool across every
      // still-open opportunity. See the schema comment on raid.assignment.
      assignment: Object.fromEntries(campaign.raid.assignment),
      // Squads already sent on a raid this turn (own info) — the squad-picker
      // greys these out. See the schema comment on raid.squadAssignment.
      squadAssignment: [...campaign.raid.squadAssignment],
      // The per-turn scouting-points pool + what each action costs, so the
      // client can render the mini-game and clamp its buttons.
      scoutingPoints: campaign.raid.scoutingPoints,
      scoutCost: { addTarget: RAID_SCOUT_COST_ADD, reveal: RAID_SCOUT_COST_REVEAL },
    },
    // Recruit phase (docs/CAMPAIGN_PLAN.md "Recruit phase — hiring troops"):
    // today's 2-option offer, drawn when the player opens the phase. Options
    // are looked up fresh by id through findRecruitEntry (the sealed-pool
    // -lookup convention pendingChoices below also uses — an id that's left
    // the pool mid-campaign is dropped, degrade-safely) and resolved through
    // resolveHire against the LIVE resources/workers so count/cost reflect
    // exactly what hiring would do right now, including the day's boosted
    // roll — never the stale numbers from when the offer was drawn.
    //
    // `drawn` tells the client the phase has been opened for the day: the
    // offer is live AND the camp is closed (see rejectIfRecruiting), so a
    // client that lost its screen state — a reload mid-turn — can put the
    // player back on the Recruit screen instead of on a camp screen whose
    // every button would 400.
    recruit: {
      fervor: campaign.recruit.fervor,
      boosted: campaign.recruit.boosted,
      hiredToday: campaign.recruit.hiredToday,
      drawn: campaign.recruit.drawnDay === campaign.day,
      options: (campaign.recruit.dailyOptions ?? []).flatMap((id) => {
        const entry = findRecruitEntry(id)
        if (!entry) return []
        const resolved = resolveHire(entry, campaign.recruit.boosted, {
          resources: campaign.resources,
          workersFree: campaign.workers.total - campaign.workers.used,
          roster: campaign.roster,
        })
        // `from` crosses so the card can say the hire PROMOTES rather than
        // recruits — the trainees are the player's own troops leaving one line
        // of the roster for another, which is the cost most worth seeing.
        return [{ id: entry.id, unit: entry.unit, lane: entry.lane, from: entry.from ?? null, ...resolved }]
      }),
    },
    // Decisions owed (events with choices): display fields + option CARDS
    // only — branch effects, the pool id, and the fired rung stay server-side
    // (looked up again at choose time). An entry whose event has left the
    // pool is dropped, the same degrade-safely convention as elsewhere.
    pendingChoices: (campaign.pendingChoices ?? []).flatMap(({ slot, eventId, rung, missionOffer }) => {
      const def = choiceRung(eventId, rung)
      if (!def) return []
      return [{
        slot,
        title: def.title,
        description: def.description,
        // optionCard, not a hand-rolled pick: the branch's mechanical cost is
        // the thing an option most needs to state, and the tent's reveal beat
        // builds its cards the same way so the two screens cannot disagree.
        options: def.choices.map(optionCard),
        // The charters this fate offered (12-1), resolved to what the card must
        // show. Sent from the SEALED offer, never redrawn here — a view that
        // redrew it would hand the player a reroll every screen refresh.
        missionOffer: missionOfferView(campaign, missionOffer),
      }]
    }),
    // Scouting: derived at view time (like foodNeedPerTurn), no schema field.
    // ONLY the banded label crosses the hidden-info boundary — the raw
    // coverage/ratio would let the client solve for the enemy composition.
    scouting: { band },
    augury: auguryView(campaign.augury),
    // What the band licenses the player to know about the enemy — see
    // enemyView above. A live free-reveal window (prisoners taken) trumps
    // the band for the turn; scouting.band above still reports the real
    // contest.
    enemy: enemyView(
      campaign.enemy,
      band,
      level,
      campaign.recon?.brackets?.enemyCount,
      catalog,
      (campaign.enemy.revealedUntilDay ?? 0) >= campaign.day,
    ),
    battles: campaign.battles.map(String),
    log: campaign.log.slice(-10),
  }
}
