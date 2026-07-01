import axios from 'axios'

export const getInfo = () => axios.get('/api/info').then(r => r.data)
export const getMap  = (name) => axios.get(`/api/map${name ? `?name=${encodeURIComponent(name)}` : ''}`).then(r => r.data)

export const postBattle = (payload) => axios.post('/api/battle', payload).then(r => r.data)
