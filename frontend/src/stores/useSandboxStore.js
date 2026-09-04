import { create } from 'zustand'

// THE BATTLE LAB's client state (docs/CAMPAIGN_PLAN.md, "TEST / SANDBOX MODE",
// slice S1). A store of its own rather than a corner of usePlacementStore,
// because the lab is FREE-STANDING (SB-1): it composes two armies from the full
// engine catalog with no campaign anywhere in the picture, while the placement
// store's every value is budgeted against a campaign roster it does not have.
// Sharing one would have meant teaching that store to be campaign-less, which
// is the abstraction SB-4 explicitly declined to build.
//
// Nothing here is persisted server-side (SB-11): a lab setup is browser state,
// and the JSON export/import that makes one shareable (S3, in stores/flows.js)
// is a file the browser writes, not a document a collection holds. Which means
// THIS STORE IS THE SCENARIO — what the export serialises and what the import
// rebuilds, through the setters below and never around them.

export const SIDES = ['blue', 'red']

// A side's magic block (D1). BOTH sides get one, not just the enemy: SB-8 names
// the enemy because that was the ask, but the lab composes both armies (SB-1)
// and "anything goes" is per side (SB-5).
//
// THE DEFAULT REPRODUCES TODAY'S BEHAVIOUR EXACTLY. Every school at 9 is the
// engine's `SPELL_SCHOOL_OPEN_DEFAULT` — what a side sits at when a BattleInput
// carries no magic block at all — and the pool starts at 0 for the same reason.
// So the lab starts OPEN and VISIBLE rather than starting silently open and
// closing the moment the player touches a spinner. A literal, so the store is
// usable before the reference fetch lands; setReference fills in any school
// this list does not know about, and never overwrites a level already set.
const OPEN_SCHOOL_LEVEL = 9
const openMagic = () => ({
  schools: {
    evocation: OPEN_SCHOOL_LEVEL,
    conjuration: OPEN_SCHOOL_LEVEL,
    enchantment: OPEN_SCHOOL_LEVEL,
    construction: OPEN_SCHOOL_LEVEL,
  },
  channels: 0,
})

// One side's slate. `army` is what has been composed ({type: count}); the
// `placements` are where those bodies stand ({type, col, row, count}, plus S2's
// optional per-body `casters`); `magic` is what that side's school levels and
// channel pool are. Army and placements are SEPARATE on purpose, exactly as a
// campaign's roster and deployment are: an army composed but not placed is a
// mistake worth being able to see, and auto-place is the button that turns one
// into the other.
// R2's addition: `squads` are the side's SHEETS (D-R2-1) — a company's identity
// (name, archetype, prestige, composition, attached casters, upgrades, banner),
// with no coordinates on it. A sheet's BODIES are ordinary placement entries
// carrying its `squadId`, written by placeSquad below, because one company is
// one block on one hex (the engine groups a formation by hex + squad_id) and
// the campaign places a charter exactly that way.
//
// `nextSquadId` is per SIDE and never goes backwards: an id is what a placement
// entry points at, so reusing one would silently re-badge bodies that belonged
// to a company the player deleted.
const emptySide = () => ({
  army: {}, placements: [], magic: openMagic(), squads: [], nextSquadId: 1,
})

// A fresh sheet's defaults — everything a company can be before anything is
// typed into it. `banner: null` rather than absent, so the picker has a value
// to sit on; `attached` is caster types only (they sit OUTSIDE the archetype's
// caps, as characters do, and inside the hex).
const emptySquad = (id) => ({
  id,
  name: `Company ${id}`,
  archetype: '',
  prestige: 0,
  composition: {},
  attached: {},
  upgrades: [],
  banner: null,
})

// A sheet's bodies as {type, count} rows — its composition plus its attached
// casters, merged by type so a type named twice is one stack rather than two on
// the same hex. This is the ONE place a sheet becomes bodies; the launch, the
// auto-place request and the placement below all read it, so what the server is
// asked to place and what the grid draws can never disagree.
export const squadBodies = (sheet) => {
  const bodies = new Map()
  for (const bag of [sheet?.composition, sheet?.attached])
    for (const [type, count] of Object.entries(bag ?? {})) {
      const n = Math.max(0, Math.floor(Number(count) || 0))
      if (n > 0) bodies.set(type, (bodies.get(type) ?? 0) + n)
    }
  return [...bodies.entries()].map(([type, count]) => ({ type, count }))
}

// One caster BODY's configuration (SB-6, D2). Every half defaults EMPTY, and
// empty means ABSENT ON THE WIRE — which is the engine's own default: no
// `script` is the default walk (SB-7/E-3), and no `paths` leaves the engine's
// constructor seeding alone, so a Mage the player never opened still walks in
// with his Fire 1. That is what lets "default to what the game would choose by
// itself, override from there" need no new concept.
//
// AI-3 adds the SHORTLIST (L-1), beside the script because it is the script's
// sibling — what he reaches for once the opening sequence has run out (A-7) —
// and it keeps the same absence rule for a stronger reason than the others: an
// empty shortlist is not a mute caster but the WHOLE castable roster, so a `[]`
// on the wire would say the one thing the player cannot mean by leaving the
// checklist alone.
const emptyCaster = () => ({ paths: {}, script: [], shortlist: [] })

// A stack's caster list, trimmed to the bodies that actually exist. Called
// wherever a count can shrink: a config left behind for a body that is no
// longer on the field would be silently re-attached the next time the stack
// grew, which is the one way this store could lie about who is scripted.
const trimCasters = (casters, count) => (casters ?? []).slice(0, Math.max(0, count))

const initialState = () => ({
  // Which side the palette and the grid are editing. The lab places BOTH
  // armies by hand (SB-3), and one control at a time is what keeps a click on
  // a hex unambiguous — the alternative (infer the side from the zone) makes
  // the two zones mean different things and offers nowhere to stand for a
  // future map whose zones touch.
  side: 'blue',
  blue: emptySide(),
  red: emptySide(),
  selectedHex: null,
  // The full engine catalog (/api/units), fetched once when the lab opens —
  // EVERY type, including the ones no player can recruit, because composing
  // the hypothetical enemy is half of what the lab is for.
  catalog: [],
  // The lab's static vocabulary from /api/sandbox/reference — paths, schools,
  // caster types, SB-8's preset and the spinner bounds — or null until the
  // fetch lands. Server-phrased (17-5): the lab names no path itself.
  reference: null,
  // The answer to the last "what could THIS body cast" question (D3), kept with
  // the key it was asked for so a reply that arrives after the player has moved
  // on is dropped rather than shown against the wrong caster.
  castable: { key: null, options: [] },
  // The same shape one field over (R2): what THIS company may field per type,
  // answered by POST /squad-caps. The sheet asks, it does not work the rules
  // out — squadCaps resolves the archetype row THROUGH the upgrades, and a
  // client-side copy would drift the first time an effect kind is added.
  squadCaps: { key: null, caps: {} },
  // The engine's per-hex capacity, stamped by the screen off `./game info`. The
  // store needs it to answer "does this block still fit where it stands" in ONE
  // place — the button that offers to place a company and the re-sync that
  // follows an edit to it must not measure a hex differently. Null until the
  // screen says, and a null capacity fences nothing: the server is the fence
  // that cannot be bypassed.
  hexCapacity: null,
  launching: false,
  // The summary of the battle just launched, or null. The lab holds only the
  // latest — which is also all the server keeps (SB-12).
  battle: null,

  // ── S3's two launch numbers and the answer they produce (SB-10) ──────────
  //
  // How many battles one launch fights. One is what every launch meant before
  // S3, so a player who never touches the spinner sees exactly the lab he had.
  runs: 1,
  // The fixed GAME_RNG_SEED, or null for a fresh draw.
  //
  // STORED AS A STRING WHEN THERE IS ONE, and as null when there is not — the
  // field is a text box and "" is not a seed, so the empty state has to be
  // representable as something other than a number. Sanitising happens once, on
  // send (flows.js), which is also what the export writes: the store keeps what
  // the player typed and the wire gets an integer or nothing.
  seed: null,
  // The batch aggregate the last launch came back with — {runs, requested,
  // seed, wins, averageSurvivors, incomplete?} — or null before the first one.
  // The server sends it on every launch, a batch of one included, so the
  // readout needs no special case for the common launch.
  batch: null,

  // ── S4's two extras (SB-9) ──────────────────────────────────────────────
  //
  // A WALL BELONGS TO THE FIELD, NOT TO A SIDE (F1). `fortified_sides` is a
  // property of the battle rather than of an army — a rampart stands where it
  // stands and both armies meet it — so this is ONE list for the scenario,
  // edited whichever side the palette happens to be on, unlike the armies,
  // placements and magic above. Entries are {q, r, dir, durability}, and
  // `durability: null` means "whatever the engine puts there itself", which is
  // sent as no durability at all.
  walls: [],
  // The scheduled waves, {side, unit_type, count, tick, message}. NAMED PER
  // SIDE (F3): the lab speaks blue and red like every other part of it, and the
  // route turns that into the engine's team integer — the client never holds a
  // team number. Scenario-level for the same reason the walls are: one wave
  // list carries both sides' arrivals, each row saying whose it is.
  reinforcements: [],
})

const useSandboxStore = create((set, get) => ({
  ...initialState(),

  setSide: (side) => set({ side, selectedHex: null }),
  setCatalog: (catalog) => set({ catalog }),

  // Take the fetched vocabulary, and fill in any school the literal default
  // above does not know about — MISSING KEYS ONLY. A level the player has
  // already moved is his, and a fetch landing late must not walk it back.
  setReference: (reference) =>
    set((s) => {
      const open = reference?.limits?.openSchoolLevel ?? OPEN_SCHOOL_LEVEL
      const fromReference = Object.fromEntries(
        (reference?.schools ?? []).map((school) => [school.key, open]),
      )
      const filled = (side) => ({
        ...s[side],
        magic: { ...s[side].magic, schools: { ...fromReference, ...s[side].magic.schools } },
      })
      return { reference, blue: filled('blue'), red: filled('red') }
    }),

  setCastable: (key, options) => set({ castable: { key, options } }),

  setSquadCaps: (key, caps) => set({ squadCaps: { key, caps } }),

  setHexCapacity: (hexCapacity) => set({ hexCapacity }),

  setSelectedHex: (selectedHex) => set({ selectedHex }),
  setLaunching: (launching) => set({ launching }),
  setBattle: (battle) => set({ battle }),

  // Whole runs only, never below one: a launch of zero battles is not a thing
  // to ask for. The CEILING is the server's (limits.maxRuns), applied by the
  // spinner that reads it, so the store never invents a bound of its own.
  setRuns: (runs) => set({ runs: Math.max(1, Math.floor(Number(runs)) || 1) }),

  // What the player typed, or null for "no seed". A blank field is the absence,
  // not the number zero — seed 0 is a perfectly good seed, and the two have to
  // be tellable apart.
  setSeed: (seed) => set({ seed: seed === null || String(seed).trim() === '' ? null : String(seed) }),

  setBatch: (batch) => set({ batch }),

  // Paint or unpaint one hexside. A TOGGLE, because that is what painting is:
  // the same click that raised a rampart takes it down again, and there is no
  // state in between for a separate "remove" to be about. New paint carries
  // NULL durability — the engine's own DEFAULT_FORT_DURABILITY, asked for by
  // saying nothing (the absence rule this store keeps everywhere else) — and
  // the durability control below is how a wall becomes sturdier than that.
  toggleWall: (q, r, dir) =>
    set((s) => {
      const at = (w) => w.q === q && w.r === r && w.dir === dir
      return s.walls.some(at)
        ? { walls: s.walls.filter((w) => !at(w)) }
        : { walls: [...s.walls, { q, r, dir, durability: null }] }
    }),

  // What one painted side can take before it falls. Null (an emptied field) is
  // the engine's own default rather than zero — a wall at 0 is a work that
  // falls to the first blow, which is a different statement from not having
  // said anything.
  setWallDurability: (q, r, dir, durability) =>
    set((s) => ({
      walls: s.walls.map((w) =>
        (w.q === q && w.r === r && w.dir === dir ? { ...w, durability } : w)),
    })),

  // Replace the whole list — what the scenario import applies and what Clear
  // empties, the same wholesale contract setPlacements holds for a side.
  setWalls: (walls) => set({ walls }),

  // One more wave, at the end of the list. Order is not priority here (each row
  // carries its own tick), but appending is what keeps a row where the player
  // put it while he edits the one above.
  addReinforcement: (wave) => set((s) => ({ reinforcements: [...s.reinforcements, wave] })),

  // Merge a patch into the `index`-th wave. Merged rather than replaced so the
  // five fields are edited independently, exactly as a caster's paths and
  // script are.
  setReinforcement: (index, patch) =>
    set((s) => ({
      reinforcements: s.reinforcements.map((w, i) => (i === index ? { ...w, ...patch } : w)),
    })),

  removeReinforcement: (index) =>
    set((s) => ({ reinforcements: s.reinforcements.filter((_, i) => i !== index) })),

  setReinforcements: (reinforcements) => set({ reinforcements }),

  // Compose: how many of `type` this side fields. Zero removes the row rather
  // than leaving a 0 behind, so `army` reads as the list it is.
  setArmyCount: (side, type, count) =>
    set((s) => {
      const army = { ...s[side].army }
      if (count > 0) army[type] = count
      else delete army[type]
      return { [side]: { ...s[side], army } }
    }),

  // Place `count` of `type` on one hex for this side. Zero clears that type
  // from that hex — the same set-to-zero-to-remove contract HexGrid's own
  // handlePlace uses, so the two grids behave identically under the hand.
  //
  // A SHRINKING STACK DROPS THE CONFIGS IT NO LONGER HAS BODIES FOR, and
  // clearing it drops them all: `casters[i]` configures the i-th body (D2), so
  // an index past the count configures nobody. Keeping one would let it come
  // back to life — and silently script a different man — the next time the
  // stack grew.
  //
  // LOOSE ENTRIES ONLY (D-R2-1). A company's bodies stand on the same hexes as
  // everyone else's and may share a type with them, but they are edited through
  // their SHEET and nowhere else — a spinner that could reach them would let
  // the hex menu field a company its own composition does not describe.
  place: (side, col, row, type, count) =>
    set((s) => {
      const isLoose = (p) => p.col === col && p.row === row && p.type === type && p.squadId == null
      const here = s[side].placements.find(isLoose)
      const rest = s[side].placements.filter((p) => !isLoose(p))
      if (count <= 0) return { [side]: { ...s[side], placements: rest } }

      const casters = trimCasters(here?.casters, count)
      return {
        [side]: {
          ...s[side],
          placements: [
            ...rest,
            {
              type, col, row, count,
              ...(casters.length > 0 ? { casters } : {}),
              // AI-3's `value` (L-2) is a fact about the STACK rather than
              // about any one body, so it survives a count being raised or
              // lowered exactly as the caster configs do — re-typing the
              // spinner is not a statement about what these men are worth.
              ...(here?.value == null ? {} : { value: here.value }),
            },
          ],
        },
      }
    }),

  // What every body of this stack is worth to the OTHER side's casting AI
  // (A-5/L-2), which is why it sits on the stack rather than on a body: it is
  // the same statement about each of them, and typing it once per stack is what
  // makes "give the enemy mage something worth shooting at" one number rather
  // than N. Set on EVERY unit type, not just casters — the well-kitted man A-5
  // wants sometimes noticed is as readily a Golem as a Mage.
  //
  // Null (an emptied box) is the engine's own catalog default, asked for by
  // saying nothing — the absence rule this store keeps for the wall durability
  // and every caster field, and the reason the field is cleared rather than
  // zeroed: a body worth 0 is not a thing the engine has a meaning for.
  setStackValue: (side, { col, row, type, squadId = null }, value) =>
    set((s) => ({
      [side]: {
        ...s[side],
        placements: s[side].placements.map((p) => {
          if (!(p.col === col && p.row === row && p.type === type)) return p
          if ((p.squadId ?? null) !== squadId) return p
          // Cleared by REMOVING the key, never by setting it to null: the
          // launch reads absence off the stack, and a `value: null` would ride
          // out as a number the engine cannot use.
          const cleared = { ...p }
          delete cleared.value
          return value === null || value === undefined ? cleared : { ...cleared, value }
        }),
      },
    })),

  // Configure the `index`-th BODY of one caster stack (SB-6: individually, not
  // per type — the mechanics this was asked for, the second caster fizzling and
  // the duplicate-script warning, only appear when two casters on the same side
  // differ). `patch` is merged, so paths and script are set independently.
  //
  // R2 widens the ADDRESS by one field: a company's attached Mage and a loose
  // Mage may stand on the same hex, and they are two different men. `squadId`
  // defaults to null on both sides of the comparison, so every caller written
  // before companies existed still addresses the loose stack it meant.
  setCasterConfig: (side, { col, row, type, squadId = null }, index, patch) =>
    set((s) => ({
      [side]: {
        ...s[side],
        placements: s[side].placements.map((p) => {
          if (!(p.col === col && p.row === row && p.type === type)) return p
          if ((p.squadId ?? null) !== squadId) return p
          // No body, no config: an index past the stack is a stale row in a
          // panel the player has already shrunk out from under.
          if (index < 0 || index >= p.count) return p
          const casters = trimCasters(p.casters, p.count)
          while (casters.length <= index) casters.push(emptyCaster())
          casters[index] = { ...casters[index], ...patch }
          return { ...p, casters }
        }),
      },
    })),

  // A side's school levels and channel pool (D1). Clamped by the server, which
  // is where the engine's scale is written; the spinner's own max comes off the
  // reference so the two cannot disagree.
  setSchoolLevel: (side, school, level) =>
    set((s) => ({
      [side]: {
        ...s[side],
        magic: { ...s[side].magic, schools: { ...s[side].magic.schools, [school]: level } },
      },
    })),

  setChannels: (side, channels) =>
    set((s) => ({ [side]: { ...s[side], magic: { ...s[side].magic, channels } } })),

  // SB-8: load the REAL host's numbers as a starting point. Offered on either
  // side rather than only on red — the host's sealed levels are as good a
  // baseline for "what if my own army were this poor" as for the enemy, and the
  // preset is a starting point wherever the player wants it. A no-op before the
  // reference has landed: there is nothing yet to load.
  loadEnemyPreset: (side) =>
    set((s) => {
      const preset = s.reference?.enemyPreset
      if (!preset) return {}
      return {
        [side]: {
          ...s[side],
          magic: { schools: { ...s[side].magic.schools, ...preset.schools }, channels: preset.channels },
        },
      }
    }),

  // Replace one side's placements wholesale — what auto-place returns, and what
  // Clear empties. Auto-place OVERWRITES rather than merges: it is an answer to
  // "where does this whole army go", and a merge would silently overstack the
  // hexes the player had already filled by hand.
  //
  // WHICH MEANS AUTO-PLACE DISCARDS CASTER CONFIGS, deliberately. Same contract:
  // it answers where the WHOLE army goes, so the placements it returns are the
  // whole answer, and a config from the old layout belongs to a body that is no
  // longer standing where it stood. Configure the casters after the spread, not
  // before it.
  //
  // R2 KEEPS THE COMPANIES THROUGH IT (D-R2-4), and the way it keeps them is
  // that the spread now ANSWERS with them: the auto-place route places each
  // block first (one company, one hex) and scatters the loose army around them,
  // so the list handed here already carries every squad body with its tag.
  // Preserving them here instead would double every block the server just laid.
  setPlacements: (side, placements) => set((s) => ({ [side]: { ...s[side], placements } })),

  clearPlacements: (side) => set((s) => ({ [side]: { ...s[side], placements: [] }, selectedHex: null })),

  // ── R2: the companies (docs/CAMPAIGN_PLAN.md, R-7 / D-R2-1) ──────────────
  //
  // A SHEET plus a BLOCK. The sheet is what the company IS and lives in
  // `squads`; the block is its bodies, written into `placements` as ordinary
  // entries carrying `squadId`. Nothing else in this store treats those entries
  // specially except by excluding them from the LOOSE budget, because to the
  // grid and to the hex's capacity a company body is a body like any other.

  // Enrol a company. The sheet is prefilled from a catalog charter or blank,
  // and its id is allocated here so nothing outside the store can invent one.
  addSquad: (side, sheet = {}) =>
    set((s) => {
      const id = s[side].nextSquadId
      return {
        [side]: {
          ...s[side],
          squads: [...s[side].squads, { ...emptySquad(id), ...sheet, id }],
          nextSquadId: id + 1,
        },
      }
    }),

  // Merge a patch into one sheet, then RE-SYNC its block if it has one: the
  // bodies on the field are the composition, so an edit that does not reach
  // them would leave the sheet and the block describing different companies.
  //
  // A BLOCK THAT NO LONGER FITS ITS HEX IS UNPLACED rather than half-written or
  // silently overstacked — one company, one hex is the invariant, and the sheet
  // then reads "not placed" so the player can put it somewhere it fits.
  setSquad: (side, id, patch) => {
    set((s) => ({
      [side]: {
        ...s[side],
        squads: s[side].squads.map((q) => (q.id === id ? { ...q, ...patch } : q)),
      },
    }))
    const state = get()
    const standing = state[side].placements.find((p) => p.squadId === id)
    if (!standing) return
    if (state.squadFits(side, id, standing.col, standing.row))
      state.placeSquad(side, id, standing.col, standing.row)
    else state.unplaceSquad(side, id)
  },

  // Off the rolls entirely, block and all. The id is NOT returned to the pool:
  // `nextSquadId` only ever climbs, so a later company can never inherit the
  // tag a placement entry might still be pointing at.
  removeSquad: (side, id) =>
    set((s) => ({
      [side]: {
        ...s[side],
        squads: s[side].squads.filter((q) => q.id !== id),
        placements: s[side].placements.filter((p) => p.squadId !== id),
      },
    })),

  // Put the company on one hex: one entry per type, all tagged, and its old
  // entries dropped first — so placing again MOVES the block rather than
  // cloning it. Caster configs on the surviving bodies are carried across and
  // trimmed exactly as `place` trims them, since the i-th attached Mage of a
  // company is the same man before and after the composition below him changed.
  placeSquad: (side, id, col, row) =>
    set((s) => {
      const sheet = s[side].squads.find((q) => q.id === id)
      if (!sheet) return {}
      const held = new Map(
        s[side].placements
          .filter((p) => p.squadId === id)
          .map((p) => [p.type, { casters: p.casters, value: p.value }]),
      )
      const rest = s[side].placements.filter((p) => p.squadId !== id)
      const block = squadBodies(sheet).map(({ type, count }) => {
        const casters = trimCasters(held.get(type)?.casters, count)
        const worth = held.get(type)?.value
        return {
          type, col, row, count, squadId: id,
          ...(casters.length > 0 ? { casters } : {}),
          // Carried across for the same reason the configs are (AI-3, L-2):
          // moving a company or re-syncing its composition is not a statement
          // about what its men are worth to the enemy's caster.
          ...(worth == null ? {} : { value: worth }),
        }
      })
      return { [side]: { ...s[side], placements: [...rest, ...block] } }
    }),

  // Off the field, still on the rolls: the sheet survives so the company can be
  // put down again without being rebuilt.
  unplaceSquad: (side, id) =>
    set((s) => ({
      [side]: { ...s[side], placements: s[side].placements.filter((p) => p.squadId !== id) },
    })),

  // Replace one side's sheets wholesale — what the scenario import applies and
  // what the campaign prefill writes, the same contract setPlacements and
  // setWalls hold. `nextSquadId` is lifted CLEAR of every id that arrived, so a
  // company enrolled afterwards cannot collide with an imported one.
  setSquads: (side, squads) =>
    set((s) => ({
      [side]: {
        ...s[side],
        squads,
        nextSquadId: squads.reduce((next, q) => Math.max(next, (q?.id ?? 0) + 1), 1),
      },
    })),

  // Would this company stand on that hex? ONE RULE SITE, read by the control
  // that offers to place it and by the re-sync that follows an edit to it —
  // two answers to this question would mean a block the button allowed and the
  // store then threw away.
  //
  // Measured in the engine's own size points against the side's own bodies
  // already standing there, minus this company's (it is moving, not joining
  // itself). Packing (a formation-fighters company takes less room) is NOT
  // applied: it would let the browser promise a fit on a rule the auto-place
  // route does not apply either, and being the conservative one of the two is
  // the safe direction to be wrong in.
  squadFits: (side, id, col, row) => {
    const s = get()
    const sheet = s[side].squads.find((q) => q.id === id)
    if (!sheet) return false
    if (s.hexCapacity === null || s.hexCapacity === undefined) return true

    const sizeOf = new Map(s.catalog.map((u) => [u.name, u.size]))
    const points = (type, count) => (sizeOf.get(type) ?? 0) * count
    const mine = squadBodies(sheet).reduce((sum, b) => sum + points(b.type, b.count), 0)
    const others = s[side].placements
      .filter((p) => p.col === col && p.row === row && p.squadId !== id)
      .reduce((sum, p) => sum + points(p.type, p.count), 0)
    return mine > 0 && mine + others <= s.hexCapacity
  },

  // Where this company stands, or null. Derived here rather than in a component
  // so "placed at (4,4)" and "not placed" are read off one computation.
  squadHex: (side, id) => {
    const at = get()[side].placements.find((p) => p.squadId === id)
    return at ? { col: at.col, row: at.row } : null
  },

  // How many of `type` this side has left to place — the army minus everything
  // already standing somewhere. `excludeHex` leaves one hex out of the sum, so
  // the menu editing that hex offers the budget as it would be WITHOUT its own
  // current stack (otherwise raising a stack from 4 to 5 reads as over budget).
  //
  // LOOSE BODIES ONLY (D-R2-1): `army` is what the palette composed, and a
  // company's bodies come from its SHEET rather than from that budget — they
  // were never in the army bag, so counting them against it would report a
  // shortfall that no spinner could ever close.
  remaining: (side, type, excludeHex = null) => {
    const { army, placements } = get()[side]
    const placed = placements
      .filter((p) => p.type === type && p.squadId == null)
      .filter((p) => !(excludeHex && p.col === excludeHex.col && p.row === excludeHex.row))
      .reduce((sum, p) => sum + p.count, 0)
    return Math.max(0, (army[type] ?? 0) - placed)
  },

  reset: () => set(initialState()),
}))

export default useSandboxStore
