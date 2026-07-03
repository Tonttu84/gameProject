// Registers a user through the real routes and returns a usable Bearer token.
// Callers re-run this in beforeEach because clearDb() wipes the users
// collection along with everything else.
export async function createUserAndToken(api, username = 'tester', password = 'sekret') {
  const userRes = await api.post('/api/users').send({ username, password })
  const loginRes = await api.post('/api/login').send({ username, password })
  return { token: loginRes.body.token, userId: userRes.body.id }
}
