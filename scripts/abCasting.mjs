#!/usr/bin/env node
//
// AI-3 (docs/CAMPAIGN_PLAN.md, "THE CASTING AI", L-8): THE ACCEPTANCE EVIDENCE
// FOR THE SCORER — an N-runs A/B of the walk-era engine against this one.
//
// The old walk NO LONGER EXISTS in the engine and is deliberately not coming
// back as a legacy mode: a second cast path kept alive only to be measured is a
// second cast path to maintain, and it would rot the day anything around it
// moved. So the baseline is a BINARY, not a branch of the code — the engine as
// it stood at AI-1 (commit 3be205d), which was the last walk-era engine and is
// behaviour-identical to the walk with only its targeting refactored (see the
// AI-1 note in the plan: `Densest` keeps the call byte-identical, and every
// damage spell there still hits the first living enemy in range).
//
// It builds that baseline in a THROWAWAY GIT WORKTREE, runs every fixture in
// scripts/ab/ through both binaries unseeded, and prints one table. Nothing
// here is a test and nothing asserts: the numbers are the evidence, and reading
// them is the reviewer's job. What keeps the fixtures from rotting is a test —
// campaign-server/tests/engine.integration.test.js runs each of them through
// the real binary once (L-10).
//
// Usage:  node scripts/abCasting.mjs [--runs N] [--base <commit>] [--new <path to game>]
//         make ab-casting
//
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE_DIR = path.join(REPO, 'scripts', 'ab')

// AI-1, the last walk-era engine (see the header). Overridable, because the
// question "how does today compare with THEN" outlives this one commit.
const DEFAULT_BASE = '3be205d'
// Twenty is enough for a win rate to stop swinging on one unlucky draw and few
// enough to finish while somebody is watching — the same reasoning
// SANDBOX_MAX_RUNS is written down with.
const DEFAULT_RUNS = 20

const parseArgs = (argv) => {
  const args = { runs: DEFAULT_RUNS, base: DEFAULT_BASE, next: path.join(REPO, 'game') }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === '--runs') { args.runs = Math.max(1, Math.trunc(Number(value)) || DEFAULT_RUNS); i += 1 }
    else if (flag === '--base') { args.base = String(value); i += 1 }
    else if (flag === '--new') { args.next = path.resolve(String(value)); i += 1 }
    else if (flag === '--help' || flag === '-h') {
      console.log('usage: node scripts/abCasting.mjs [--runs N] [--base <commit>] [--new <path to game>]')
      process.exit(0)
    } else {
      console.error(`unknown argument: ${flag}`)
      process.exit(1)
    }
  }
  return args
}

// ── The baseline binary ─────────────────────────────────────────────────────
//
// A WORKTREE rather than a checkout of the current tree: the working tree is
// where the reviewer's own uncommitted work lives, and an A/B that stashed it
// to build a baseline would be a script that can lose somebody's afternoon.
//
// REUSED WHEN IT IS ALREADY THERE (its binary included), because building the
// engine twice to answer the same question is minutes nobody gets back — and
// REMOVED at the end whether the runs succeeded or not, so `git worktree list`
// shows only the main tree when this is over.
const buildBaseline = (commit) => {
  const dir = path.join(os.tmpdir(), `ab-casting-${commit}`)
  const binary = path.join(dir, 'game')

  if (fs.existsSync(binary)) {
    console.log(`baseline: reusing ${binary}`)
    return { dir, binary, reused: true }
  }
  if (!fs.existsSync(dir)) {
    console.log(`baseline: git worktree add ${dir} ${commit}`)
    execFileSync('git', ['worktree', 'add', '--detach', dir, commit], { cwd: REPO, stdio: 'inherit' })
  }
  console.log(`baseline: make (in ${dir}) — this takes a few minutes the first time`)
  execFileSync('make', ['-j', String(os.cpus().length)], { cwd: dir, stdio: 'inherit' })
  return { dir, binary, reused: false }
}

const removeWorktree = (dir) => {
  try {
    execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: REPO, stdio: 'inherit' })
  } catch {
    // A worktree that will not come off is worth SAYING rather than throwing:
    // the runs are already done and their table is the point of the script.
    console.error(`could not remove the baseline worktree at ${dir} — remove it by hand`)
  }
}

// ── One battle ──────────────────────────────────────────────────────────────
//
// Run from the REPO ROOT whichever binary is being measured, because the engine
// resolves maps/ relative to its cwd — so both binaries fight on the very same
// terrain file rather than on their own commit's copy of it.
const runBattle = (binary, input) => {
  const proc = spawnSync(binary, ['battle'], {
    cwd: REPO,
    input,
    maxBuffer: 512 * 1024 * 1024,
    env: { ...process.env, ASAN_OPTIONS: 'detect_leaks=0' },
  })
  if (proc.error) throw new Error(`${binary}: ${proc.error.message}`)
  try {
    return JSON.parse(proc.stdout.toString())
  } catch {
    throw new Error(`${binary}: stdout was not JSON (${proc.stdout.toString().slice(0, 200)})`)
  }
}

// The log crosses TIER-TAGGED (a bare string is what a pre-ladder binary
// emits), read through one accessor exactly as engine.integration.test.js's
// `castsIn` reads it — this is measuring two binaries, and the older one must
// not be counted differently from the newer.
const lineText = (l) => (typeof l === 'string' ? l : l.text)
const castsIn = (replay) =>
  (replay?.ticks ?? [])
    .flatMap((t) => t.log ?? [])
    .map(lineText)
    .filter((l) => l.includes(' casts '))

const bodies = (survivors) => Object.values(survivors ?? {}).reduce((sum, n) => sum + n, 0)

// ── The kitted man (A-5) ────────────────────────────────────────────────────
//
// NO LOG LINE NAMES A TARGET. The cast line says who cast what ("Mage (blue)
// casts Ember") and the scorer's own Detail line says what it weighed ("… Ember
// 1500, Ember 75 — Ember"), but neither says WHOM, and the damage lines name a
// type rather than a man. So the observable answer to "did the scorer ever go
// for him" is read off the REPLAY instead: the kitted body is the only one
// standing on his own hex at deployment, which gives him a replay id, and from
// there his hit points are a record of what the enemy actually did to him.
//
// What it reports is his SHARE of the harm done to his side, not the raw
// number: a hit point lost is a hit point lost whichever binary is fighting,
// and the question A-5 asks is whether the enemy's caster spends his casts on
// HIM rather than on the man beside him. His share against his one-in-eight
// share of a line that nobody is picking out is the answer.
//
// Returns null for a fixture with no `_kitted` hex, which is every fixture but
// one.
const kittedReport = (fixture, result) => {
  const at = fixture._kitted
  if (!at) return null
  const ticks = result?.replay?.ticks ?? []
  const deployed = (ticks[0]?.units ?? []).find(
    (u) => u.team === 'red' && u.q === at.q && u.r === at.r,
  )
  if (!deployed) return { found: false }

  // Hit points lost per body, summed tick over tick — a body that vanishes
  // from a tick is dead, and the rest of his bar counts as lost with him.
  const hp = new Map()
  const lost = new Map()
  const bury = (id) => {
    lost.set(id, (lost.get(id) ?? 0) + (hp.get(id) ?? 0))
    hp.delete(id)
  }
  for (const tick of ticks) {
    const here = new Map(
      (tick.units ?? []).filter((u) => u.team === 'red').map((u) => [u.id, u.hp]),
    )
    for (const id of [...hp.keys()]) if (!here.has(id)) bury(id)
    for (const [id, now] of here) {
      const before = hp.get(id)
      if (before !== undefined && now < before) lost.set(id, (lost.get(id) ?? 0) + (before - now))
      hp.set(id, now)
    }
  }
  const total = [...lost.values()].reduce((sum, n) => sum + n, 0)
  return {
    found: true,
    his: lost.get(deployed.id) ?? 0,
    total,
    died: !hp.has(deployed.id),
    bodies: new Set([...lost.keys(), ...hp.keys()]).size,
  }
}

// ── The table ───────────────────────────────────────────────────────────────
const pad = (text, width) => String(text).padEnd(width)
const padStart = (text, width) => String(text).padStart(width)

const main = () => {
  const args = parseArgs(process.argv.slice(2))
  const fixtures = fs.readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
  if (fixtures.length === 0) {
    console.error(`no fixtures in ${FIXTURE_DIR}`)
    process.exit(1)
  }
  if (!fs.existsSync(args.next)) {
    console.error(`no engine binary at ${args.next} — run \`make\` first`)
    process.exit(1)
  }

  const baseline = buildBaseline(args.base)
  const binaries = [
    { label: `walk (${args.base})`, path: baseline.binary },
    { label: 'scorer (HEAD)', path: args.next },
  ]

  const rows = []
  const notes = []
  try {
    for (const name of fixtures) {
      const text = fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8')
      const fixture = JSON.parse(text)
      // The side the fixture is asking about, on a NON-ENGINE key: nlohmann's
      // parser reads the fields it knows by name and ignores the rest, so the
      // question rides in the file it is about rather than in a sibling.
      const watch = fixture._watch === 'red' ? 'red' : 'blue'

      for (const binary of binaries) {
        let wins = 0
        let blue = 0
        let red = 0
        let casts = 0
        let kittedHis = 0
        let kittedTotal = 0
        let kittedDeaths = 0
        let kittedRuns = 0
        let kittedBodies = 0
        for (let run = 0; run < args.runs; run += 1) {
          const result = runBattle(binary.path, text)
          if (result.winner === watch) wins += 1
          blue += bodies(result.blue_survivors)
          red += bodies(result.red_survivors)
          casts += castsIn(result.replay).length
          const kitted = kittedReport(fixture, result)
          if (kitted?.found) {
            kittedRuns += 1
            kittedHis += kitted.his
            kittedTotal += kitted.total
            kittedBodies = kitted.bodies
            if (kitted.died) kittedDeaths += 1
          }
        }
        const mean = (total) => (total / args.runs).toFixed(1)
        rows.push({
          fixture: name.replace(/\.json$/, ''),
          binary: binary.label,
          watch,
          wins: `${wins}/${args.runs}`,
          rate: `${Math.round((wins / args.runs) * 100)}%`,
          blue: mean(blue),
          red: mean(red),
          casts: mean(casts),
        })
        if (kittedRuns > 0) {
          // "One man in N" is the share he would take if nobody were picking
          // him out, printed beside his own so the number has something to be
          // read against.
          const share = kittedTotal > 0 ? (kittedHis / kittedTotal) * 100 : 0
          notes.push(
            `${name.replace(/\.json$/, '')} · ${binary.label}: the kitted man (value `
            + `${(fixture.enemy_placement ?? []).find((e) => e.value)?.value ?? '?'}, one of `
            + `${kittedBodies}) took ${share.toFixed(0)}% of the hit points his side lost `
            + `(${(kittedHis / kittedRuns).toFixed(1)} of ${(kittedTotal / kittedRuns).toFixed(1)} `
            + `a battle) and died in ${kittedDeaths}/${kittedRuns} runs`,
          )
        }
      }
    }
  } finally {
    if (!baseline.reused) removeWorktree(baseline.dir)
    else console.log(`baseline worktree kept at ${baseline.dir} (it was already there)`)
  }

  const widths = {
    fixture: Math.max(7, ...rows.map((r) => r.fixture.length)),
    binary: Math.max(6, ...rows.map((r) => r.binary.length)),
    watch: 5, wins: 6, rate: 5, blue: 5, red: 5, casts: 6,
  }
  console.log(`\n${args.runs} runs per fixture per binary, unseeded.\n`)
  console.log([
    pad('fixture', widths.fixture), pad('binary', widths.binary), pad('watch', widths.watch),
    padStart('wins', widths.wins), padStart('win%', widths.rate),
    padStart('blue', widths.blue), padStart('red', widths.red), padStart('casts', widths.casts),
  ].join('  '))
  console.log('-'.repeat(Object.values(widths).reduce((sum, w) => sum + w + 2, 0)))
  for (const r of rows)
    console.log([
      pad(r.fixture, widths.fixture), pad(r.binary, widths.binary), pad(r.watch, widths.watch),
      padStart(r.wins, widths.wins), padStart(r.rate, widths.rate),
      padStart(r.blue, widths.blue), padStart(r.red, widths.red), padStart(r.casts, widths.casts),
    ].join('  '))
  console.log('\nblue/red are AVERAGE SURVIVING BODIES per battle; casts is the average number of'
    + '\n" casts " log lines per battle. A draw counts as no win for either side.')
  if (notes.length > 0) console.log(`\n${notes.join('\n')}`)
}

main()
