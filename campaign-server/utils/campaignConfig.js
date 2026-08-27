// Campaign tuning knobs and starting state — the one place campaign numbers
// live. Unit STATS stay in the C++ constructors (SSOT); these are the
// campaign-layer rules built on top of them.
//
// PRICING SOMETHING NEW? Read docs/ECONOMY.md first — a rough reading of what a
// unit of food/materials/gold/horses/workers is worth against the prices here,
// so an invented number has something to be consistent with. (The generated
// docs/BALANCE_SHEET.md is its companion: every fate and raid reward priced
// side by side.) Neither is a balance target; both are references.
//
// TIME SCALE: one campaign turn (the model's `day` counter, one end-day
// resolution) represents TWO WEEKS of campaigning. Food is in kilograms and
// everything below is per-turn: a unit eats size² × FOOD_KG_PER_SIZE_SQ_PER_DAY
// × DAYS_PER_TURN each turn (size-10 foot soldier → 28 kg, size-20
// horse-and-rider → 112 kg), so stores and forage richness sit on the
// tens-of-thousands scale — an army of hundreds really does eat tonnes.

export const DAYS_PER_TURN = 14
export const MAP_NAME = 'sample_battle'

// Retires the frontend STARTING_ROSTER hardcode (docs/ADDING_UNITS.md §6).
// Mage and Priest USED to sit here at 3 apiece; slice 5 moved them out of the
// roster entirely and into STARTING_CHARACTERS below (docs/CAMPAIGN_PLAN.md
// "SLICE 5 — CHARACTERS", 5-1). Nothing about the army got smaller — the same
// six bodies eat, fill the meter and take the field — they are just individuals
// now instead of a count.
export const STARTING_ROSTER = {
  Soldier: 300,
  Archer: 50,
  Cavalry: 10,
  LightCavalry: 12,
}

// ── Characters (docs/CAMPAIGN_PLAN.md "SLICE 5 — CHARACTERS") ────────────────
//
// The unit types that are CHARACTERS rather than roster counts (5-1). A type
// listed here may never appear in `campaign.roster`: it enters play as an
// individual with a name, a modifier layer and a permanent death, or not at
// all. A test pins this against RECRUIT_POOL's caster lane, so a new caster
// row cannot quietly become a roster count again.
//
// Since slice C3 the list is TWO kinds, and the split is load-bearing:
//   • CASTER_CHARACTER_TYPES — the hire lanes. These are what isCasterType
//     answers for (paths, scripts, chosen spells on the wire and the view).
//   • MINDLESS_CHARACTER_TYPES — the Golem, the special and likely ONLY
//     mindless character (C-4: character-hood is the exception here, not a
//     precedent). Mindless means: no paths or script ever, and no hang-back
//     order — it follows intent, not orders, so the toggle does not exist
//     for it (the view omits the field and the route refuses the write).
export const CASTER_CHARACTER_TYPES = ['Mage', 'Priest']
export const MINDLESS_CHARACTER_TYPES = ['Golem']
export const CHARACTER_TYPES = [...CASTER_CHARACTER_TYPES, ...MINDLESS_CHARACTER_TYPES]

// Types that draw no rations (C-4): a THEMATIC call per type, not a balance
// lever and not implied by mindlessness — summons eat or don't by theme, and a
// golem is animated stone. Read by eatingBodies (services/characters.js), the
// food twin of allBodies; everything else about upkeep (the meter, field
// points, annihilation) still counts these bodies.
export const NON_EATING_TYPES = ['Golem']

// One character per squad — still explicitly a PROTOTYPING PLACEHOLDER
// (decision 9), which is why it is a named constant rather than a `1` written
// into the attach logic.
export const MAX_CHARACTERS_PER_SQUAD = 1

// Names are drawn from this pool at hire, never reused while their owner is on
// the rolls — dead or alive, since a dead character is KEPT (5-9) and a
// campaign that recycles a fallen name reads as a bug. Deliberately plain data:
// a rename action can arrive later without touching anything structural. If the
// pool ever empties, mintCharacter falls back to a numbered name rather than
// refusing the hire — running out of names must never be able to block a
// purchase the player has already paid for.
export const CHARACTER_NAMES = [
  'Isolde', 'Barnabas', 'Ceridwen', 'Dunstan', 'Elowen', 'Ferrant',
  'Gwenllian', 'Hadrian', 'Ismene', 'Jorund', 'Katriona', 'Lucan',
  'Morwenna', 'Nikander', 'Orsola', 'Peregrine', 'Quenilda', 'Rowan',
  'Sabeline', 'Torquil', 'Ulric', 'Verity', 'Wystan', 'Ysolde',
  'Alard', 'Bertrande', 'Casimir', 'Drusilla', 'Eadric', 'Fenella',
  'Guthlac', 'Hilde', 'Ivo', 'Jocasta', 'Kester', 'Leofric',
  'Melisande', 'Norbert', 'Oriel', 'Perrin',
]

// What a golem is called when it first stands (slice C3). A pool of its own
// rather than a human name off CHARACTER_NAMES — a construct is NAMED by its
// maker the way a sword is, not christened — drawn through the same
// drawCharacterName machinery (uniqueness against the whole rolls, numbered
// fallback when the pool runs dry).
export const GOLEM_NAMES = [
  'Basalt', 'Adamant', 'Grindstone', 'Bulwark', 'Millwheel', 'Cromlech',
  'Anvil', 'Loadbearer', 'Quernstone', 'Monolith', 'Gatewarden', 'Plinth',
]

// The six casters a campaign opens with — the old STARTING_ROSTER Mage 3 /
// Priest 3, now named individuals. All start UNATTACHED (5-12): attachment is
// the player's first character decision, and it keeps the deploys-alone path
// exercised from the very first battle. Names are taken from the pool in order
// rather than drawn, so a fresh campaign is reproducible.
export const STARTING_CHARACTERS = [
  { type: 'Mage' }, { type: 'Mage' }, { type: 'Mage' },
  { type: 'Priest' }, { type: 'Priest' }, { type: 'Priest' },
]
// Persistent starting squads (playtest item 1): a subset of STARTING_ROSTER
// organized into named, deployable formations so squads are testable from
// turn 1. Sized to fit one hex (Hex::CAPACITY = 640 size-points; Soldier/
// Archer are 10, Cavalry/LightCavalry are 20 — see `./game info`). At least
// one is mixed-type (Vanguard Riders) to exercise that path. `id` is a small
// int, not an ObjectId — it flows straight into the engine's placement JSON
// as squad_id. The remainder of STARTING_ROSTER stays loose (unassigned).
export const STARTING_SQUADS = [
  { id: 1, name: '1st Cohort',      archetype: 'line',     composition: { Soldier: 40 } },
  { id: 2, name: 'Skirmishers',     archetype: 'skirmish', composition: { Archer: 30 } },
  { id: 3, name: 'Vanguard Riders', archetype: 'vanguard', composition: { Cavalry: 6, LightCavalry: 6 } },
]

// ── Squad archetypes (docs/CAMPAIGN_PLAN.md "NEXT UP — THE SQUAD OVERHAUL",
// decisions 2-4) ─────────────────────────────────────────────────────────────
// An archetype is the charter's innate character: which troop types may stand
// in it, how many of each, and how fast it absorbs replacements. There is no
// global size rule — "elite-and-small" vs "large-and-mediocre" is a real trade
// the player picks between, and acquisition (decision 11) is what hands one
// out. Squads point at a row by id; the row is never copied onto the document,
// so a rebalance here reaches live campaigns.
//
// PERMITTED TYPES ARE THE KEYS OF `caps` — deliberately not a second list
// beside them. A separate `permitted: []` could disagree with `caps` and
// express nonsense (a permitted type with no cap, a capped type not
// permitted); that is exactly the `placeable`/`spawnable` mistake `UnitRole`
// fixed on 2026-08-10. A type absent from `caps` may not join, full stop.
//
// Caps are PER TYPE with no total (decision 3), so the inspect screen reads
// "5/6 Cavalry · 6/6 LightCavalry". Characters sit OUTSIDE the caps entirely.
export const SQUAD_ARCHETYPES = {
  // Heavy foot that holds a line. The big, ordinary one.
  line:     { caps: { Soldier: 40, Pikeman: 10 },    intake: 10 },
  // Missile foot, lighter and fewer, with militia bodies to screen it.
  skirmish: { caps: { Archer: 30, Militia: 10 },     intake: 6 },
  // Mounted, mixed by design (it is the standing mixed-type case). Small AND
  // slow to refill: the elite end of decision 4's trade, where a wipe hurts
  // longest. Its caps are the numbers decision 3 states verbatim.
  vanguard: { caps: { Cavalry: 6, LightCavalry: 6 }, intake: 2 },
}

// The hex budget a squad's TROOPS may occupy, in engine SIZE POINTS — not a
// headcount, and it must never be rewritten as one. A squad is always ONE
// formation on ONE hex (services/enemyPlacement.js addBlock; the engine groups
// formations by hex + squad_id), so Hex::CAPACITY = 640 is the hard ceiling,
// and SQUAD_CHARACTER_RESERVE of it is reserved for attached characters — who
// sit outside the CAPS (decision 3) but emphatically not outside the hex.
//
// Points rather than bodies because the conversion is not fixed and is already
// promised to move: troop types smaller than a human are expected later, and
// the formation-fighters upgrade (decision 8) changes how much room a unit
// takes without changing the unit. 600 is therefore 60 size-10 foot TODAY and
// a different number of bodies tomorrow. Base caps sit well under it on
// purpose; the headroom is what size upgrades sell.
//
// WHICH size — SETTLED AND BUILT in 4c: a unit carries TWO figures, its REAL
// size (AUnit::getSize) and its ADJUSTED/packing size (AUnit::getPackingSize),
// and this budget counts the ADJUSTED one, because packing a hex is exactly
// what it measures (squadSizePoints takes the squad's formation-fighter value
// and applies the engine's floor). Everything priced off a body rather than a
// footprint keeps using the REAL size: a tighter formation does not make a man
// eat less or need less armour (user, 2026-08-13). Food upkeep
// (size² × FOOD_KG_PER_SIZE_SQ_PER_DAY) is the live example — it must not
// follow the adjusted figure.
//
// The adjustment runs BOTH WAYS (user, 2026-08-13): a long weapon can make a
// man occupy MORE room just as drill can make him occupy less. So never assume
// adjusted ≤ real — a cap derived from that inequality would silently overfill
// a hex the first time a unit packs looser than its real size. The engine's
// formationFighter is signed for exactly this reason.
export const SQUAD_TROOP_BUDGET = 600

// The slice of the hex held back for the characters a squad may carry
// (decision 9's Mage/Priest, one per squad today). Characters sit outside the
// per-type CAPS but inside the hex, so the budget check adds this to the
// troops' points rather than leaving it as spare room beside them — otherwise
// attaching a character is what overfills the hex. A named constant rather
// than the comment it used to be, because slice 3's budget gate is the first
// thing that has to arithmetic with it.
export const SQUAD_CHARACTER_RESERVE = 40

// ── Squad upgrades (docs/CAMPAIGN_PLAN.md "SLICE 4 — THE UPGRADE CATALOG") ───
// What prestige is FOR. Slice 1 made the rank permanent and never spent; this
// is the first thing that reads it for gating.
//
// Slots are CUMULATIVE and keyed by the RANK WORD, not by a prestige number:
// SQUAD_RANKS owns the thresholds, this owns what each rung is worth, so
// retuning one never silently moves the other. Seasoned deliberately grants NO
// pick — it hands over the banner instead (SQUAD_BANNER_RANK below), which is
// what makes the banner "a bit better than the others" (user, 2026-08-13).
// Three picks in a campaign, at Blooded, Renowned and Legendary.
export const SQUAD_UPGRADE_SLOTS_BY_RANK = {
  Untested: 0,
  Blooded: 1,
  Seasoned: 1,
  Renowned: 2,
  Legendary: 3,
}

// The rung that grants the banner free, consuming no slot. The banner opens the
// item slot and carries NO bonus and NO kind choice — decision 16's deferral is
// deliberate and must not be filled in by invention (see the slice-4 spec).
export const SQUAD_BANNER_RANK = 'Seasoned'

// ─── Magic items (docs/CAMPAIGN_PLAN.md, SLICE 6) ────────────────────────────
//
// ONE catalog for every kind of item, never a per-kind table (decision 17:
// "build it for items in general and never for banners specifically"). A row
// DECLARES what it may attach to and whether that attachment is permanent, so
// the single assignment path asks the item rather than inferring anything from
// its kind — the first re-assignable kind (character armour, 5-4/5-5) then
// needs no new path.
//
// A stored item is a BARE CATALOG ID (6-9): no per-instance uid, because every
// non-basic banner is unique in a campaign and a save is never migrated
// (routes/campaigns.js culls any document from another schema or build). If a
// duplicate-able kind ever arrives, the store grows a uid then.
//
//   kind       – free-form; the SLOT names what it accepts, storage stays
//                ignorant of what kinds exist.
//   target     – 'squad' | 'character'. Where it goes. Nothing attaches to an
//                individual rank-and-file troop, and nothing should.
//   permanent  – true means assignment is one-way: it leaves the store and
//                never returns (decision 10, for banners).
//   abilities  – the UnitAbility wire names this item GRANTS, sent as
//                `squad_abilities` on each placement entry. Banners grant
//                ABILITIES, never flat stats (user, 2026-08-20).
//   slot       – gear only: which anatomy slot it occupies ('head' | 'torso' |
//                'legs' | 'hand' | 'misc'). The count per slot is a fact about
//                the CREATURE and lives in the engine catalog (5-6); the row
//                only says which kind of place it needs.
//   mods       – gear only: a {stat: delta} bag, in the character-sheet
//                vocabulary applyStatMod knows (9-5). A row may carry mods, or
//                abilities, or both (9-2) — the way SQUAD_UPGRADE_POOL rows
//                already bundle several effects. This does NOT overturn the
//                banner rule above: that was a rule about banners, and gear is
//                the other kind of thing.
//   denies     – gear only: ability wire names the item takes AWAY (9-3/9-4).
//                Authoring rule: name only NON-IMPLIED abilities. Denying an
//                implied one is not forbidden and not dangerous — the engine
//                subtracts denials BEFORE running the implication closure, so
//                such a row is simply inert — but it does nothing, and
//                items.test.js fails it so the author finds out.
//   unique     – true means the campaign may hold at most one (6-9/9-6).
//                Banners are unique; ordinary kit stacks, and `campaign.items`
//                is a [String] that may simply repeat.
//   lootable   – false takes the row out of the loot and recovery path in BOTH
//                directions (9-12): never stripped from an enemy, never lost
//                when your own bearer falls. A ROW FLAG rather than a
//                `kind === 'banner'` test inside the loot code, because the row
//                already declares its kind, target, permanence and uniqueness —
//                this is the house pattern, not a new one.
export const ITEM_CATALOG = [
  {
    id: 'banner_unbroken_line',
    kind: 'banner',
    name: 'The Unbroken Line',
    blurb:
      'Karrowgate\'s own standard, carried off the wall and put into your hands. ' +
      'While it flies over them, the squad does not break.',
    target: 'squad',
    permanent: true,
    unique: true,
    // Banners sit outside the loot path in both directions (user, 2026-08-24):
    // "we dont loot banners (mainly for thematic reasons, it would be showing
    // enemy colors etc)", and our own charters survive being wiped, so they
    // keep theirs. Written down because it is exactly the kind of asymmetry a
    // later reader would "fix".
    lootable: false,
    abilities: ['fearless'],
  },

  // ── Gear (slice 9a, decision 9-15) ─────────────────────────────────────────
  //
  // One mundane piece per slot plus one unique relic, so every slot, both
  // uniqueness paths and both effect kinds (stats and abilities) carry real
  // content rather than only tests.
  //
  // THE NUMBERS ARE BALANCE-DEFERRED, per the standing pass: plausible values,
  // not tuned ones. Do not read a design intent into a +1.
  {
    id: 'gear_iron_helm',
    kind: 'gear',
    slot: 'head',
    name: 'Iron Helm',
    blurb: 'Plain, heavy and dented in three places. It has been worn before.',
    target: 'character',
    permanent: false,
    unique: false,
    lootable: true,
    mods: { defence: 1 },
  },
  {
    id: 'gear_mail_hauberk',
    kind: 'gear',
    slot: 'torso',
    name: 'Mail Hauberk',
    blurb: 'Riveted rings to the knee. It turns a blade and it slows a man down.',
    target: 'character',
    permanent: false,
    unique: false,
    lootable: true,
    // The first item in the game with a real cost as well as a benefit.
    mods: { armour: 1, speed: -1 },
  },
  {
    id: 'gear_boiled_greaves',
    kind: 'gear',
    slot: 'legs',
    name: 'Boiled Greaves',
    blurb: 'Hardened leather, strapped at the calf. Cheap, and better than nothing.',
    target: 'character',
    permanent: false,
    unique: false,
    lootable: true,
    mods: { armour: 1 },
  },
  {
    id: 'gear_soldiers_blade',
    kind: 'gear',
    slot: 'hand',
    name: "Soldier's Blade",
    blurb: 'An arming sword off the muster rolls. Nothing special, and always sharp.',
    target: 'character',
    permanent: false,
    unique: false,
    lootable: true,
    mods: { attack: 1 },
  },
  {
    id: 'gear_field_satchel',
    kind: 'gear',
    slot: 'misc',
    name: 'Field Satchel',
    blurb: 'Bandages, a flask, a folded blanket. It is the difference some nights.',
    target: 'character',
    permanent: false,
    unique: false,
    lootable: true,
    // maxHP, never `hitpoints` (9-5): the engine regenerates HP from the
    // maximum, so this cannot make its bearer start a battle already wounded.
    mods: { maxHP: 2 },
  },
  {
    id: 'relic_the_long_watch',
    kind: 'gear',
    slot: 'misc',
    name: 'The Long Watch',
    blurb:
      'A sentry\'s horn of blackened brass, from a wall that did not fall. '
      + 'Whoever carries it does not run.',
    target: 'character',
    permanent: false,
    // The unique path, and the reason 9-6 puts uniqueness on the ROW: this is
    // the one item in the catalog the campaign may hold only one of, and
    // recovery is guaranteed on a win where ordinary kit rolls (9-10).
    unique: true,
    lootable: true,
    abilities: ['fearless'],
    // A relic that gives should also cost: it is a horn, not a shield.
    mods: { defence: -1 },
  },

  // ── Forged items (Construction slice C1, docs/CAMPAIGN_PLAN.md C-2/C-6) ────
  //
  // A `forge` block is what makes a row craftable: it names the row's THREE
  // gates (C-6) — the Construction school level, the paths the smith must
  // himself command (M-6's caster gate, applied to forging), and the mithril
  // price. A row without one simply cannot be forged; nothing else about the
  // item knows which channel it arrived through (C-2 — the forge deposits into
  // the store exactly as loot and events do).
  //
  // THE NUMBERS ARE BALANCE-DEFERRED, like the gear above.
  {
    id: 'forged_emberedge',
    kind: 'gear',
    slot: 'hand',
    name: 'Emberedge',
    blurb:
      'A blade quenched in forge-fire that never quite left it. The edge holds '
      + 'a dull red glow, and meat remembers it.',
    target: 'character',
    permanent: false,
    unique: false,
    lootable: true,
    mods: { attack: 2 },
    forge: { level: 1, paths: { fire: 1 }, mithril: 4 },
  },
  {
    id: 'forged_wardstone',
    kind: 'gear',
    slot: 'misc',
    name: 'Wardstone',
    blurb:
      'A fist of grey rock cut with a single rune, warm against the ribs. '
      + 'Blows meant for its bearer arrive a little spent.',
    target: 'character',
    permanent: false,
    unique: false,
    lootable: true,
    mods: { defence: 1, armour: 1 },
    forge: { level: 1, paths: { earth: 1 }, mithril: 4 },
  },
  {
    id: 'forged_artificial_heart',
    kind: 'gear',
    slot: 'torso',
    name: 'Artificial Heart',
    blurb:
      'A heart of mithril and clockwork, set beating once and never stopping. '
      + 'It is placed where the old one was, and there is no taking it back.',
    target: 'character',
    // BINDS ON EQUIP (C-2): permanence is already the row property planUnequip
    // refuses and describeItem warns about — a binding item is simply a
    // permanent one whose target is a body. The equip screen shows the binding
    // line BEFORE the click; after it, the heart is part of the bearer.
    permanent: true,
    unique: false,
    lootable: true,
    mods: { maxHP: 4 },
    forge: { level: 2, paths: { earth: 2 }, mithril: 8 },
  },
]

// ── Constructions (Construction slice C2, docs/CAMPAIGN_PLAN.md C-3/C-6) ─────
//
// A construction is FORTIFICATION GENERALIZED (C-3): built from camp, felt
// where its effect points. A row declares its effects and may land on either
// side of the campaign/engine seam — but ONLY through channels that already
// exist. These first rows use exactly the two C-3 names:
//
//   effects – campaign-side: a list in the EVENT effect vocabulary, applied
//             ONCE at build through applyEffect (the same chokepoint every
//             fate uses). First rows carry only `forage_modifier`s — permanent
//             (`turnsLeft` absent), never `raidable`: a standing structure is
//             not a pressure a raid can lift.
//   sides   – battlefield-side: extra `fortified_sides` entries in the exact
//             FORTIFICATION_PRESETS shape, derived at read time beside the
//             fort's own (services/fortification.js walledSides) and injected
//             into every pitched battle. The engine never learns the word
//             "construction", exactly as it never learned "fortification".
//
// A construction wanting a genuinely NEW engine capability (a ballista that
// shoots) is content blocked on its own engine slice — never a license to
// build one speculatively (C-3).
//
// `forge` is the SAME three-gate block the craftable items carry (C-6): the
// Construction school level, the paths the builder must himself command, and
// the mithril price. Building goes through the same eligibility as forging —
// alive, paths, not-forged-today — and shares the same once-per-turn stamp:
// the fortnight at the works is the fortnight at the forge. A construction is
// inherently unique: it STANDS once built, so a built row simply closes.
//
// THE NUMBERS ARE BALANCE-DEFERRED, like the gear above. The ladder is the
// point (the second decision, 2026-08-25: level gates the TIER of what can be
// made): one row per rung so a higher Construction level is visibly FOR
// something.
export const CONSTRUCTION_CATALOG = [
  {
    id: 'works_smokehouse',
    name: 'Smokehouse and Salt Stores',
    blurb:
      'Racks over slow fires, and cellars dug deep enough to stay cold. What '
      + 'the foragers bring in stops rotting on the wagons.',
    forge: { level: 1, paths: { nature: 1 }, mithril: 3 },
    effects: [
      {
        type: 'forage_modifier',
        id: 'works_smokehouse',
        label: 'Smokehouse and salt stores',
        target: 'playerYield',
        factor: 1.1,
        raidable: false,
      },
    ],
  },
  {
    id: 'works_warding_beacons',
    name: 'Warding Beacons',
    blurb:
      'Iron cages on high poles, burning with a flame that wants no wood. '
      + 'Enemy foraging parties give the marked ground a wide berth.',
    forge: { level: 1, paths: { fire: 1 }, mithril: 3 },
    effects: [
      {
        type: 'forage_modifier',
        id: 'works_warding_beacons',
        label: 'Warding beacons',
        target: 'enemyDrain',
        deltaKg: -1000,
        raidable: false,
      },
    ],
  },
  {
    id: 'works_flanking_bastions',
    name: 'Flanking Bastions',
    blurb:
      'Stone teeth at the shoulders of the line, where the wall never reached. '
      + 'A flank that cost nothing to turn now costs a storming.',
    forge: { level: 2, paths: { earth: 2 }, mithril: 6 },
    // The wings the fort's own presets never cover: the tier-2 wall spans
    // q2–7 on the r=7 front, so these close q0–1 and q8–9 beside it.
    // Durability sits between the fort's tiers (100/160) on purpose.
    sides: [
      { q: 0, r: 7, dir: 'SE', durability: 130 },
      { q: 0, r: 7, dir: 'SW', durability: 130 },
      { q: 1, r: 7, dir: 'SE', durability: 130 },
      { q: 1, r: 7, dir: 'SW', durability: 130 },
      { q: 8, r: 7, dir: 'SE', durability: 130 },
      { q: 8, r: 7, dir: 'SW', durability: 130 },
      { q: 9, r: 7, dir: 'SE', durability: 130 },
      { q: 9, r: 7, dir: 'SW', durability: 130 },
    ],
  },
  {
    id: 'works_granary_vaults',
    name: 'Granary Vaults',
    blurb:
      'Vaulted stores under the camp itself, dry and past counting. The army '
      + 'gathers as if it had twice the wagons.',
    forge: { level: 3, paths: { nature: 1, earth: 2 }, mithril: 8 },
    effects: [
      {
        type: 'forage_modifier',
        id: 'works_granary_vaults',
        label: 'Granary vaults',
        target: 'playerYield',
        deltaKg: 400,
        raidable: false,
      },
    ],
  },
]

// ── Crafted units (Construction slice C3, docs/CAMPAIGN_PLAN.md C-4/C-5) ─────
//
// The third kind of thing the fourth school makes (the second decision,
// 2026-08-25: items, constructions, UNITS), and the fourth way a body enters
// the roster: forged, never hired. A row here is what makes an engine type
// with the `Crafted` role reachable at all — the twin of Player's
// obtainability rule, with the same teeth (C-5): a Crafted type without a row
// here is a bug, and a row whose `unit` the engine does not mark Crafted is
// one too (engine.integration.test.js pins both directions).
//
// `forge` is the SAME three-gate block items and constructions carry (C-6),
// through the same eligibility (alive, paths, not-forged-today) and the same
// once-per-turn stamp. What the action mints is a CHARACTER (C-4): named,
// attachable, artifact-bearing, permanently mortal — and mindless, so no
// paths, no script, no hang-back order, and (its own thematic call) no place
// at the cook-fires. Unlike a construction a row never closes: golems are
// rare because mithril and earth-mages are, not because a counter says so.
//
// THE NUMBERS ARE BALANCE-DEFERRED like everything the forge charges. Level 3
// tops the ladder — the school's crown, above the level-2 heart — and the
// paths gate asks Earth 2, the deepest a hire can roll, so the smith who can
// raise one is himself a rare find.
export const CRAFTED_UNIT_CATALOG = [
  {
    id: 'crafted_golem',
    name: 'Golem',
    unit: 'Golem',
    blurb:
      'A man of stone, hewn and woken. It does not tire, does not fear, does '
      + 'not eat — and it bears what a man bears, if you have arms worth '
      + 'giving it.',
    forge: { level: 3, paths: { earth: 2 }, mithril: 15 },
  },
]

// The resolve a grateful garrison must feel before it will part with its
// standard (user, 2026-08-20). The ordinary garrison gifts sit at 67 — food,
// coin and a night sally are things a grateful garrison does often. This is a
// band above them: what they do when they would follow you out of the gate.
export const GARRISON_BANNER_RESOLVE = 75

// Rows offered at each pick; the player keeps ONE, permanently. Fewer are
// offered when fewer remain eligible — the draw never pads itself.
export const SQUAD_UPGRADE_DRAW = 3

// The catalog. `archetypes` is the eligibility fence (the shared-pool-gated-by-
// archetype half of decision 8); a row naming several is shared, a row naming
// one is that archetype's signature. Effects are a small tagged union rather
// than free-form numbers on the row, so a reader can enumerate what an upgrade
// is ABLE to do — every consumer switches on `kind` and an unknown kind is
// inert rather than silently mis-applied.
//
// A ROW IS A BUNDLE: `effects` is a LIST, so one pick can do several things at
// once. That is 4c's shape, and the reason is the user's (2026-08-18): the
// PRICE of an upgrade belongs to the CHOICE, not to the ability. Formation
// Fighters pairs "packs tighter" with "costs more to reinforce" on one row,
// while the ability itself knows nothing about money — so a later row can grant
// the same ability at a different price, or none.
//
// 4a ships the three CAMPAIGN-SIDE rows only. With three rows and a draw of
// three the draft is degenerate today (every eligible row is offered every
// time) — that is expected, not a bug: the randomness starts to bite as 4b-4d
// land their engine-side rows into the same table.
//
// SIZING IS FENCED BY THE HEX, not by taste. `line` is the tight archetype —
// 40 Soldier + 10 Pikeman is 500 of the 600 budget once the 40-point character
// reserve is counted, leaving 6 bodies of headroom — so a caps row adds a FLAT
// small number per type rather than a percentage (+20% would put line at 640
// and overfill the hex). engine.integration.test.js enforces this against the
// real engine catalog for every archetype × every caps row.
export const SQUAD_UPGRADE_POOL = [
  {
    id: 'deeper_ranks',
    name: 'Deeper Ranks',
    blurb: 'The charter is written for a fuller muster: +2 to every type this squad may field.',
    archetypes: ['line', 'skirmish', 'vanguard'],
    effects: [{ kind: 'caps', bonus: 2 }],
  },
  {
    id: 'standing_drafts',
    name: 'Standing Drafts',
    blurb: 'Recruiters ride ahead of the column: +2 replacements may join each turn.',
    archetypes: ['line', 'skirmish', 'vanguard'],
    effects: [{ kind: 'intake', bonus: 2 }],
  },
  {
    id: 'light_baggage',
    name: 'Light Baggage',
    blurb: 'Nothing carried that cannot be fought with: this squad costs a quarter less raid capacity.',
    archetypes: ['line', 'skirmish', 'vanguard'],
    effects: [{ kind: 'raidCost', factor: 0.75 }],
  },
  // 4b — the ENGINE-side rows. `stat` names a figure from the unit catalog and
  // is applied per body in the battle itself (AUnit::applyStatMod), not to any
  // campaign number: a flat +1, which decision 8 flags as "small-looking and
  // already strong".
  //
  // ONE shared row plus ONE per archetype (user, 2026-08-18): the shared one
  // keeps every squad in the running, and the signature ones are what start
  // making a line squad feel unlike a vanguard. This is also what un-degenerates
  // 4a's draft — line now has 7 eligible rows and the others 6, against a draw
  // of 3.
  {
    id: 'honed_edge',
    name: 'Honed Edge',
    blurb: 'Drill with the weapons they already carry: +1 attack to every body in the squad.',
    archetypes: ['line', 'skirmish', 'vanguard'],
    effects: [{ kind: 'stat', stat: 'attack', bonus: 1 }],
  },
  {
    id: 'heavier_kit',
    name: 'Heavier Kit',
    blurb: 'Plate over mail, and the muscle to march in it: +1 armour to every body in the squad.',
    archetypes: ['line'],
    effects: [{ kind: 'stat', stat: 'armour', bonus: 1 }],
  },
  {
    id: 'marksmans_eye',
    name: "Marksman's Eye",
    blurb: 'Butts practice until the loose is thoughtless: +1 ballistic skill to every body in the squad.',
    archetypes: ['skirmish'],
    effects: [{ kind: 'stat', stat: 'ballisticSkill', bonus: 1 }],
  },
  {
    id: 'fresh_remounts',
    name: 'Fresh Remounts',
    blurb: 'A led horse for every rider: +1 speed to every body in the squad.',
    archetypes: ['vanguard'],
    effects: [{ kind: 'stat', stat: 'speed', bonus: 1 }],
  },
  // 4c — the first BUNDLED row, and the first to touch how much room a body
  // takes. `formationFighter` is an engine stat like the `stat` rows above
  // (it rides the same squad_mods transport); `reinforceCost` is the price the
  // CHOICE carries, which the ability itself knows nothing about.
  //
  // VALUE 2, not 1, and the number is load-bearing rather than a taste call:
  // an Open hex side seats 40 size-points in its fighting rank and the fit is
  // STRICT, so four size-10 soldiers fill it exactly. At packing size 9 it is
  // still four (45 > 40); at 8 a fifth man reaches the front. A -1 would buy
  // nothing but hex headroom. See test_engagements.cpp, which pins all three.
  //
  // LINE ONLY. A vanguard squad packs at 20 → 18 and still seats two per side,
  // so the row would be a near-dead pick on an archetype that only gets three
  // picks in a campaign — a trap, not a trade-off. Pools are now line 8,
  // skirmish 6, vanguard 6, against a draw of 3.
  {
    id: 'formation_fighters',
    name: 'Formation Fighters',
    blurb:
      'Drilled to fight shoulder to shoulder: every body takes 2 less room, so more of the squad reaches the fighting line — and replacements cost 1 more gold each to bring up to the standard.',
    archetypes: ['line'],
    effects: [
      { kind: 'formationFighter', value: 2 },
      { kind: 'reinforceCost', add: { gold: 1 } },
    ],
  },
  // 4d — the first row that changes WHAT a squad is rather than how well it
  // fights. Taking it CONVERTS the charter wholesale and free: the Soldier cap
  // becomes a RoyalGuard cap and every Soldier already in the ranks is a Royal
  // Guard from that moment. Pikeman rides along untouched.
  //
  // SOLDIER LEAVES THE CHARTER, and that is load-bearing rather than tidiness:
  // it is what makes the dearer replacement recipe (SQUAD_REINFORCE_POOL's
  // reinforce_royal_guard) unavoidable, and therefore what makes the slice-4
  // decision "the ongoing cost is REINFORCEMENT" true here. Restoring Soldier
  // to the guard charter would hollow the row out — the squad would simply
  // refill with cheap bodies.
  //
  // TWO SLOTS, one paid now and one BORROWED from the next rung (user: "basic
  // upgrade is modest increase to one stat", so a whole new unit type is worth
  // two). It carries NO reinforceCost surcharge: unlike Formation Fighters the
  // dearer RECIPE is the price, and stacking a surcharge would charge the same
  // trade twice.
  //
  // LINE ONLY, and structurally so — neither skirmish (Archer/Militia) nor
  // vanguard (Cavalry/LightCavalry) has a Soldier cap to swap.
  {
    id: 'royal_guard',
    name: 'Royal Guard',
    blurb:
      'The whole cohort is taken into the king’s own: every soldier trades sword and shield for the halberd, and no ordinary soldier joins them again — replacements must be trained up to the standard.',
    archetypes: ['line'],
    slots: 2,
    effects: [{ kind: 'typeSwap', from: 'Soldier', to: 'RoyalGuard' }],
  },
]

// ── Squad reinforcement recipes (docs/CAMPAIGN_PLAN.md "SLICE 3 —
// reinforcement", decisions A/B/D) ───────────────────────────────────────────
// ONE GLOBAL table, a sibling of services/recruit.js's RECRUIT_POOL and looked
// up by OUTPUT type. The archetype owns the FENCE (which types may stand in a
// charter and how many); a recipe owns the TRANSFORMATION. Keeping the two
// orthogonal means a new troop type is one row here rather than an edit to
// every archetype that admits it. Per-archetype overrides are deliberately not
// built.
//
// INPUTS AND OUTPUTS ARE UNCONNECTED (decision A). Reinforcement is NOT a
// transformation of particular bodies: one application DESTROYS everything in
// `inputs` and CREATES output.count of output.type. Nothing carries over,
// because a roster body has no identity to carry. Both sides are collections
// and neither constrains the other — many-to-one (a scorpion plus a rider make
// one ridden monster) and one-to-many (splitting something) are both intended,
// and NO code path may assume today's uniform 1:1 rows.
//   *"There is no reason why they must match … There is no need to limit
//   creativity."* — user, 2026-08-13
// Revisit the destroy/create model if troops ever gain experience or wounds:
// at that point a body has something worth preserving and "destroy and create"
// stops being a faithful description (the user's own caveat).
//
// THE NUMBERS: gold and materials, deliberately NO food. A 1:1 recipe destroys
// a body and creates one, so the army gains no new mouth — recruiting
// PROVISIONS a new body, reinforcement RE-EQUIPS an existing one. (A
// one-to-many recipe would break that symmetry; none exists yet.) Costs are
// anchored on each type's RECRUIT_POOL materials-per-body with gold as the
// type's worth, and a rider costs exactly the hire rate of 1 horse with no
// discount for the destroyed input having been mounted. Sized against real
// income (a won raid pays ~20–40 gold), a full line refill is about one raid's
// coin. Explicitly a FIRST PASS — see docs/ECONOMY.md for what a unit of each
// resource is worth, and balance later.
export const SQUAD_REINFORCE_POOL = [
  { id: 'reinforce_militia',       output: { type: 'Militia',      count: 1 }, inputs: { Militia: 1 },      cost: { gold: 1, materials: 1 } },
  { id: 'reinforce_soldier',       output: { type: 'Soldier',      count: 1 }, inputs: { Soldier: 1 },      cost: { gold: 2, materials: 2 } },
  { id: 'reinforce_archer',        output: { type: 'Archer',       count: 1 }, inputs: { Archer: 1 },       cost: { gold: 2, materials: 2 } },
  { id: 'reinforce_pikeman',       output: { type: 'Pikeman',      count: 1 }, inputs: { Pikeman: 1 },      cost: { gold: 2, materials: 1 } },
  { id: 'reinforce_light_cavalry', output: { type: 'LightCavalry', count: 1 }, inputs: { LightCavalry: 1 }, cost: { gold: 4, materials: 3, horses: 1 } },
  { id: 'reinforce_cavalry',       output: { type: 'Cavalry',      count: 1 }, inputs: { Cavalry: 1 },      cost: { gold: 5, materials: 4, horses: 1 } },
  // 4d. The INPUT is a Soldier, not a Royal Guard: there are never loose Royal
  // Guards in the roster (no recruit row sells them — the squad upgrade is the
  // only way any exist), so this is the whole acquisition channel for the type,
  // and it keeps the Militia→Soldier pipeline load-bearing. Cavalry-dear on
  // purpose, 2.5× a Soldier's row: refilling 15 dead runs 75 gold, two or three
  // good raids, so losses hurt without a mauled guard squad becoming
  // unrecoverable dead weight.
  { id: 'reinforce_royal_guard',   output: { type: 'RoyalGuard',   count: 1 }, inputs: { Soldier: 1 },      cost: { gold: 5, materials: 4 } },
]

// ~4 turns for the starting army (which needs 12,432 kg per turn).
export const STARTING_FOOD = 50000
// Playtest aid: seed enough to build the full fort progression from turn 1
// (L0→1 = 50, L1→2 = 100 = 150 to max) plus a little for recruiting, so forts are
// visible/testable on the campaign map without a debug grant. See docs/CAMPAIGN_PLAN.md.
export const STARTING_MATERIALS = 200
// Recruit phase (docs/CAMPAIGN_PLAN.md "Recruit phase — hiring troops"): both
// start at 0 — a fresh campaign has no gold or remounts, only the raw
// materials/food/workers economy. Both are earned the same two ways: off the
// raid board (destroy/loot pay gold, the horse drove pays horses) and from
// events (the garrison's paychest; A Captured Herd's keep-the-herd branch).
export const STARTING_GOLD = 0
export const STARTING_HORSES = 0
// Construction slice C1 (C-7, bd): the SEED — enough for a couple of small
// forgings before the other three channels (raid loot, events, the garrison's
// trust) have to carry it. Mithril is meant to feel rarer than gold.
export const STARTING_MITHRIL = 10

// ── Augury ──────────────────────────────────────────────────────────────────
// Each turn holds AUGURY_SLOTS independent fates, each a hidden true/false
// event pair. Consulting a slot computes its odds of showing the truth from
// an open-ended reading roll (user formula, 2026-07-05):
//
//   points = throwDice()            exploding d6, avg 4.2, unbounded upside
//          + AUGURY_BASE_POINTS     flat base
//          + mageBonus              min(3, floor(sqrt(mages)))
//          + character?.auguryBonus placeholder, 0 today
//          + trueEvent.baseAccuracy the event's legibility modifier (0–3)
//   odds   = clamp(points × AUGURY_ODDS_PER_POINT, MIN, MAX)
//
// The odds are SHOWN on the vision card — the minigame is judging a dire
// omen at 30% (probably noise) against one at 90% (all but certain) — and
// the vision itself is one chanceRoll against exactly that number.
export const AUGURY_SLOTS = 3
export const AUGURY_BASE_POINTS = 2
export const AUGURY_ODDS_PER_POINT = 0.05 // 5% per point
// Floor per the user (2026-07-05): even a bungled reading keeps a little
// value. (With base 2 the formula bottoms out at 15%; the floor is the
// guarantee that survives future maluses.)
export const AUGURY_ODDS_MIN = 0.05
export const AUGURY_ODDS_MAX = 0.9
export const AUGURY_REROLLS_PER_DAY = 1 // rerolling a slot REPLACES that fate: new pair, new roll, new odds
// The tent reveals each slot's TRUE card once the turn's reroll is spent
// (user: "I need to see the true cards when the reroll has been resolved").
// OFF as of 2026-08-10 — the early-playtest window it existed for is over
// ("we can now hide the debugging knowledge of the true event"). With it false
// the truth is gated as designed: it surfaces when the reroll DECISION ends,
// either because the reroll was spent or the fates were accepted
// (auguryTruthRevealed, services/campaignView.js). Set true again only to
// playtest the augury itself — it makes every bluff transparent on consult,
// which collapses the reroll minigame.
export const AUGURY_DEBUG_SHOW_TRUTH = false
export const AUGURY_MAGE_BONUS_CAP = 3 // mageBonus = min(cap, floor(sqrt(mages)))

// ── Scouting (Stage 4 → Recon rework) ────────────────────────────────────────
// The scouting level collapses to one of five bands — Blind / Outmatched /
// Contested / Superior / Overwhelming — and ONLY that label ever reaches the
// client (a raw point count would leak nothing about the enemy anyway).
// Recon rework (docs/CAMPAIGN_PLAN.md): the scouting LEVEL is no longer a
// passive troop-coverage ratio — it comes from `campaign.recon.points`, the
// leftover scouting points accumulated over the campaign (reconLevel/reconBand
// in utils/capabilities.js). Cumulative point thresholds to REACH each band
// above Blind, indexed to SCOUTING_BANDS[1..4]. A fresh campaign (0 points)
// starts Blind and climbs as unspent points accrue. ROUGH/TUNABLE — the real
// per-turn scouting pool is large relative to raid-board costs, so these want
// calibration in playtest (balance stays rough until the loop is complete).
// Cumulative leftover-point thresholds to REACH each band above Blind. Raised
// for recon R2 (2026-07-21): with a per-turn pool ~600 and a ~10-turn campaign,
// the old [100,300,700,1400] made the TOP tier (exact intel) trivially reached
// by mid-game. These make it a real hoard — top level costs most of a campaign's
// unspent points, so a player who ALSO spends on the raid board can't reach it.
export const RECON_LEVEL_THRESHOLDS = [200, 700, 2000, 4500] // Outmatched, Contested, Superior, Overwhelming

// Recon R2 — graduated numeric brackets (enemy total count + boss-fight meter
// value). At each recon LEVEL, the [low, high] estimate around the true value
// is `truth × [floorMult, ceilMult]`, asymmetric (skewed to OVER-estimate the
// enemy — floorMult < 1 < ceilMult). Level 0 (Blind) shows no number at all;
// the top level (Overwhelming) is exact (×[1,1]). Indexed by recon level 0..4.
// The offsets are stored ABSOLUTE and displayed against live truth, so
// casualties slide the whole bracket down without leaking width, and the bracket
// is re-set (narrower) only on a level-up — never re-rolled per turn. ROUGH/
// TUNABLE (docs/CAMPAIGN_PLAN.md "Recon rework").
export const RECON_BRACKET_MULTIPLIERS = [
  [1.0, 1.0], // 0 Blind — no bracket shown (gated out before this is read)
  [0.6, 1.7], // 1 Outmatched
  [0.78, 1.4], // 2 Contested
  [0.9, 1.18], // 3 Superior
  [1.0, 1.0], // 4 Overwhelming — exact
]
// Widening jitter added on top of the multiplier bracket when it's set, so the
// midpoint isn't the truth and the known multipliers can't be inverted to solve
// it. Directional (always widens, never inverts): the floor is pushed DOWN by up
// to `floor` × truth, the ceiling UP by up to `ceil` × truth. Skipped at the top
// level so "exact" stays exact.
export const RECON_BRACKET_JITTER = { floor: 0.25, ceil: 0.5 }

// Which rung of a recon-sensitive event actually fires at each scouting band
// (Stage 4 1c). 'blind' is the event itself (the full blow, and always what
// the augur foretells); 'warned' and 'anticipated' live on the event's
// `rungs` ladder in services/events.js. Prophecy tells you what's coming —
// scouting decides whether it lands.
export const EVENT_RUNG_BY_BAND = {
  Blind: 'blind',
  Outmatched: 'warned',
  Contested: 'warned',
  Superior: 'anticipated',
  Overwhelming: 'anticipated',
}

// Forage posture (Stage 4 1d, decision 8 of the effort slider): the band sets
// HOW efficiently the host forages. Owning the field lets foragers work in
// small dispersed parties — more ground swept per point. Losing it forces
// large defensive columns: less ground per point. Outmatched you can STILL
// forage — just less of it — and Contested is exactly the neutral baseline.
// "Group size" is the fluff for this multiplier; the player never
// micro-manages it. (Forager clashes, and this table's old clash-damper
// twin, are gone — S2 deleted the contention they applied to.)
export const FORAGE_YIELD_BY_BAND = {
  Overwhelming: 1.25,
  Superior: 1.1,
  Contested: 1,
  Outmatched: 0.85,
  Blind: 0.7,
}

// ── Raids (Stage 4 Part 2.5 — the scouting-points mini-game) ─────────────────
// Each turn opens with ONE base target (plus any counter-raids). The player
// then spends a pool of SCOUTING POINTS to shape the board: scout a new target,
// or reveal a target's hidden reward / per-type enemy strength. Points are the
// (1 − forage.share) slice of the army's one field-points pool (fieldPointsFor,
// capabilities.js) — a baseline human ≈ 1 point, summed raw over the army — so
// a bigger or scouting-heavier force (or a share weighted toward scouting)
// gets more raids. Abundance is tamed by the FLAT costs below (not by the
// generation formula), which keep "more scouting → more raids" true while
// stopping a big army from trivially revealing everything.
export const RAID_BASE_TARGETS = 1
export const RAID_SCOUT_COST_ADD = 200 // scout a NEW target
export const RAID_SCOUT_COST_REVEAL = 50 // reveal one field (reward OR enemy) one level
// fieldPointValue = (accuracy / BASELINE_ACCURACY) × (speed / foot) + reconTag,
// with accuracy = ballisticSkill × ACCURACY_PER_BALLISTIC. Named so no literal
// 10s leak into the formula; baseline human (bs 2 → acc 10, speed 10) = 1.0.
export const BASELINE_ACCURACY = 10
export const ACCURACY_PER_BALLISTIC = 5
// Player-facing reward/enemy bands are the true value ± this fraction (min
// width 1), pre-computed at generation; a reveal only pins them to exact.
export const RAID_RANGE_JITTER = 0.25
// The slice of the enemy host a raid targets (jittered per opportunity), and
// the party budget relative to the target's size-points — raids are small
// detachment actions, not the main battle by another door.
export const RAID_TARGET_FRACTION = 0.05
export const RAID_CAPACITY_RATIO = 1.25
// The user's party-cost formula (2026-07-13): one unit costs
// size × (40 − speed) / RAID_CAPACITY_SPEED_SCALE. See raidCapacityCost.
export const RAID_CAPACITY_SPEED_SCALE = 40
// Raids are short battles: the engine's max_turns for a raid input.
export const RAID_MAX_TURNS = 60
// Reward ranges ([lo, hi], rolled at generation): loot_supplies pays stores,
// rescue_troops frees bodies. destroy_detachment's reward IS the destruction
// (the target force leaves the hidden host); counter_event unmakes a sealed
// bad fate (reward = {slot}, hidden — it would out which vision was true).
export const RAID_LOOT_FOOD = [2000, 5000] // kg
export const RAID_LOOT_MATERIALS = [10, 30]
// Construction slice C1 (C-7, bd): a supply train SOMETIMES carries a
// strongbox of mithril — a chance, not a promise, so no turn's board is owed
// the forge's metal and a card that shows some is worth fighting over.
export const RAID_LOOT_MITHRIL_PCT = 25
export const RAID_LOOT_MITHRIL = [2, 5]
// Gold off a won raid (docs/CAMPAIGN_PLAN.md "Recruit phase" — the currency the
// caster lane spends: Mage 100, Priest 80). Coin per unit of the target force,
// so a bigger detachment carries more; destroy pays better than loot per head
// (spoils stripped off the dead vs a paychest riding with the wagons).
export const RAID_GOLD_PER_UNIT = { destroy_detachment: 1.2, loot_supplies: 0.8 }
// …times a WIDE independent variance roll, so size and payoff are correlated
// but far from locked together: at the same guard strength one target is a
// bargain and the next is barely worth the ride. That spread is what makes
// buying the reward field with scouting points worth the points (user,
// 2026-08-03) — without it, strengthBand alone would tell you everything.
export const RAID_GOLD_VARIANCE = [0.5, 2.0]
// Horses off a won `seize_horses` raid — "The Horse Drove", a dealer's string
// of remounts under hired guard (grilled 2026-08-03). Deliberately NOT the
// enemy's own cavalry: the card is ungated, so it draws whatever the host is
// made of, and beating the guard never thins the host. Same shape as gold —
// guard headcount × rate × a WIDE independent variance roll — so the
// bargain-target property holds here too and buying the reveal is worth the
// points. At 5 horses per Cavalry/LightCavalry hire, 0.4 makes a typical drove
// a few hires' worth, never a mounted army off one card.
export const RAID_HORSES_PER_UNIT = 0.4
export const RAID_HORSES_VARIANCE = [0.5, 2.0]
export const RAID_RESCUE_UNIT = 'Soldier'
export const RAID_RESCUE_COUNT = [10, 25]
// What the scouts SAY a raid target is — detachment-scale phrases, by unit
// count, descending. (The whole enemy host is now shown as a numeric recon
// bracket, not a phrase — see RECON_BRACKET_MULTIPLIERS.)
export const RAID_STRENGTH_BANDS = [
  { min: 60, label: 'a strong detachment' },
  { min: 25, label: 'a full company' },
  { min: 10, label: 'a small band' },
  { min: 0, label: 'a handful' },
]

// ── Squad prestige (docs/CAMPAIGN_PLAN.md "NEXT UP — THE SQUAD OVERHAUL") ────
// Prestige is a PERMANENT RANK that gates squad upgrades and is NEVER SPENT —
// upgrades are paid for in resources. (This overturned the earlier "prestige is
// a per-squad currency" sketch; see decision 5 and the struck bullet under
// "Squad-centric overhaul".) It only ever climbs, so a famous squad stays
// visibly famous instead of reading as 0 because it bought things.
//
// A raid pays the opportunity's strength band (weighted 1 weakest .. 4
// strongest, see raidBandWeight) times one of these rates. Winning REPLACES the
// participation award rather than stacking on it. Scaling by band is the whole
// point: farming the easiest card on the board must not rank a squad up as fast
// as beating something real.
export const RAID_PRESTIGE_JOIN_PER_BAND = 1 // 1..4 for taking part, win or lose
export const RAID_PRESTIGE_WIN_PER_BAND = 2 // 2..8 for winning it

// Rank thresholds over CUMULATIVE prestige, strongest first (the same
// descending shape as the bands above, read by the same first-match walk).
// Tuned so a squad raiding most turns reaches Seasoned mid-campaign and
// Legendary only by carrying the whole run (user, 2026-08-10 — deliberately the
// modest end of the options offered).
export const SQUAD_RANKS = [
  { min: 70, label: 'Legendary' },
  { min: 45, label: 'Renowned' },
  { min: 25, label: 'Seasoned' },
  { min: 10, label: 'Blooded' },
  { min: 0, label: 'Untested' },
]

// S4 "starve the enemy": the host's supply state is a PER-TURN BALANCE, not a
// stockpile — income ÷ consumption this turn, with no running total carried
// between turns (user, 2026-08-09: "either they have too much, enough or not
// enough … just turn by turn"). Bands are that ratio → the phrase the scouts
// report. The dead band around 1.0 keeps a mixed-ring draw from flickering
// between states on rounding alone.
// Pick a band's label for a value: the tables below are ordered high→low and
// every one ends at min 0, so the first match wins. Lives here, beside the band
// tables it reads, because it was previously defined privately in BOTH
// campaignView.js and raid.js — and S4 would have made it three copies.
export const bandLabel = (value, bands) => bands.find(({ min }) => value >= min).label

// Exactly ONE band grows the host and exactly ONE shrinks it; the middle is a
// deliberate no-op, not an unfinished third case (asked and confirmed
// 2026-08-09). Against a consumption of 7200 the three rings land one to a
// band by construction — near untouched 1.25 → grows, mid 1.00 → holds, far
// 0.75 → bleeds — so which ring the player has stripped the countryside to IS
// the enemy's supply state. Retune the ring yields and this mapping moves with
// them; that is intended.
export const ENEMY_SUPPLY_BANDS = [
  { min: 1.1, label: 'well-provisioned' }, // +ENEMY_REINFORCE_HEADCOUNT
  { min: 0.9, label: 'steady' }, // no change — the neutral middle
  { min: 0, label: 'near starving' }, // −ENEMY_DESERTION_HEADCOUNT
]

// The shadowing enemy host (hidden from the player; scouting reveals it).
export const ENEMY_ARMY = {
  Soldier: 540,
  Archer: 150,
  Necromancer: 11,
  LightCavalry: 20,
}
// How the host's numbers answer its supply state each turn (S4 v1, deliberately
// blunt): a surplus buys recruits, a deficit bleeds deserters, steady holds.
// Split across EVERY unit type in proportion to the host's composition, so
// feeding it does not quietly turn it into a different army.
//
// A FIXED headcount, deliberately NOT a percentage. The old 3%/5% rates
// compounded off the host's current size, so a host left well fed grew ~+34%
// over ten turns and grew FASTER the bigger it got — a difficulty curve nobody
// designed, and one that punished a slow campaign twice. Flat numbers make the
// pressure linear and legible: ten fed turns is ten times one fed turn, and
// stripping the rings is worth the same whenever you get round to it.
//
// Small, and ASYMMETRIC on purpose: starving a host is meant to be the more
// effective lever of the two. Hunger empties a camp faster than good rations
// fill it — men leave on their own, recruits have to be found, marched in and
// paid. So a fed host trickles upward and a starved one drains at twice that.
export const ENEMY_REINFORCE_HEADCOUNT = 5
export const ENEMY_DESERTION_HEADCOUNT = 10

// Daily food need per unit = size² × this (kg); a turn consumes 14 days of it.
// The square makes big mounts expensive: cavalry is a supply decision.
export const FOOD_KG_PER_SIZE_SQ_PER_DAY = 0.02

// When food is exhausted, this fraction of every roster line deserts per turn.
export const DESERTION_FRACTION = 0.1

// ── Foraging (S2 "effort slider" — docs/CAMPAIGN_PLAN.md) ────────────────────
// Foraging is passive now: there is no per-unit assignment or forager clash.
// The whole army's fieldPointsFor pool (utils/capabilities.js) is snapshotted
// once at newDay (campaign.forage.pool) and split by the player's slider
// (campaign.forage.share) between food/materials and scouting points.
//
// Distance rings around the shared camp area, in kg of gatherable food. No
// regrowth: ring depletion is the campaign clock — when the land is picked
// clean, somebody has to fight. Scaled up ~4× from the pre-slider numbers
// (decision 7: the old rings would strip in ~5 turns against foraging alone;
// this land should cover a whole 10–20 turn campaign even at a high forage
// share) — approximate/tunable, like FORAGE_KG_PER_POINT below.
export const FORAGE_RINGS = [80000, 140000, 220000] // near / mid / far
// One pool point gathers this many kg per turn. Calibrated (decision 6) so
// spending ~70% of the starting army's pool (≈1112 pts) on foraging roughly
// breaks even against its own consumption (≈12,432 kg/turn): 0.7 × 1112 ×
// 16 ≈ 12,454 kg gathered — feeding the army is the default burden, scouting
// is bought with hunger.
export const FORAGE_KG_PER_POINT = 16
// Harvest splits into rations and useful salvage (timber, iron, cordage).
export const FORAGE_FOOD_SHARE = 0.8
export const FORAGE_MATERIALS_SHARE = 0.2
// Distance yield penalty (decision 5): spilling into a farther ring nets less
// credit per kg physically swept — without forager clashes to contest them,
// the three rings would otherwise be one pool wearing three gauges.
export const FORAGE_RING_YIELD = [1.0, 0.8, 0.6] // near / mid / far
// The enemy's abstract per-turn drain on the shared rings (decision 4): no
// more enemy army composition, no contention, no clashes — it just eats land
// and gets no credit for it. Roughly the enemy's old forage-plan magnitude
// (~9,084 kg/turn at ENEMY_FORAGE_FRACTION 0.4 of its host), kept as a flat
// number now that nothing derives it from the hidden army.
export const ENEMY_DRAIN_KG_PER_TURN = 9000
// S4 "starve the enemy": what the host must find every turn to hold its
// strength. Defined AS the mid-ring take (drain × FORAGE_RING_YIELD[1] =
// 9000 × 0.8 = 7200), so the intended design falls out of the arithmetic
// instead of being tuned into it: the host forages the NEAR ring at a surplus
// (ratio 1.25), the MID ring exactly break-even (1.00), and the FAR ring at
// starvation (0.75). Derived, not a magic number — retuning the drain or the
// yield curve moves break-even along with it. MUST stay below both constants
// it reads (they are `const`, so referencing them earlier is a TDZ crash).
export const ENEMY_CONSUMPTION_KG_PER_TURN = ENEMY_DRAIN_KG_PER_TURN * FORAGE_RING_YIELD[1]
// The forage/scouting split's default and STICKY starting value (a fresh
// campaign's forage.share) — 10% steps, sticky across turns (decision 13).
// 0 (all-scouting) continues the pre-slider default exactly: the old
// forage.assignment started empty (nobody foraging) until the player chose
// otherwise, and every point of a 0-share pool flows to scouting just like
// the old unsplit scoutingPoints pool did.
export const DEFAULT_FORAGE_SHARE = 0

// ── Fortifications (materials sink, Stage 3) ─────────────────────────────────
// Fortifications are ABSTRACT LEVELS that wall the battle map at preset
// locations. Spending materials raises fortificationLevel; each level activates
// every preset side with tier ≤ level, walling a wider (and sturdier) span of
// the player's front deployment edge. The engine already applies the combat
// penalty for an attacker crossing a fortified side — the campaign only decides
// WHICH sides are fortified this battle (services/fortification.js).
export const FORTIFY_COST_BASE = 50 // cost to reach level N+1 = FORTIFY_COST_BASE × (N+1)
// Fortifications also cost labour: raising to level N+1 needs
// FORTIFY_WORKER_COST_BASE × (N+1) workers (L0→1 = 500, L1→2 = 1000). Workers
// are the off-map civilian pool (see STARTING_WORKERS); a raised level keeps
// them permanently (the works stand). Distinct from the materials cost — a
// fort needs both the stores and the hands.
export const FORTIFY_WORKER_COST_BASE = 500
export const FORTIFICATION_MAX_LEVEL = 2 // cap (levels 1–2 for now; strength scaling later)

// Ordered, tier-gated player-front hexsides per map. fortificationLevel = N
// activates every entry with tier ≤ N. Authored along the enemy-facing (south,
// higher-r) edge of the player deployment zone: on sample_battle the player
// zone is rows 0–7 and the enemy is at rows 22–29, so the front is row 7 and
// the two southern sides (SE/SW) of each front hex are the wall. The defended
// hex is the row-7 (player-side) hex. `durability` is inert for now (placeholder
// consumed by the later combat-score erosion step) — level 2 sides are sturdier,
// the "mostly coverage, a bit of strength" steer. Axial q at r=7 is visual
// col − 3, so q 4–5 is the center (cols 7–8); tier 2 widens to cols 5–10.
export const FORTIFICATION_PRESETS = {
  sample_battle: [
    // tier 1 — short center span
    { q: 4, r: 7, dir: 'SE', tier: 1, durability: 100 },
    { q: 4, r: 7, dir: 'SW', tier: 1, durability: 100 },
    { q: 5, r: 7, dir: 'SE', tier: 1, durability: 100 },
    { q: 5, r: 7, dir: 'SW', tier: 1, durability: 100 },
    // tier 2 — widens the span, sturdier works
    { q: 2, r: 7, dir: 'SE', tier: 2, durability: 160 },
    { q: 2, r: 7, dir: 'SW', tier: 2, durability: 160 },
    { q: 3, r: 7, dir: 'SE', tier: 2, durability: 160 },
    { q: 3, r: 7, dir: 'SW', tier: 2, durability: 160 },
    { q: 6, r: 7, dir: 'SE', tier: 2, durability: 160 },
    { q: 6, r: 7, dir: 'SW', tier: 2, durability: 160 },
    { q: 7, r: 7, dir: 'SE', tier: 2, durability: 160 },
    { q: 7, r: 7, dir: 'SW', tier: 2, durability: 160 },
  ],
}

// ── Workers (civilian labour pool, off the campaign map) ─────────────────────
// A finite workforce that fortifications and Recruit hires both draw on.
// Tracked as total + used; available = total − used. Fort labour raises `used`
// — the worker is still around, just permanently busy maintaining the works.
// A hire is different: those workers LEAVE the civilian pool entirely to
// become roster soldiers, so hiring decrements `total` instead (see applyHire
// in services/recruit.js). Neither
// direction replenishes yet (events / growth is a later SSOT run; see
// docs/CAMPAIGN_PLAN.md item 5). Deliberately large relative to the fighting
// roster. NOTE: the planned "workers eat food at 1/3 upkeep" step is
// intentionally NOT wired yet — at this pool size it would dwarf army upkeep;
// it waits on the replenishment design.
export const STARTING_WORKERS = 2000

// ── Recruit phase (docs/CAMPAIGN_PLAN.md "Recruit phase — hiring troops") ────
// One hire per day: the phase offers up to 2 eligible+affordable options from
// services/recruit.js's RECRUIT_POOL, the player picks one (or gets the free
// Militia fallback below if nothing is affordable). This REPLACED the old
// MILITIA_* purchase constants (removed in S4) — Militia is the base tier of
// RECRUIT_POOL now, not its own mechanic.
export const RECRUITING_FERVOR_START = 0
// A boosted troop-lane hire that CAN afford double pays double for double the
// count; one that can't gets this fraction knocked off the normal cost for
// the normal count instead. Same ratio drives the caster-lane fallback (a
// discount on the single hire when the bonus second hire isn't affordable).
export const RECRUIT_BOOST_DISCOUNT = 0.3
// Granted automatically, no choice shown, on a day where nothing in the pool
// is affordable — keeps a stalled economy from being unable to recruit at all.
export const FREE_MILITIA_AMOUNT = 5

// Near-annihilation win: once the enemy host drops below this fraction of its
// starting strength it melts away and you take the country (checked directly in
// services/dayResolution.js end conditions — the ambient path, independent of
// the boss-fight meter).
export const ENEMY_WITHDRAW_FRACTION = 0.2 // withdraws (you win) below this strength

// ── Boss-fight meter (roguelite campaign loop) ───────────────────────────────
// Hidden per-campaign counter, 0 → BOSS_FIGHT_METER_THRESHOLD. Fills at
// end-of-day by CEILING − FLOOR × (troopsInCamp / totalRoster): everyone
// raiding/foraging fills it fastest (CEILING/turn), everyone held back in
// camp fills it slowest (FLOOR/turn) — see services/meter.js. Crossing the
// threshold sets campaign.bossFightDue; the decisive fight is due the NEXT
// day (see docs/CAMPAIGN_PLAN.md "Boss-fight campaign loop").
export const BOSS_FIGHT_METER_THRESHOLD = 1000
export const BOSS_FIGHT_METER_FLOOR = 50
export const BOSS_FIGHT_METER_CEILING = 100
// Banded phrase (mirrors ENEMY_SUPPLY_BANDS) — the meter's level-0 form on the
// wire (recon R2 adds a numeric estimate above that). Narratively this is the
// state of Karrowgate's walls under the enemy's assault: the meter climbing 0→
// threshold IS the walls going from intact to breached (the frontend renders it
// as a DRAINING integrity gauge). Also the single signal for the enemy's
// disposition: the reveal/council flavor is derived from this band plus
// bossFightDue (intact/damaged/breached, then the pitched battle once the walls
// are breached) — one banded signal, no separate stance machine.
export const METER_BANDS = [
  { min: 667, label: 'breached' },
  { min: 334, label: 'damaged' },
  { min: 0, label: 'intact' },
]

// ── Garrison Resolve (docs/CAMPAIGN_PLAN.md "Garrison-support epic") ─────────
// Standing between your relief army and Karrowgate's besieged garrison, a
// 0..100 track (campaign.garrison.resolve). Cooperation events AWARD it (the
// `garrison` effect); it's read as an event GATE (requires minResolve/maxResolve,
// events.js eventEligible), it slows the wall meter (the passive centerpiece,
// slice 2), and it drives the pitched-battle sally support (S5→S7). The S5
// redesign (2026-07-24): the garrison is now SHOWN as a visible HUD gauge — a
// proportional bar + one of three LEVEL words (garrisonLevel, services/
// garrison.js) — since you're in signalling contact with them; only the raw
// integer stays hidden. And resolve at/under the surrender floor ends the
// campaign: the garrison opens Karrowgate's gates (a second loss condition,
// independent of the walls meter — checked in dayResolution).
export const GARRISON_RESOLVE_MIN = 0
export const GARRISON_RESOLVE_MAX = 100
export const GARRISON_RESOLVE_START = 45
// At/under this the garrison surrenders and the campaign is LOST (dayResolution
// step 6), regardless of the walls. Neglect the relationship and Karrowgate
// falls before the walls ever breach. Tunable; the clamp floor is the MIN above.
export const GARRISON_SURRENDER_FLOOR = 0
// Slice 2 — the passive wall-slow (the centerpiece: this is the ONE lever the
// player has to push the breach back). A heartened, coordinated garrison holds
// Karrowgate's walls better, so the boss-fight meter (the walls under assault)
// fills more slowly: the day's fill is reduced by wallSlowFactor(resolve) ∈
// [0, GARRISON_WALL_SLOW_MAX], linear in resolve (services/garrison.js). Capped
// well below 1 so even a devoted garrison can't freeze the clock outright — the
// walls always give a little each turn (the floor kept honest, per the design).
export const GARRISON_WALL_SLOW_MAX = 0.4
// Band-cross decay: when the walls are battered into a worse damage band
// (METER_BANDS: intact→damaged→breached), the garrison feels abandoned and
// their resolve slips this much (hidden, like the `garrison` effect — the
// player reads only the band word dropping). Tunable; balance stays rough.
export const GARRISON_BAND_CROSS_DECAY = 10
// The sally (payoff 2). At the decisive pitched battle a garrison that trusts
// you sorties from Karrowgate's gates. GRADUATED by level (S7): the garrison's
// men enter the fight as allied reinforcements storming the enemy's rear — the
// casterless auto-cast spell (S6), fed via BattleInput's `reinforcements`. The
// count is keyed on garrisonLevel: low sends no one, normal some, determined
// more. All tunable; balance stays rough.
//   - GARRISON_SALLY_TROOPS: units the garrison commits, by level.
//   - GARRISON_SALLY_TICK: the turn they arrive at the enemy rear.
//   - GARRISON_SALLY_UNIT: what they field (foot for now).
//   - GARRISON_SALLY_TEAM: 2 = BLUETEAM, the player's side (engine Defines.hpp).
//   - GARRISON_SALLY_BATTLE_MESSAGE: the replay log line the sally prints (the
//     engine keeps campaign fiction out of itself and logs whatever we pass).
export const GARRISON_SALLY_TROOPS = { low: 0, normal: 40, determined: 80 }
export const GARRISON_SALLY_TICK = 4
export const GARRISON_SALLY_UNIT = 'Soldier'
export const GARRISON_SALLY_TEAM = 2
export const GARRISON_SALLY_BATTLE_MESSAGE =
  "Karrowgate's garrison throws open its gates — allies storm the enemy's rear!"
// The determined-level floor (67). Retained as the `garrisonSallies` predicate's
// threshold (services/garrison.js) — "is the garrison determined?"; the sally
// itself is now graduated via GARRISON_SALLY_TROOPS above.
export const GARRISON_SALLY_THRESHOLD = 67
// The three garrison LEVELS shown to the player (S5 redesign — replaces the old
// faltering/wary/steadfast/devoted bands). Descending {min, label} (same
// convention as METER_BANDS). 0 is the surrender floor (campaign lost), so the
// `low` band nominally covers 1..33, `normal` 34..66, `determined` 67..100; a
// resolve of 0 reads `low` for the brief moment before dayResolution ends it.
export const GARRISON_BANDS = [
  { min: 67, label: 'determined' },
  { min: 34, label: 'normal' },
  { min: 0, label: 'low' },
]

// ── THE MAGIC SYSTEM, SLICE 2 (docs/CAMPAIGN_PLAN.md "▶ SLICE 2 — THE CAMPAIGN
// LAYER") ────────────────────────────────────────────────────────────────────
//
// The engine's vocabulary, repeated here because the campaign layer has to name
// a path and a school to send one. Kept in the ENGINE'S SPELLING (lowercase,
// backend/engine/src/SpellList.cpp kPathNames/kSchoolNames): these strings go
// out on the wire and a mismatch is skipped in silence at the JSON boundary, so
// the only safe copy is a verbatim one. tests/magic.test.js pins them against
// `./game info`'s catalog the same way dice.test.js pins the exploding d6.
export const SPELL_PATHS = [
  'fire', 'earth', 'water', 'air', 'high', 'low', 'nature', 'death', 'holy', 'unholy',
]
export const SPELL_SCHOOLS = ['evocation', 'conjuration', 'enchantment', 'construction']

// The player's words for them — the campaign layer phrases everything the
// client renders (17-5), so "Fire 2 · Water 1" is composed server-side from
// this map rather than by a client that would have to hold a copy of it.
export const SPELL_PATH_TEXT = {
  fire: 'Fire', earth: 'Earth', water: 'Water', air: 'Air', high: 'High',
  low: 'Low', nature: 'Nature', death: 'Death', holy: 'Holy', unholy: 'Unholy',
}
export const SPELL_SCHOOL_TEXT = {
  evocation: 'Evocation', conjuration: 'Conjuration',
  enchantment: 'Enchantment', construction: 'Construction',
}

// S2-3: the EIGHT paths a hire's roll may draw from. Holy is out because a
// Priest is the Holy lane and it is flat (S2-4); Unholy is out because M-14
// leaves the player's Unholy a Low-style bargain or a dark event, never a hire.
export const HIRE_PATH_POOL = SPELL_PATHS.filter((p) => p !== 'holy' && p !== 'unholy')

// S2-3: a primary at level 2, then ONE 25% check. A new path enters at 1; a
// repeat is +1, so Fire 2 becomes Fire 3 — the only way a fresh hire reaches
// the majors' level-3 gate, which is what makes the check worth wanting. Not a
// repeating loop: the user chose the single check, so there is no lottery tail.
export const HIRE_PRIMARY_LEVEL = 2
export const HIRE_SECOND_PATH_PERCENT = 25

// A caster type whose path is DECLARED by what they are rather than drawn
// (S2-4, extended to the Necromancer by S2-14). A Priest is Holy because
// priesthood is formal; a necromancer is Death because that is the craft he
// practises. Everything else — the Mage lane — rolls its primary out of the
// pool above, and that difference IS the gamble the two lanes trade.
export const DECLARED_CASTER_PATH = { Priest: 'holy', Necromancer: 'death' }

// …and which of those declared types still takes the 25% check (S2-14). The
// Priest does NOT: S2-4 makes priesthood flat and certain, and that certainty
// is the whole of what the Priest lane offers against the Mage lane's gamble.
// The Necromancer DOES, because necromancy is skill and not an ordination —
// which is also what lets the occasional enemy raiser reach the major form.
export const DECLARED_CASTERS_ROLL_SECOND = ['Necromancer']

// S2-7 (bd): what one living Mage studies per turn, and what level `n` costs.
// Three Mages therefore open a school at the end of turn 1 (3 × 10 = 30) and
// reach the majors' level 3 around turn 6 (30 + 60 + 90 = 180 at 30/turn).
// Levels run to 9 like paths — act one reaching only the low end is headroom,
// not dead range (M-16).
export const RESEARCH_POINTS_PER_MAGE = 10
export const RESEARCH_LEVEL_COST = 30
export const RESEARCH_MAX_LEVEL = 9

// S2-2: a fresh campaign starts with ALL FOUR SCHOOLS AT 0, so the three
// starting Mages can cast nothing on day 1 while the three Priests bless from
// the first battle (Holy carries no school gate, M-14). The dead first turn is
// deliberate; if it reads badly the lever is RESEARCH_LEVEL_COST, not this.
export const RESEARCH_START_LEVEL = 0

// The school the focus points at before the player has said anything. Something
// has to be there for turn 1 to accrue into, and unlike a free LEVEL (which
// S2-2 rejected for exactly this reason) a default focus declares nothing and
// costs nothing: it is re-settable for free in `prepare`, before any battle,
// and moving it parks no progress (S2-7).
export const RESEARCH_DEFAULT_FOCUS = 'evocation'

// S4-5 (bd): how many spells a caster may be given to reach for first.
//
// A cap on EXPRESSION, not on power — S4-1 keeps the rest of the roster
// available behind the chosen ones, so a fourth choice would add reach, never
// strength. Three is small enough that picking is a decision and large enough
// that a developed caster has something to say; early on he will not have three
// castable spells to fill it with, which is the intended shape.
export const MAX_CHOSEN_SPELLS = 3

// S2-8 (bd): the channel a banner tier is worth, army-wide (M-11) — the basic
// banner's long-deferred benefit (decision 16) finally made concrete. Keyed by
// services/items.js bannerTier(), so a retuned rank ladder moves these with it.
export const CHANNELS_BY_BANNER_TIER = { plain: 0, basic: 1, item: 2 }

// S2-9 (bd): what the shadowing host knows, as ONE sealed number per encounter.
// Conjuration 2 is what keeps their eleven Necromancers raising skeletons while
// the player starts at nothing — the story M-6's fluff already tells. The host
// never reacts to anything; a later act simply authors higher numbers, which is
// the dial M-19 asked for.
export const ENEMY_SCHOOLS = {
  evocation: 1, conjuration: 2, enchantment: 1, construction: 0,
}
// S2-9 (bd): the host's army-wide channel pool. A flat number rather than a
// tier lookup, because the enemy has no banners and no charters to hang them on.
export const ENEMY_CHANNELS = 3
