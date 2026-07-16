import { create } from 'zustand'

// The in-progress battle deployment draft: loose troops placed per-hex and
// whole squads placed as one formation. Cleared whenever muster starts fresh
// or a turn ends — never sent to the server until Fight is pressed.
const usePlacementStore = create((set, get) => ({
  placements: [],
  squadPlacements: {},

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

  clear: () => set({ placements: [], squadPlacements: {} }),

  // Test-teardown reset is just a clear — delegate so they can't drift.
  reset: () => get().clear(),
}))

export default usePlacementStore
