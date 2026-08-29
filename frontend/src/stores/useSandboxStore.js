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
const emptySide = () => ({ army: {}, placements: [], magic: openMagic() })

// One caster BODY's configuration (SB-6, D2). Both halves default EMPTY, and
// empty means ABSENT ON THE WIRE — which is the engine's own default: no
// `script` is the default walk (SB-7/E-3), and no `paths` leaves the engine's
// constructor seeding alone, so a Mage the player never opened still walks in
// with his Fire 1. That is what lets "default to what the game would choose by
// itself, override from there" need no new concept.
const emptyCaster = () => ({ paths: {}, script: [] })

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
  place: (side, col, row, type, count) =>
    set((s) => {
      const here = s[side].placements.find(
        (p) => p.col === col && p.row === row && p.type === type,
      )
      const rest = s[side].placements.filter(
        (p) => !(p.col === col && p.row === row && p.type === type),
      )
      if (count <= 0) return { [side]: { ...s[side], placements: rest } }

      const casters = trimCasters(here?.casters, count)
      return {
        [side]: {
          ...s[side],
          placements: [
            ...rest,
            { type, col, row, count, ...(casters.length > 0 ? { casters } : {}) },
          ],
        },
      }
    }),

  // Configure the `index`-th BODY of one caster stack (SB-6: individually, not
  // per type — the mechanics this was asked for, the second caster fizzling and
  // the duplicate-script warning, only appear when two casters on the same side
  // differ). `patch` is merged, so paths and script are set independently.
  setCasterConfig: (side, { col, row, type }, index, patch) =>
    set((s) => ({
      [side]: {
        ...s[side],
        placements: s[side].placements.map((p) => {
          if (!(p.col === col && p.row === row && p.type === type)) return p
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
  setPlacements: (side, placements) => set((s) => ({ [side]: { ...s[side], placements } })),

  clearPlacements: (side) => set((s) => ({ [side]: { ...s[side], placements: [] }, selectedHex: null })),

  // How many of `type` this side has left to place — the army minus everything
  // already standing somewhere. `excludeHex` leaves one hex out of the sum, so
  // the menu editing that hex offers the budget as it would be WITHOUT its own
  // current stack (otherwise raising a stack from 4 to 5 reads as over budget).
  remaining: (side, type, excludeHex = null) => {
    const { army, placements } = get()[side]
    const placed = placements
      .filter((p) => p.type === type)
      .filter((p) => !(excludeHex && p.col === excludeHex.col && p.row === excludeHex.row))
      .reduce((sum, p) => sum + p.count, 0)
    return Math.max(0, (army[type] ?? 0) - placed)
  },

  reset: () => set(initialState()),
}))

export default useSandboxStore
