import axios from 'axios'

// Sole boundary between the frontend and the campaign server (Node BFF, which
// owns the DB and spawns the C++ engine) — see API.md #1, #5. Responses are
// trusted (same-origin dev server); requests we build (postBattle's payload)
// are the ones the server-side audit in SECURITY_NOTES.md treats as untrusted.
export const getInfo = () => axios.get('/api/info').then(r => r.data)
export const getMap  = (name) => axios.get(`/api/map${name ? `?name=${encodeURIComponent(name)}` : ''}`).then(r => r.data)
export const getUnits = () => axios.get('/api/units').then(r => r.data)

// Bearer token for the one protected call (postBattle). Set on login/rehydrate,
// cleared on logout — module state, same lifetime as the page.
let token = null
export const setToken = (t) => { token = t ? `Bearer ${t}` : null }

// Register a new account; returns the created user (no token — log in after).
export const register = (user) => axios.post('/api/users', user).then(r => r.data)
// Returns { token, username, name }.
export const login = (credentials) => axios.post('/api/login', credentials).then(r => r.data)

// Runs and stores a battle; returns { id, winner, blue_survivors, red_survivors, tickCount }.
// Requires a login — the server rejects with 401 otherwise.
export const postBattle = (payload) =>
  axios.post('/api/battles', payload, { headers: { Authorization: token } }).then(r => r.data)

export const getBattle = (id) => axios.get(`/api/battles/${id}`).then(r => r.data)
export const getTicks  = (id, from, to) =>
  axios.get(`/api/battles/${id}/ticks`, { params: { from, to } }).then(r => r.data)

// ── Campaigns (all protected) ────────────────────────────────────────────────
// The server owns all campaign state; responses are campaignView objects that
// never include hidden info (enemy army, planned placement, event truth).
const authed = () => ({ headers: { Authorization: token } })

export const createCampaign = () =>
  axios.post('/api/campaigns', {}, authed()).then(r => r.data)
export const getCampaigns = () =>
  axios.get('/api/campaigns', authed()).then(r => r.data)
export const getCampaign = (id) =>
  axios.get(`/api/campaigns/${id}`, authed()).then(r => r.data)
// Consult the augur (one reading per turn); the returned view carries the
// prophecy card + raw dice roll — whether it is TRUE is revealed at end-day.
export const consultCampaignAugury = (id) =>
  axios.post(`/api/campaigns/${id}/augury/consult`, {}, authed()).then(r => r.data)
// Reroll the bones: redraws BOTH hidden events (the old fate never fires).
export const rerollCampaignAugury = (id) =>
  axios.post(`/api/campaigns/${id}/augury/reroll`, {}, authed()).then(r => r.data)
// Replace the turn's forager assignment ({unitType: count}); returns the view.
export const setCampaignForage = (id, assignment) =>
  axios.post(`/api/campaigns/${id}/forage`, { assignment }, authed()).then(r => r.data)
// Returns the battle summary plus the refreshed campaign view.
export const postCampaignBattle = (id, payload) =>
  axios.post(`/api/campaigns/${id}/battles`, payload, authed()).then(r => r.data)
// Returns { report, campaign }.
export const endCampaignDay = (id) =>
  axios.post(`/api/campaigns/${id}/end-day`, {}, authed()).then(r => r.data)

// Submit a player bug report. The server stamps the trusted reproduction
// context (active campaign, day, build) itself; the client only claims which
// screen it was on. Requires a login. Returns { id, createdAt }.
export const submitBugReport = (message, screen) =>
  axios.post('/api/bug-reports', { message, screen }, authed()).then(r => r.data)
