import { test, expect } from '@playwright/test'

// The login screen's "Watch a battle" runs, persists, and replays a real
// engine battle straight from the DB through the one and only renderer
// (ReplayView) — no login required. This smoke proves the whole
// engine → campaign-server → Mongo → browser render path end-to-end.
//
// The sample battle is a big one (hundreds of units, ~200 ticks): the engine
// is single-threaded and CPU-bound, so this one battle's wall time is ~70s on
// an idle stack but swings much higher under host CPU contention. The whole
// engine→DB round-trip happens inside the watch-demo click, so we give the
// assertion a wide ceiling — it resolves the instant the replay mounts, so the
// ceiling only costs wall time on the pathological slow path, never the fast
// one — and a matching per-test budget above the 90s config default.
test('watch-a-battle demo renders a replay from the engine', async ({ page }) => {
  test.setTimeout(300_000)

  await page.goto('/')

  const watchDemo = page.getByTestId('watch-demo')
  await watchDemo.click()
  // Clicking flips the button into its disabled loading state — confirm the
  // launch actually kicked off before we settle in to wait for the replay.
  await expect(watchDemo).toBeDisabled()

  // ReplayView mounts the moment the battle doc comes back, and its transport
  // controls render unconditionally — so their presence proves the battle ran,
  // persisted, and rendered.
  await expect(page.getByTestId('replay-play')).toBeVisible({ timeout: 240_000 })
  await expect(page.getByTestId('replay-slider')).toBeVisible()
  await expect(page.getByTestId('replay-back')).toBeVisible()
})
