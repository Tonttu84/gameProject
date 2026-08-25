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
