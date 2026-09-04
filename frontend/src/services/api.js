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
// Direct the army's study at one school ({school}); returns the refreshed view.
// A CAMP decision, so the server refuses it once Prepare is left (S2-12) — but
// freely re-settable within the phase, because nothing is spent by changing it:
// points bank per school and a switch parks progress where it was earned (S2-7).
export const setCampaignResearch = (id, school) =>
  axios.post(`/api/campaigns/${id}/research`, { school }, authed()).then(r => r.data)
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
// The spells a caster reaches for first (slice 4, S4-1). The WHOLE list every
// time, replacing what was there — there is no per-slot endpoint, because the
// three slots on the sheet are a rendering of one ordered array.
//
// Free and ungated in every direction, further than equipping goes: any phase,
// and allowed even while the caster is away (S4-4). The fiction is why — this
// is a mage's own standing preference, not an order shouted across a field.
export const setChosenSpells = (id, characterId, script) =>
  axios.post(`/api/campaigns/${id}/characters/${characterId}/script`, { script }, authed()).then(r => r.data)
// The SHORTLIST (the casting AI, A-7): what a caster may improvise with once
// the three chosen spells above are spent. The whole list every time, like the
// script — and an EMPTY one is the widest setting rather than the narrowest,
// because empty means everything he can cast.
//
// Free and ungated in exactly the same directions the script is, and for the
// same reason: this is a standing preference, not an order.
export const setShortlist = (id, characterId, spells) =>
  axios.post(`/api/campaigns/${id}/characters/${characterId}/shortlist`, { spells }, authed()).then(r => r.data)
// Returns { report, campaign }.
export const endCampaignDay = (id) =>
  axios.post(`/api/campaigns/${id}/end-day`, {}, authed()).then(r => r.data)
// Accept the fates at the tent: seals the consulted reading and resolves the
// fortnight's events mid-turn. Returns { report, campaign } like end-day.
export const postAcceptFates = (id) =>
  axios.post(`/api/campaigns/${id}/augury/accept`, {}, authed()).then(r => r.data)
// Resolve a pending choice-fate (events with choices): pick one option of the
// decision owed on `slot`. Returns { campaign, resolved: {slot, choice, label} }.
// `squadId` rides along only for a mission branch (docs/CAMPAIGN_PLAN.md 12-1)
// and `charterId` only for a charter branch (R1, "CHARTER RECRUITMENT", R-6),
// where in both cases choosing the option and choosing the company are one
// decision. The server validates each against the set IT sealed, so these are
// a courtesy, not a grant of trust.
export const postCampaignChoice = (id, slot, choice, squadId, charterId) =>
  axios.post(`/api/campaigns/${id}/choices/${slot}`, { choice, squadId, charterId }, authed()).then(r => r.data)

// One forging (Construction slice C1, C-6): the named smith and the row, the
// same call whichever of the two doors it came through. The server holds every
// gate — level, paths, mithril, the once-per-turn stamp — and refuses in words
// the notice bar can show.
export const forgeItem = (id, { characterId, itemId }) =>
  axios.post(`/api/campaigns/${id}/forge`, { characterId, itemId }, authed()).then(r => r.data)

// One building (Construction slice C2, C-3): the forge call's twin — the named
// builder and the construction row, gates held server-side the same way.
export const buildConstruction = (id, { characterId, constructionId }) =>
  axios.post(`/api/campaigns/${id}/construct`, { characterId, constructionId }, authed()).then(r => r.data)

// One crafting (Construction slice C3, C-4/C-5): the third twin — the named
// smith and the foundry row; what comes back holds a new character.
export const craftUnit = (id, { characterId, unitId }) =>
  axios.post(`/api/campaigns/${id}/craft`, { characterId, unitId }, authed()).then(r => r.data)

// Submit a player bug report. The server stamps the trusted reproduction
// context (active campaign, day, build) itself; the client only claims which
// screen it was on. Requires a login. Returns { id, createdAt }.
export const submitBugReport = (message, screen) =>
  axios.post('/api/bug-reports', { message, screen }, authed()).then(r => r.data)

// ── The battle lab (docs/CAMPAIGN_PLAN.md, "TEST / SANDBOX MODE") ────────────
// Free-standing: no campaign id in either call, because there is no campaign
// (SB-1). Both need a login (SB-2) — a launch spawns an engine subprocess.

// Launch one lab battle. The payload is {player_placement, enemy_placement,
// magic, runs, seed}: axial entries one per BODY — a caster's may carry `paths`
// and `script`, and only when the player actually set them, since absence is
// how the engine's own default is asked for (SB-7) — plus S2's per-side
// {schools, channels} and S3's two launch numbers.
//
// `runs` is how many battles this launch fights (SB-10 — one battle is one
// sample from a noisy distribution, so a win rate needs a batch); `seed` is a
// fixed GAME_RNG_SEED or null for a fresh draw. A SEED COLLAPSES THE BATCH to
// one run, and the server decides that, not this call: a repeated draw sequence
// is one battle copied N times, and a win rate read off it would be a lie.
//
// Returns the same battle summary every other battle route returns — the
// replay is the batch's FIRST run — plus a `batch` block carrying the wins and
// the average survivors. So ReplayView plays it exactly like a campaign fight.
export const postSandboxBattle = (payload) =>
  axios.post('/api/sandbox/battles', payload, authed()).then(r => r.data)

// The lab's static vocabulary, fetched once when the lab opens: the paths and
// schools with their labels, the caster types, SB-8's live host preset and the
// spinner bounds. Server-phrased (17-5), so the lab holds no copy of the words.
export const getSandboxReference = () =>
  axios.get('/api/sandbox/reference', authed()).then(r => r.data)

// What one caster could cast under these paths and these school levels (D3).
// Asked rather than computed: the server folds the catalog through the very
// gate The Study's own picker uses, so the lab cannot come to hold a second
// reading of the rule. Returns { options: [{spell, label, description, …}] }.
export const postSandboxCastable = ({ paths, schools }) =>
  axios.post('/api/sandbox/castable', { paths, schools }, authed()).then(r => r.data)

// What ONE company may field, per type, under its archetype and its upgrades
// (R2). The same pattern as the castable call above and for the same reason:
// `squadCaps` resolves the archetype row THROUGH the upgrades — applying a
// type-swap row before the caps bonus, an ordering that is load-bearing — and a
// second reading of that in the browser would drift. Returns { caps: {type: n} }.
export const postSandboxSquadCaps = ({ archetype, upgrades }) =>
  axios.post('/api/sandbox/squad-caps', { archetype, upgrades }, authed()).then(r => r.data)

// Spread one side's army over its deployment zone, server-side, through the
// very function the enemy's daily plan and both sides of a raid already use —
// so the lab cannot pack a hex differently from the real game. Returns
// { placement: [{unit_type, q, r}] } in AXIAL coords, as the engine speaks them.
//
// `squads` (R2, D-R2-4) are the BLOCKS, each {id, army}: they are laid first,
// one company to one hex through the same `addBlock` a raid party is placed
// with, and the loose army is scattered around them. Their entries come back
// carrying `squad_id`.
export const autoPlaceSandbox = (side, army, squads = []) =>
  axios
    .post(
      '/api/sandbox/auto-place',
      // Omitted when there are none, so a lab with no companies makes the very
      // request every slice before R2 made.
      { side, army, ...(squads.length > 0 ? { squads } : {}) },
      authed(),
    )
    .then(r => r.data)
