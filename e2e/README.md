# End-to-end tests (Playwright)

Browser-driven tests that exercise the **whole running stack** — engine +
campaign server + Mongo + the built frontend — the way a player does. They are
deliberately *not* mocked: every action hits the real `/api` and the real
`./game` engine subprocess.

## What they cover

- `campaign-loop.spec.js` — one full turn: login → War Council → forage →
  augur consult/reroll → **Accept the Fates** (the mid-turn reveal) → muster →
  placement → End Turn → the next council.
- `demo-battle.spec.js` — the unauthenticated "Watch a battle" demo, proving
  the engine → DB → `ReplayView` render path.

## Running them

These tests **attach to an already-running stack** — they never boot one
themselves. Bring the stack up first, then point the tests at it.

### Locally (Windows / Docker Desktop, or any Docker host)

```sh
make docker-up                 # the stack at http://localhost:5173
cd e2e
npm install                    # first time
npm run install-browsers       # first time (downloads Chromium)
npm test                       # drives http://localhost:5173 by default
```

Override the target with `E2E_BASE_URL`, e.g. against a native `make serve`
Linux box or the CI image on 3001:

```sh
E2E_BASE_URL=http://localhost:3001 npm test
```

Handy variants: `npm run test:headed` (watch it drive the browser),
`npm run test:ui` (Playwright's interactive runner), `npm run report` (open the
last HTML report).

### CI

The `e2e` job in `.github/workflows/ci.yml` builds the distributable image,
boots it on `:3001` (fresh Mongo), then runs these specs with
`E2E_BASE_URL=http://localhost:3001`.

## Requirements

- The stack must be reachable at `E2E_BASE_URL` (default `http://localhost:5173`).
- Local login uses `DEV_SEED`, but the campaign spec **registers its own
  throwaway user** each run, so it doesn't depend on the seed and leaves no
  campaign state behind between runs.
