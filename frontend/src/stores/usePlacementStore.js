import { create } from 'zustand'

// The in-progress battle deployment draft: loose troops placed per-hex, whole
// squads placed as one formation, and the characters nobody has posted to a
// squad (13-18) placed one by one. Cleared whenever muster starts fresh or a
// turn ends — never sent to the server until Fight is pressed.
const usePlacementStore = create((set, get) => ({
  placements: [],
  squadPlacements: {},
  // {characterId: {col, row}} — an UNATTACHED character's own hex. An attached
  // one is never in here: they ride with their squad and the server places them
  // on the squad's hex (5-8), which is what makes detaching the way to leave
  // someone at home.
  characterPlacements: {},

  // Both setters accept either a plain value or a React-style updater
  // function, matching the useState-setter API HexGrid was written against.
  setPlacements: (updater) =>
    set((state) => ({
      placements: typeof updater === 'function' ? updater(state.placements) : updater,
    })),

  setSquadPlacements: (updater) =>
    set((state) => ({
      squadPlacements: typeof updater === 'function' ? updater(state.squadPlacements) : updater,
    })),

  setCharacterPlacements: (updater) =>
    set((state) => ({
      characterPlacements:
        typeof updater === 'function' ? updater(state.characterPlacements) : updater,
    })),

  clear: () => set({ placements: [], squadPlacements: {}, characterPlacements: {} }),

  // Test-teardown reset is just a clear — delegate so they can't drift.
  reset: () => get().clear(),
}))

export default usePlacementStore
