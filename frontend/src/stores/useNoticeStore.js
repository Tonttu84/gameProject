import { create } from 'zustand'

// authNotice is a transient toast, not a persistent state — it must not
// stay on screen forever. Fullstack Open-style: showing a new notice
// (re)starts a timer that clears it; a manual clear cancels any pending
// timer so an old one can't wipe out a newer message set right after.
const DEFAULT_TIMEOUT_MS = 10000 // debugging value — keep short in prod too, never forever

// The timer handle is module state rather than a React ref: this store is a
// singleton for the app's lifetime, so there's nothing to attach a ref to.
let timeoutId = null

const useNoticeStore = create((set) => ({
  message: null,

  show: (message, timeoutMs = DEFAULT_TIMEOUT_MS) => {
    if (timeoutId) window.clearTimeout(timeoutId)
    set({ message })
    timeoutId = window.setTimeout(() => {
      set({ message: null })
      timeoutId = null
    }, timeoutMs)
  },

  clear: () => {
    if (timeoutId) window.clearTimeout(timeoutId)
    timeoutId = null
    set({ message: null })
  },

  reset: () => {
    if (timeoutId) window.clearTimeout(timeoutId)
    timeoutId = null
    set({ message: null })
  },
}))

export default useNoticeStore
