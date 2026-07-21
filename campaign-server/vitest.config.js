import { defineConfig } from 'vitest/config'

// Committed baseline for the campaign-server suite (see the
// reference_laptop_mongo_tests / dev.sh notes for the failure modes).
//
// Every test file spins up its OWN in-memory mongod (tests/helpers/db.js).
// Vitest's default is to run files in PARALLEL, so the suite would launch ~20
// mongod processes at once. On any resource-constrained machine (a laptop
// under load, a Flatpak/VS-Code sandbox, a busy CI runner) that thrashes: mongo
// crawls, the default 5s testTimeout trips, and — the nasty part — the
// timed-out request's insert lands AFTER the next test's beforeEach clear,
// leaking state into an unrelated test (the intermittent
// "Battle.countDocuments() === 2 instead of 1" flake).
//
// Fixing it at the root: serialize the files so only ONE mongod is ever live
// (no startup contention), and give slow-but-correct DB ops real headroom
// instead of the 5s default. We trade a little wall-clock on fast machines for
// a suite that doesn't flake anywhere — the right call for a test suite. The
// dev.sh Flatpak branch layers on even wider timeouts via CLI flags (which win
// over these), for the harshest sandbox case.
export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
