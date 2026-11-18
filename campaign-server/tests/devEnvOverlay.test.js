import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'

// The dev secrets overlay sits in the private secrets repo at
// gameproject/credentials/dev.env (docs/decisions.md D10, D15). Two readers name
// that path, scripts/with-dev-env.sh and docker-compose.yml, and a reader left
// on another path still boots, only with a random JWT secret and no dev login,
// so nothing else notices the drift. These tests pin both readers to one path.
// They always set SECRETS_DIR to a directory of their own with fake values, so
// the script never falls back to the real secrets clone beside the checkout.
const OVERLAY = 'gameproject/credentials/dev.env'
const OLD_OVERLAY = 'gameproject/dev.env'
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SERVER = path.join(REPO, 'campaign-server')
const FAKE = { SECRET: 'fake-secret-0123456789', DEV_USER: 'fake-user', DEV_PASSWORD: 'fake-password' }
const STALE = { SECRET: 'stale-secret', DEV_USER: 'stale-user', DEV_PASSWORD: 'stale-password' }
const NONE = { SECRET: null, DEV_USER: null, DEV_PASSWORD: null }
const DEFAULT_DIR = /\$\{SECRETS_DIR:-([^}]*)\}/g

// What the command the script runs was handed: a child process sees only
// exported variables.
const PRINT_ENV =
  'const e = process.env; process.stdout.write(JSON.stringify(' +
  '{ SECRET: e.SECRET ?? null, DEV_USER: e.DEV_USER ?? null, DEV_PASSWORD: e.DEV_PASSWORD ?? null }))'

// Linux and CI have bash on PATH. Under Windows Node a bare `bash` may be the
// WSL launcher in System32 instead, so take Git for Windows' bash, found from
// git itself (<git>/mingw64/libexec/git-core, three levels below the install).
function findBash() {
  if (process.platform !== 'win32') return 'bash'
  const gitCore = execFileSync('git', ['--exec-path'], { encoding: 'utf8', timeout: 10000 }).trim()
  const root = path.resolve(gitCore, '..', '..', '..')
  const bash = ['bin', 'usr/bin']
    .map((dir) => path.join(root, dir, 'bash.exe'))
    .find((candidate) => fs.existsSync(candidate))
  if (!bash) throw new Error(`no Git for Windows bash.exe under ${root}`)
  return bash
}
const BASH = findBash()

const readRepoFile = (name) => fs.readFileSync(path.join(REPO, name), 'utf8')

function writeEnvFile(file, values) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const lines = Object.entries(values).map(([name, value]) => `${name}=${value}\n`)
  fs.writeFileSync(file, lines.join(''))
}

// Runs the script from campaign-server, as make serve does, with the given
// SECRETS_DIR and none of the three names inherited from this process.
function runWithDevEnv(secretsDir) {
  const env = { ...process.env, SECRETS_DIR: secretsDir }
  for (const name of Object.keys(FAKE)) delete env[name]
  const result = spawnSync(BASH, ['../scripts/with-dev-env.sh', process.execPath, '-e', PRINT_ENV], {
    cwd: SERVER,
    env,
    encoding: 'utf8',
    timeout: 20000,
  })
  if (result.error) throw result.error
  return result
}

// The env_file entries in docker-compose.yml, read as text: the server has no
// YAML parser, and the block is a short list. Each entry is its path plus the
// keys under it, such as `required`.
function composeEnvFiles() {
  const lines = readRepoFile('docker-compose.yml').split(/\r?\n/)
  const unquote = (value) => value.replace(/^(['"])(.*)\1$/, '$2')
  const entries = []
  lines.forEach((line, i) => {
    const block = line.match(/^(\s*)env_file:\s*$/)
    if (!block) return
    for (const entry of lines.slice(i + 1)) {
      if (entry.trim() && entry.search(/\S/) <= block[1].length) break
      const item = entry.match(/^\s*-\s+(?:path:\s+)?(.+?)\s*$/)
      const key = entry.match(/^\s*([a-z_]+):\s+(.+?)\s*$/)
      if (item) entries.push({ path: unquote(item[1]) })
      else if (key && entries.length) entries.at(-1)[key[1]] = unquote(key[2])
    }
  })
  return entries
}

const composeOverlays = () => composeEnvFiles().filter((entry) => entry.path.includes('SECRETS_DIR'))

describe('scripts/with-dev-env.sh', () => {
  const made = []
  afterEach(() => {
    for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  })

  // A fake secrets dir, removed after the test. Its old overlay holds other
  // values, as in a clone not pulled since the move: the script must read the
  // new path, with no fallback (D15).
  function fakeSecretsDir(parent) {
    const dir = fs.mkdtempSync(path.join(parent, 'gameproject-overlay-test-fake-'))
    made.push(dir)
    writeEnvFile(path.join(dir, OLD_OVERLAY), STALE)
    return dir
  }

  test('exports the three values from SECRETS_DIR/gameproject/credentials/dev.env', () => {
    const dir = fakeSecretsDir(os.tmpdir())
    writeEnvFile(path.join(dir, OVERLAY), FAKE)
    const result = runWithDevEnv(dir)
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(FAKE)
    expect(result.stderr).not.toMatch(/no secrets overlay/)
  })

  test('without the overlay still runs the command and warns, naming the path (D10)', () => {
    const dir = fakeSecretsDir(os.tmpdir())
    const result = runWithDevEnv(dir)
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(NONE)
    expect(result.stderr).toContain(`${dir}/${OVERLAY}`)
  })

  // Run from campaign-server, a relative path read from the working directory
  // would find nothing: it has to resolve from the repo root, as compose's does.
  test('resolves a relative SECRETS_DIR from the repo root', () => {
    const dir = fakeSecretsDir(REPO)
    writeEnvFile(path.join(dir, OVERLAY), FAKE)
    const result = runWithDevEnv(path.relative(REPO, dir))
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(FAKE)
  })

  // Without SECRETS_DIR both readers look in the same clone beside the checkout.
  test('defaults SECRETS_DIR to the same directory as docker-compose.yml', () => {
    const [composeDefault] = composeOverlays().map((entry) => [...entry.path.matchAll(DEFAULT_DIR)][0]?.[1])
    const scriptDefaults = [...readRepoFile('scripts/with-dev-env.sh').matchAll(DEFAULT_DIR)].map((m) => m[1])
    expect(scriptDefaults).toEqual([composeDefault])
  })
})

describe('docker-compose.yml', () => {
  // Optional, so the stack still starts without the overlay (D10).
  test('loads the overlay, optionally, from the same path the script reads, and no other', () => {
    expect(composeOverlays()).toEqual([{ path: `\${SECRETS_DIR:-../secrets}/${OVERLAY}`, required: 'false' }])
  })
})
