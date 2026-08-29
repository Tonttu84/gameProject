import Battle from '../models/battle.js'
import Tick from '../models/tick.js'

// Keeping only the turn you can actually watch (docs/CAMPAIGN_PLAN.md,
// "TIERED BATTLE LOGGING", L-6).
//
// THE REASON THIS IS SAFE, and it was checked rather than assumed: nothing in
// the UI can reach an old battle. `campaignView` ships the id list, but no
// component consumes it — `getBattle`/`getTicks` are called only for the fight
// the player has just watched. So an old replay is storage nobody can open
// (user: "the older battles cant be replayed anyways").
//
// It matters because the tiered log made every replay bigger: a sample battle
// is ~21 MB of tick documents, and a campaign that kept every one of them would
// grow without bound for no readable benefit.
//
// WHAT IS NEVER SWEPT: a battle with no `day`. That covers the ownerless sample
// battle behind the login-screen demo, which belongs to no campaign and no turn
// — deleting it would break the front page for everyone. Battles stored before
// `day` existed are also null and ARE swept via the id list below, since they
// are only reachable through the campaign that owns them.
export async function sweepOldBattles(campaign) {
  const ids = (campaign.battles ?? []).map(String)
  if (ids.length === 0) return { deleted: 0 }

  // Older than the CURRENT turn. A battle fought this turn survives, so the
  // day report and its replay still work for the fight just finished; the sweep
  // runs at end of turn, after the player has had their chance to watch it.
  const stale = await Battle.find({
    _id: { $in: ids },
    $or: [{ day: { $lt: campaign.day } }, { day: null }],
  }).select('_id')

  if (stale.length === 0) return { deleted: 0 }
  const staleIds = stale.map((b) => b._id)

  // Ticks first. If the process dies between the two, an orphaned Battle
  // summary is harmless — an orphaned pile of Ticks is the storage this exists
  // to reclaim.
  await Tick.deleteMany({ battle: { $in: staleIds } })
  await Battle.deleteMany({ _id: { $in: staleIds } })

  const gone = new Set(staleIds.map(String))
  campaign.battles = ids.filter((id) => !gone.has(id))

  return { deleted: staleIds.length }
}

// Keeping only the LATEST lab battle per user (docs/CAMPAIGN_PLAN.md,
// "TEST / SANDBOX MODE", SB-12).
//
// The sweep above cannot do this job: it deletes ids listed in
// `campaign.battles`, and a sandbox battle is listed in no campaign at all —
// SB-1 made the lab free-standing. Left to that sweep a lab battle would be
// immortal, and at ~21 MB of tick documents each (L-6's own figure) a player
// pressing Launch a few dozen times would fill the disk with replays nothing
// can open, since the lab screen only ever holds the id it just got back.
//
// So retention is per LAUNCH rather than per turn — the lab has no turns —
// and it runs AFTER the new battle is persisted, keeping `keepId`: a failed
// run must never cost the player the replay he is currently watching.
export async function sweepSandboxBattles(userId, keepId) {
  const stale = await Battle.find({
    user: userId,
    sandbox: true,
    _id: { $ne: keepId },
  }).select('_id')

  if (stale.length === 0) return { deleted: 0 }
  const staleIds = stale.map((b) => b._id)

  // Ticks first, for the reason sweepOldBattles gives: an orphaned summary is
  // harmless, an orphaned pile of ticks is the storage this exists to reclaim.
  await Tick.deleteMany({ battle: { $in: staleIds } })
  await Battle.deleteMany({ _id: { $in: staleIds } })

  return { deleted: staleIds.length }
}
