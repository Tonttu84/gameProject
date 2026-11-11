import { describe, expect, test } from 'vitest'
import { resolveAuthEnv } from '../utils/authEnv.js'

// The JWT secret and the dev login come from the environment only: the secrets
// overlay (gameproject/dev.env in the private secrets repo) or the deployment.
// Without them the server still boots, says so, and never falls back to a
// value that once lived in git (docs/decisions.md D10).
const FULL = { SECRET: 's'.repeat(64), DEV_USER: 'dev-user', DEV_PASSWORD: 'dev-password' }

describe('resolveAuthEnv', () => {
  test('takes all three values from the environment and warns about nothing', () => {
    const auth = resolveAuthEnv(FULL)
    expect(auth.SECRET).toBe(FULL.SECRET)
    expect(auth.DEV_USER).toBe('dev-user')
    expect(auth.DEV_PASSWORD).toBe('dev-password')
    expect(auth.warnings).toEqual([])
  })

  test('a missing SECRET gives a random per-process secret plus a warning', () => {
    const a = resolveAuthEnv({ ...FULL, SECRET: undefined })
    const b = resolveAuthEnv({ ...FULL, SECRET: '' })
    expect(a.SECRET).toMatch(/^[0-9a-f]{64}$/)
    expect(b.SECRET).toMatch(/^[0-9a-f]{64}$/)
    expect(a.SECRET).not.toBe(b.SECRET)
    expect(a.SECRET).not.toBe('dev-only-secret-change-me')
    expect(a.warnings).toHaveLength(1)
    expect(a.warnings[0]).toMatch(/no SECRET set/)
  })

  test('dev login is off without both credentials, with a warning', () => {
    for (const env of [
      { SECRET: FULL.SECRET },
      { ...FULL, DEV_USER: '' },
      { ...FULL, DEV_PASSWORD: undefined },
    ]) {
      const auth = resolveAuthEnv(env)
      expect(auth.DEV_USER).toBeNull()
      expect(auth.DEV_PASSWORD).toBeNull()
      expect(auth.warnings).toEqual([expect.stringMatching(/dev login off/)])
    }
  })

  test('never falls back to the old committed dev login', () => {
    const auth = resolveAuthEnv({})
    expect(auth.DEV_USER).not.toBe('testuser')
    expect(auth.DEV_PASSWORD).not.toBe('test')
    expect(auth.warnings).toHaveLength(2)
  })
})
