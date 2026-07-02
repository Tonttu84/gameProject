import axios from 'axios'

// Sole boundary between the frontend and the campaign server (Node BFF, which
// owns the DB and spawns the C++ engine) — see API.md #1, #5. Responses are
// trusted (same-origin dev server); requests we build (postBattle's payload)
// are the ones the server-side audit in SECURITY_NOTES.md treats as untrusted.
export const getInfo = () => axios.get('/api/info').then(r => r.data)
export const getMap  = (name) => axios.get(`/api/map${name ? `?name=${encodeURIComponent(name)}` : ''}`).then(r => r.data)
export const getUnits = () => axios.get('/api/units').then(r => r.data)

// Runs and stores a battle; returns { id, winner, blue_survivors, red_survivors, tickCount }.
export const postBattle = (payload) => axios.post('/api/battles', payload).then(r => r.data)

export const getBattle = (id) => axios.get(`/api/battles/${id}`).then(r => r.data)
export const getTicks  = (id, from, to) =>
  axios.get(`/api/battles/${id}/ticks`, { params: { from, to } }).then(r => r.data)
