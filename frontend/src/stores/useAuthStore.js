import { create } from 'zustand'
import { setToken } from '../services/api'

const STORAGE_KEY = 'loggedGameUser'

// The logged-in session ({ token, username, name }) — persisted to
// localStorage so a refresh doesn't drop the player back to the login
// screen. The token may be stale (1h expiry); the first protected call
// after expiry gets a 401, handled by stores/guarded.js.
const useAuthStore = create((set) => ({
  user: null,

  login: (u) => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(u))
    setToken(u.token)
    set({ user: u })
  },

  logout: () => {
    window.localStorage.removeItem(STORAGE_KEY)
    setToken(null)
    set({ user: null })
  },

  rehydrate: () => {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (!stored) return
    const u = JSON.parse(stored)
    setToken(u.token)
    set({ user: u })
  },

  reset: () => set({ user: null }),
}))

export default useAuthStore
