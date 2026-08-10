// The public shape of hidden-info-bearing objects, in ONE place.
//
// campaigns.test.js and raid.test.js both assert that a raid opportunity crosses
// the wire with exactly these keys — the leak guard that keeps `targetForce`,
// `reward.slot` and friends server-side. Until S3 the list was copy-pasted into
// both files, so adding one legitimate view field (`persistent`) turned into 45
// red tests across two suites and two separate edits to fix. One exported
// constant instead: a deliberate widening is now a one-line diff in a file whose
// whole purpose is to make that choice visible.
//
// Keep SORTED — both call sites compare against Object.keys(o).sort().
export const PUBLIC_OPPORTUNITY_KEYS = [
  'capacity',
  'description',
  'enemy', // per-type RANGES pre-reveal, exact counts once scouting buys them
  'enemyReveal',
  'id',
  'outcome', // {winner, battleId}, only once resolved
  // `persistent` (S3) is public: a card that survives the newDay redeal is worth
  // flagging, so the player reads scouting spent on it as keeping its value. Its
  // `modifierId` sibling deliberately does NOT cross — the card's own flavour
  // already says what beating it undoes, so the id would add coupling and no
  // information.
  'persistent',
  'resolved',
  'reward', // rewardView(): ranges or exact, never the raw hidden object
  'rewardReveal',
  'source',
  'strengthBand',
  // `threat` (2026-08-10) is public, and is a DELIBERATE widening: a
  // counter_event pays no loot, so without the fate it unmakes — named, with
  // its mechanical cost — the card cannot be priced against its party budget.
  // Non-null only once the augury's truth is out (auguryTruthRevealed), so it
  // reveals nothing while the reroll decision is still live, and it carries the
  // THREAT, never the verdict: whether the blow lands, and whether the scouts
  // turn it, still wait for end-day.
  'threat',
  'title',
  'type',
]
