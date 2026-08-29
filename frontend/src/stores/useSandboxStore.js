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
// and the export/import that makes one shareable is slice S3's job. Which means
// this store IS the scenario — the shape to serialise when that slice lands.

export const SIDES = ['blue', 'red']

// One side's slate. `army` is what has been composed ({type: count}); the
// `placements` are where those bodies stand ({type, col, row, count}). They are
// SEPARATE on purpose, exactly as a campaign's roster and deployment are: an
// army composed but not placed is a mistake worth being able to see, and
// auto-place is the button that turns one into the other.
const emptySide = () => ({ army: {}, placements: [] })

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
  launching: false,
  // The summary of the battle just launched, or null. The lab holds only the
  // latest — which is also all the server keeps (SB-12).
  battle: null,
})

const useSandboxStore = create((set, get) => ({
  ...initialState(),

  setSide: (side) => set({ side, selectedHex: null }),
  setCatalog: (catalog) => set({ catalog }),
  setSelectedHex: (selectedHex) => set({ selectedHex }),
  setLaunching: (launching) => set({ launching }),
  setBattle: (battle) => set({ battle }),

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
  place: (side, col, row, type, count) =>
    set((s) => {
      const rest = s[side].placements.filter(
        (p) => !(p.col === col && p.row === row && p.type === type),
      )
      return {
        [side]: {
          ...s[side],
          placements: count > 0 ? [...rest, { type, col, row, count }] : rest,
        },
      }
    }),

  // Replace one side's placements wholesale — what auto-place returns, and what
  // Clear empties. Auto-place OVERWRITES rather than merges: it is an answer to
  // "where does this whole army go", and a merge would silently overstack the
  // hexes the player had already filled by hand.
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
