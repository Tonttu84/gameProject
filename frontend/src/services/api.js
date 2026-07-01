import axios from 'axios'

export const getInfo = () => axios.get('/api/info').then(r => r.data)

export const postBattle = (payload) => axios.post('/api/battle', payload).then(r => r.data)
