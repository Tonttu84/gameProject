import axios from 'axios'

// Sole boundary between the frontend and the C++ server — see API.md #1, #5. Responses are
// trusted (same-origin dev server); requests we build (postBattle's payload) are the ones
// the server-side audit in SECURITY_NOTES.md treats as untrusted.
export const getInfo = () => axios.get('/api/info').then(r => r.data)
export const getMap  = (name) => axios.get(`/api/map${name ? `?name=${encodeURIComponent(name)}` : ''}`).then(r => r.data)

export const postBattle = (payload) => axios.post('/api/battle', payload).then(r => r.data)
