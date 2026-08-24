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

// Launch the hardcoded sample battle (login-screen demo). No auth — runs the
// scenario through the same engine→DB pipeline as a real battle and returns its
// summary { id, tickCount, ... }; play it with ReplayView(id) like any battle.
export const launchSampleBattle = () =>
  axios.post('/api/sample-battle').then(r => r.data)

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
// Consult the augur (one reading per turn); the returned view carries one
// vision card per fate slot — which are TRUE is revealed at end-day.
export const consultCampaignAugury = (id) =>
  axios.post(`/api/campaigns/${id}/augury/consult`, {}, authed()).then(r => r.data)
// Reroll ONE slot's fate: redraws that slot's hidden pair (the old truth
// never fires) and reads it fresh; the other slots stay sealed.
export const rerollCampaignAugury = (id, slot) =>
  axios.post(`/api/campaigns/${id}/augury/reroll`, { slot }, authed()).then(r => r.data)
// Advance the turn one phase ('omens' | 'raids' | 'deploy'); returns the view.
// The march is one-way and server-owned, so this is the ONLY way a turn phase
// moves — except entering Recruit, which is openRecruit (it draws the offer).
export const advanceCampaignPhase = (id, phase) =>
  axios.post(`/api/campaigns/${id}/phase`, { phase }, authed()).then(r => r.data)
// Set today's effort split between foraging and scouting ({share: 0..1});
// returns the view. Sticky across turns; seals when Prepare is left.
export const setCampaignEffort = (id, share) =>
  axios.post(`/api/campaigns/${id}/effort`, { share }, authed()).then(r => r.data)
// Spend stores at the camp; returns the refreshed view. body is
// {action:'fortify'} (raise the fortification level with materials + labour) —
// the only spend action; buying troops is the Recruit phase's hireRecruit.
export const spendCampaign = (id, body) =>
  axios.post(`/api/campaigns/${id}/spend`, body, authed()).then(r => r.data)
// Returns the battle summary plus the refreshed campaign view.
export const postCampaignBattle = (id, payload) =>
  axios.post(`/api/campaigns/${id}/battles`, payload, authed()).then(r => r.data)
// Launch a batch of raid parties ({raidId: {unitType: count}}) together in
// one request — real short battles run server-side and every opportunity in
// the batch resolves either way. One request (not one call per opportunity)
// so the server can validate the whole batch's troop usage at once; see
// docs/CAMPAIGN_PLAN.md's raid double-assignment fix. Returns
// { results: [{raidId, ...battleSummary}], campaign }.
export const postCampaignRaids = (id, parties) =>
  axios.post(`/api/campaigns/${id}/raids/launch`, { parties }, authed()).then(r => r.data)
// The raid scouting mini-game: spend the turn's scouting-points pool to shape
// the board. body is either {action:'add_target'} (scout one new ordinary
// target) or {action:'reveal', raidId, field:'reward'|'enemy'} (pin that
// field from a range to its exact value). Returns the refreshed view.
export const scoutRaidTarget = (id, body) =>
  axios.post(`/api/campaigns/${id}/raids/scout`, body, authed()).then(r => r.data)
// Open the Recruit phase: draws the day's offer server-side (idempotent — a
// second call returns the same sealed offer, not a reroll) and closes the camp
// for the day, so every other turn action starts refusing. Call it when the
// player enters the phase, never speculatively.
export const openRecruit = (id) =>
  axios.post(`/api/campaigns/${id}/recruit/open`, {}, authed()).then(r => r.data)
// Recruit phase: {entryId} hires that option, spending the day's one-hire
// cadence. There is no skip — the free Travellers card always makes a hire
// possible, and the hire is the only way out of the phase. Returns the
// refreshed view directly (not wrapped in {campaign: ...}, unlike
// postCampaignRaids/endCampaignDay).
export const hireRecruit = (id, body) =>
  axios.post(`/api/campaigns/${id}/recruit/hire`, body, authed()).then(r => r.data)
// Take one upgrade off a squad's draft (docs/CAMPAIGN_PLAN.md "SLICE 4 — THE
// UPGRADE CATALOG"). The body names an id the SERVER offered — the draw is
// sealed server-side, so the client never picks from the whole catalog. The
// choice is PERMANENT and there is deliberately no undo endpoint to pair with
// this one. Returns the refreshed view directly, like hireRecruit.
export const takeSquadUpgrade = (id, squadId, upgrade) =>
  axios.post(`/api/campaigns/${id}/squads/${squadId}/upgrades`, { upgrade }, authed()).then(r => r.data)
// Bind an item from the store to a squad (slice 6). PERMANENT: a bound banner
// leaves the store and never returns, and like takeSquadUpgrade there is
// deliberately no undo endpoint to pair with this one. The confirmation the
// player sees is the client's courtesy; the refusal is the server's.
export const bindSquadBanner = (id, squadId, itemId) =>
  axios.post(`/api/campaigns/${id}/squads/${squadId}/banner`, { itemId }, authed()).then(r => r.data)
// Post a character to a squad, or bring them home with squadId null (5-7).
// Free and ungated in any phase — there is deliberately no cost or lock here.
export const attachCharacter = (id, characterId, squadId) =>
  axios.post(`/api/campaigns/${id}/characters/${characterId}/attach`, { squadId }, authed()).then(r => r.data)
// "Hold back unless we run out of troops" (5-8). Carried by every character
// whatever their type; only the default is derived from the unit.
export const setCharacterHangBack = (id, characterId, hangBack) =>
  axios.post(`/api/campaigns/${id}/characters/${characterId}/hang-back`, { hangBack }, authed()).then(r => r.data)
// Put a piece of gear from the store onto a character (9-8), and take it off
// again. Two calls rather than one "set this slot", because they take different
// arguments and fail for different reasons — and `index` matters on both: kit
// stacks (9-6), so which of two hands a blade comes off is not a detail.
// Free and ungated like attachment; the ONE refusal is a bearer who is away.
export const equipCharacterItem = (id, characterId, { slot, index, itemId }) =>
  axios.post(`/api/campaigns/${id}/characters/${characterId}/equip`, { slot, index, itemId }, authed()).then(r => r.data)
export const unequipCharacterItem = (id, characterId, { slot, index }) =>
  axios.post(`/api/campaigns/${id}/characters/${characterId}/unequip`, { slot, index }, authed()).then(r => r.data)
// Returns { report, campaign }.
export const endCampaignDay = (id) =>
  axios.post(`/api/campaigns/${id}/end-day`, {}, authed()).then(r => r.data)
// Accept the fates at the tent: seals the consulted reading and resolves the
// fortnight's events mid-turn. Returns { report, campaign } like end-day.
export const postAcceptFates = (id) =>
  axios.post(`/api/campaigns/${id}/augury/accept`, {}, authed()).then(r => r.data)
// Resolve a pending choice-fate (events with choices): pick one option of the
// decision owed on `slot`. Returns { campaign, resolved: {slot, choice, label} }.
// `squadId` rides along only for a mission branch (docs/CAMPAIGN_PLAN.md 12-1),
// where choosing the option and choosing the charter are one decision. The
// server validates it against the pair IT sealed, so this is a courtesy, not a
// grant of trust.
export const postCampaignChoice = (id, slot, choice, squadId) =>
  axios.post(`/api/campaigns/${id}/choices/${slot}`, { choice, squadId }, authed()).then(r => r.data)

// Submit a player bug report. The server stamps the trusted reproduction
// context (active campaign, day, build) itself; the client only claims which
// screen it was on. Requires a login. Returns { id, createdAt }.
export const submitBugReport = (message, screen) =>
  axios.post('/api/bug-reports', { message, screen }, authed()).then(r => r.data)
