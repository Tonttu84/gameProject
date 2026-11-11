import crypto from 'node:crypto'

// The JWT signing secret and the seeded dev login come from the environment
// only: locally the secrets overlay (gameproject/dev.env in the private
// secrets repo, loaded by docker compose and scripts/with-dev-env.sh), in a
// deployment its own env. No value is committed here (docs/decisions.md D10).
//
// Without them the server still boots and says so: a missing SECRET becomes a
// random per-process secret (every token dies with the process, which is
// harmless locally and safer than any shared fallback), and missing dev
// credentials turn the dev login off. Pure: the caller prints the warnings.
export function resolveAuthEnv(env) {
  const warnings = []
  let secret = env.SECRET
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex')
    warnings.push(
      'no SECRET set: signing tokens with a random per-process secret, so logins end ' +
      'when the server restarts (set it in the secrets overlay gameproject/dev.env)')
  }
  const hasDevLogin = Boolean(env.DEV_USER && env.DEV_PASSWORD)
  if (!hasDevLogin)
    warnings.push(
      'no DEV_USER/DEV_PASSWORD set: dev login off, register an account instead ' +
      '(set them in the secrets overlay gameproject/dev.env)')
  return {
    SECRET: secret,
    DEV_USER: hasDevLogin ? env.DEV_USER : null,
    DEV_PASSWORD: hasDevLogin ? env.DEV_PASSWORD : null,
    warnings,
  }
}
