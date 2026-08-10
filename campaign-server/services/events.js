import {
  EVENT_RUNG_BY_BAND,
  GARRISON_RESOLVE_START,
} from '../utils/campaignConfig.js'
import { adjustResolve } from './garrison.js'

// Fortnightly event pool + effect application. Events reach the player only
// as the augur's prophecy (services/augury.js): each turn one TRUE event and
// one DECOY are drawn, the prophecy may show either, and the true effect
// applies at end-of-turn regardless of what was foretold.

// severity 1–3 IS the pool: minor / normal / major. A slot's true and false
// events are always drawn from the same pool, and the reading's legibility
// modifier belongs to the POOL, never the event (user, 2026-07-05): the
// displayed odds are identical whichever pool member is true, so they tell
// the player how murky the reading was — never which card to believe. The
// player does learn the pool (the card's gravity says as much), so every
// pool must hold BOTH good and bad events: magnitude leaks, direction never.
// augury.test.js tripwires all of this (≥2 events per pool, mixed valence).
//
// Everyday small fates read easily; great fates are murky.
export const POOL_LEGIBILITY = { 1: 2, 2: 1, 3: 0 } // reading-roll bonus by pool

// Food deltas are kg on the fortnight-turn scale (the starting army eats
// ~12,400 kg a turn, stores start at 50,000). Player-facing text speaks in
// tonnes, the effect values stay kg.
export const EVENT_POOL = [
  // ── minor (severity 1): everyday ups and downs ──
  { id: 'supply',        title: 'Wagons Bound for the Siege', description: 'Your outriders fall on an enemy supply column making for the siege lines and drive off its laden wagons. +3 t of food.', severity: 1, effect: { type: 'food',       delta: +3000 } },
  { id: 'traders',       title: 'Sutlers from Downriver',    description: 'Camp-followers pole their barges up the Marn from friendly country to sell provisions to your army. +1.5 t of food.', severity: 1, effect: { type: 'food',       delta: +1500 } },
  { id: 'weather',       title: 'A Bitter Fortnight',        description: 'Cold rain rots the tents and spoils the stores in the trenches. -1 t of food.',           severity: 1, effect: { type: 'food',       delta: -1000 } },
  // ── normal (severity 2): the ranks swell or thin ──
  { id: 'reinforcement', title: 'The Rearguard Catches Up',  description: 'A company of your own rearguard, footsore from the march, rejoins the banner. +20 Soldiers.', severity: 2, effect: { type: 'roster',     unit: 'Soldier', delta: +20 } },
  { id: 'desertion',     title: 'Desertion in the Lines',    description: 'The long watch beside the siege saps the men; some slip away by night. 10% of soldiers desert.', severity: 2, effect: { type: 'roster',     unit: 'Soldier', factor: 0.9 } },
  // ── recon-sensitive fates (Stage 4 1c): thematic threats — raiders /
  // night-attack, never plague or weather — carry a three-rung ladder. The
  // event itself IS the Blind rung (the full blow, and always what the augur
  // foretells); the scouting band at end-of-turn picks the rung that actually
  // fires (EVENT_RUNG_BY_BAND → firedRung below). Ladders live HERE, not in
  // the stored slot copy (the augury schema keeps display fields only), so a
  // mid-campaign pool edit changes rungs, never an already-sealed fate.
  {
    id: 'forage_raiders', title: 'Forage Raiders', description: 'Enemy riders fall on your foraging parties: stores plundered, wagons burned, foragers cut down.', severity: 2,
    effect: { type: 'multi', effects: [{ type: 'food', delta: -4000 }, { type: 'materials', delta: -20 }, { type: 'roster', unit: 'Soldier', factor: 0.97 }] },
    reconSensitive: true,
    rungs: {
      warned:      { title: 'Raiders Intercepted', description: 'Your escorts meet the riders at the treeline — a few sacks lost, nothing more.', effect: { type: 'food', delta: -1000 } },
      anticipated: { title: 'Raiders Destroyed',   description: 'Your scouts tracked the raiding party for days; it rides into a killing ground and is wiped out.', effect: { type: 'enemy_losses', factor: 0.95 } },
    },
  },
  {
    id: 'night_raid', title: 'Night Raid', description: 'Raiders slip past the pickets in the dark: stores stolen, and shaken men desert by morning.', severity: 2,
    effect: { type: 'multi', effects: [{ type: 'food', delta: -2000 }, { type: 'roster', unit: 'Soldier', factor: 0.98 }] },
    reconSensitive: true,
    rungs: {
      warned:      { title: 'Pickets Hold',    description: 'The pickets catch the raiders at the ditch; they flee with next to nothing.', effect: { type: 'food', delta: -500 } },
      anticipated: { title: 'Prisoners Taken', description: 'The raiders walk into waiting spears. By dawn the prisoners have betrayed the enemy camp.', effect: { type: 'enemy_reveal' } },
    },
  },
  // ── major (severity 3): fates that bend the campaign ──
  { id: 'defection',     title: 'Turncoats from the Vanguard', description: 'Enemy soldiers, sick of the siege and their warlord\'s whip, slip across to your banner in the night. +40 Soldiers.', severity: 3, effect: { type: 'roster',     unit: 'Soldier', delta: +40 } },
  { id: 'plague',        title: 'Camp Fever',        description: 'Sickness runs your crowded camp; the ranks thin by 5%.',                                severity: 3, effect: { type: 'all_roster', factor: 0.95 } },
  // NOTE (2026-08-08): the `ambush` fate and the `enemy_advance` effect it
  // carried are GONE. That effect set bossFightDue outright, which made sense
  // when a pitched battle was one engagement among many — but the pitched
  // battle is now the campaign's decisive end (the battle route sets
  // status=won/lost either way). Since all three of a turn's true fates fire
  // at end-of-day, an ambush drawn on turn 1 finished the whole campaign on
  // turn 2, ~11% of turns, against a wall meter that needs 10+ turns. The
  // WALL METER IS NOW THE ONLY THING THAT SETS bossFightDue (dayResolution
  // step 4) — no fate may shortcut to the finale (user, 2026-08-08).
  // ── materials fates (Stage 3 sink feeds fortifications/militia) ──
  { id: 'quarry',        title: 'A Workable Seam',   description: 'Your pioneers strike stone and timber enough to shore up the earthworks. +25 materials.', severity: 1, effect: { type: 'materials',  delta: +25 } },
  { id: 'tool_rot',      title: 'Damp Ruins the Stores', description: 'Rain and river-mist rot the tools and cordage stacked in your camp. -15 materials.', severity: 2, effect: { type: 'materials',  delta: -15 } },
  // ── prerequisite-gated fates (R1) ── An event may carry a `requires` block
  // (eventEligible below); it only enters a draw when the campaign state
  // satisfies it, as truth OR decoy. Gated events are ADDITIVE — the
  // unconditional events already keep every tier legible (augury.test.js
  // tripwire), so a prerequisite can only widen a pool, never collapse it.
  // horse_sickness is the proof: a murrain among the mounts that can only
  // befall an army that actually fields cavalry.
  { id: 'horse_sickness', title: 'Horse Sickness', description: 'Murrain runs the picket lines; your mounts sicken and the worst must be put down.', severity: 2, effect: { type: 'roster', unit: 'Cavalry', factor: 0.9 }, requires: { hasUnit: 'Cavalry' } },
  // ── event chains (part 2) ── An outcome may `schedule` a guaranteed
  // follow-up fate N turns out (applyEffect `schedule` → campaign.scheduledEvents;
  // drawAugury drains it into a forced slot when its day arrives). The
  // follow-up carries `chained: true` so it never enters a random draw — it
  // reaches the player ONLY when the chain scheduled it. `captured_courier`
  // (a choice) → `sprung_ambush` is the proof: reading the enemy's dispatches
  // sets a trap that springs a fortnight later. The `sell_herd`-style branch
  // (ransom) schedules nothing, so the chain is the player's own choice echoing
  // forward. (The flag/eventFlags primitive from part 1 already lets a
  // *randomly-eligible* follow-up be gated on a prior choice via `requires`;
  // `schedule` is the new part-2 primitive for a GUARANTEED beat.)
  {
    id: 'captured_courier', title: 'A Captured Courier', description: 'Your outriders run down an enemy courier; his saddlebags are stuffed with the warlord\'s own dispatches.', severity: 2,
    effect: { type: 'choice' }, valence: 'good',
    choices: [
      { id: 'read_dispatches', label: 'Read the dispatches and lay a trap', description: 'His orders name the roads their foragers will ride. Set an ambush and wait — the blow will fall a fortnight hence.', effect: { type: 'schedule', event: 'sprung_ambush', delay: 1 } },
      { id: 'ransom_courier',  label: 'Ransom him back to the enemy',        description: 'Trade the man and his satchel back for supply, and learn nothing of what they intend.', effect: { type: 'food', delta: +2000 } },
    ],
  },
  { id: 'sprung_ambush', title: 'The Trap Is Sprung', description: 'Just as the dispatches foretold, an enemy foraging column rides down the ambush road — into your waiting spears. It is cut apart.', severity: 2, effect: { type: 'enemy_losses', factor: 0.9 }, chained: true },
  // ── the relief chain ── `relief_rider` (a choice) can guarantee a
  // reinforcement a fortnight out via `schedule`; `relief_column_arrives` is the
  // `chained` follow-up (never a random draw or decoy). The forage branch
  // schedules nothing, so the chain is the player's own choice echoing forward.
  {
    id: 'relief_rider', title: 'A Rider from the Relief Host', description: 'A mud-spattered rider gallops in from the west: the Warden\'s main host is a fortnight behind you, and its captains beg for guides who know the fords and the enemy\'s watch-lines.', severity: 2,
    effect: { type: 'choice' }, valence: 'good',
    choices: [
      { id: 'send_guides',  label: 'Send your best scouts to guide them in', description: 'Part with your surest scouts so the main host loses no time on the roads. They will not forage for you this fortnight — but a column of fresh spears is worth the lean days.', effect: { type: 'schedule', event: 'relief_column_arrives', delay: 1 } },
      { id: 'keep_foraging', label: 'Keep your scouts foraging the valley', description: 'Let the main host find its own way. Your scouts stay at their sacks and snares, and the larder is the fuller for it.', effect: { type: 'food', delta: +2000 } },
    ],
  },
  { id: 'relief_column_arrives', title: 'The Relief Column Arrives', description: 'Guided past the enemy\'s watch-lines by your scouts, a column of the Warden\'s spearmen tramps into camp, banners heavy with road-dust. +30 Soldiers.', severity: 2, effect: { type: 'roster', unit: 'Soldier', delta: +30 }, chained: true },
  // ── the scripted siege spine (S8, docs/CAMPAIGN_PLAN.md) ── Three GUARANTEED
  // beats seeded onto campaign.scheduledEvents at creation (SIEGE_SPINE below,
  // turns 2/5/8), all `chained: true` so they never enter a random draw — the
  // schedule queue forces each into a slot on its day. All early (before a
  // walls breach can plausibly land), so no clash with the meter. The spine is
  // the garrison relationship's on-ramp: the Turn-2 beat is the guaranteed early
  // resolve lever (fixes "resolve can stall at the start if garrison_call never
  // draws"). Each is a choice; numbers are tunable, balance stays rough.
  {
    id: 'siege_lines_close', title: 'The Siege Lines Close', description: 'The enemy pushes their saps and gabions ever closer to Karrowgate\'s wall, and a runner slips out to beg a working party before the next stretch is battered open.', severity: 2,
    effect: { type: 'choice' }, valence: 'neutral', chained: true,
    choices: [
      { id: 'send_working_party', label: 'Send a working party to shore up the wall', description: 'Spend from your own stores to strengthen the threatened stretch. The garrison marks who came when the siege lines tightened.', effect: { type: 'multi', effects: [{ type: 'food', delta: -1500 }, { type: 'garrison', delta: +15 }] } },
      { id: 'hold_stores',        label: 'Hold your stores and your men',            description: 'The wall is theirs to hold. You keep every sack and every hand for your own column.', effect: { type: 'none' } },
    ],
  },
  {
    id: 'breach_threatens', title: 'A Breach Threatens', description: 'The enemy\'s engines have gnawed a stretch of Karrowgate\'s wall to rubble; by nightfall it may be practicable. The garrison sends up a desperate plea for spears to hold the gap.', severity: 2,
    effect: { type: 'choice' }, valence: 'neutral', chained: true,
    choices: [
      { id: 'into_the_breach', label: 'Throw men into the breach beside them', description: 'Send your own into the rubble to fight shoulder to shoulder with the garrison — costly in stores and blood, but a bond forged under fire holds.', effect: { type: 'multi', effects: [{ type: 'food', delta: -2000 }, { type: 'roster', unit: 'Soldier', factor: 0.98 }, { type: 'garrison', delta: +15 }] } },
      { id: 'cannot_spare',    label: 'You cannot spare them',                 description: 'You need every spear for the pitched battle to come. The garrison holds the breach alone — and does not forget who stayed in camp.', effect: { type: 'garrison', delta: -10 } },
    ],
  },
  {
    id: 'wardens_van', title: 'The Warden\'s Van', description: 'Word comes that the Warden\'s vanguard is nearing the Marn — but the enemy has thrown out a screen to hold them off. Pin the besiegers in place, and the van breaks through; let them fend for themselves, and hoard your own strength.', severity: 2,
    effect: { type: 'choice' }, valence: 'good', chained: true,
    choices: [
      { id: 'pin_the_van',      label: 'Pin the besiegers so the van breaks through', description: 'Harry the screen hard enough to fix it in place. It costs you the fortnight\'s rest, but a column of the Warden\'s own men is coming — a fortnight or so behind.', effect: { type: 'schedule', event: 'relief_van_arrives', delay: 2 } },
      { id: 'husband_strength', label: 'Husband your strength for the walls',           description: 'Let the van shift for itself. Your men rest and forage the valley, and the larder is the fuller for it.', effect: { type: 'food', delta: +2000 } },
    ],
  },
  { id: 'relief_van_arrives', title: 'The Warden\'s Van Arrives', description: 'Held in place by your harrying, the enemy screen could not stop them: the Warden\'s vanguard tramps into your lines, weary but eager for the fight. +25 Soldiers.', severity: 2, effect: { type: 'roster', unit: 'Soldier', delta: +25 }, chained: true },
  // ── Garrison Resolve cooperation (docs/CAMPAIGN_PLAN.md "Garrison Resolve",
  // slice 1) ── Fates that move the standing track (the `garrison` effect) and,
  // via the `requires` minResolve/maxResolve gate, appear only at the right
  // standing. `garrison_call` FEEDS the track (a choice: spend stores to raise
  // it, or keep them); `garrison_lookout` is the high-trust PAYOFF it unlocks
  // (gated minResolve, an `enemy_reveal` the walls hand you); `garrison_spurned`
  // is the soured-relationship fate (gated maxResolve). The passive wall-slow +
  // boss-fight sally that also hang off resolve come in later slices.
  {
    id: 'garrison_call', title: 'The Garrison Calls', description: 'A runner slips out of a Karrowgate sally-port at dusk: the garrison begs you to help hold a stretch of wall the enemy has been battering thin.', severity: 2,
    effect: { type: 'choice' }, valence: 'neutral',
    choices: [
      { id: 'answer_the_call', label: 'Send provisions and a working party to the walls', description: 'Spend from your own stores to stiffen the threatened stretch. The garrison marks who stood with them when the wall shook — and stands the taller for it.', effect: { type: 'multi', effects: [{ type: 'food', delta: -1500 }, { type: 'garrison', delta: +15 }] } },
      { id: 'tend_your_own',   label: 'Keep your men and stores at their own work', description: 'The wall is theirs to hold. You keep every sack and every hand for your own column.', effect: { type: 'none' } },
    ],
  },
  { id: 'garrison_lookout', title: 'Word from the Ramparts', description: 'Trusting the banner that has stood with them, Karrowgate\'s watch signal down what they can see from the high walls — the enemy\'s dispositions, laid plain.', severity: 2, effect: { type: 'enemy_reveal' }, requires: { minResolve: 60 } },
  { id: 'garrison_spurned', title: 'The Garrison Turns Its Back', description: 'Bitter at a relief army that lets their wall be ground down, the defenders jeer your scouts from the parapet; the slight runs through your own camp and a few men slink off.', severity: 2, effect: { type: 'roster', unit: 'Soldier', factor: 0.97 }, requires: { maxResolve: 33 } },
  // ── Garrison-support S9: resolve-gated pool fates ── More garrison fates
  // through the `requires` minResolve/maxResolve doors, gates aligned to the S5
  // level thresholds (low 1..33 / normal 34..66 / determined 67..100). A
  // DETERMINED garrison (≥67) opens the trust-gifts: `garrison_stores` (a runner
  // brings you the garrison's own stores), `garrison_paychest` (coin they cannot
  // spend behind their own walls) and `garrison_night_sally` (the
  // defenders sally on their own to maul the besiegers — distinct from the
  // player-committed sortie raid). A LOW garrison (≤33) opens the soured band:
  // `garrison_recovery` (mend the bond with stores, or turn away and fray it
  // further), pairing with the realigned `garrison_spurned`. All additive — each
  // carries `requires`, so the unconditional base pool the legibility tripwire
  // guards is untouched.
  { id: 'garrison_stores', title: 'Stores from the Wall', description: 'Under cover of dark a file of the garrison lowers sacks and casks from a sally-port and passes them out to your foragers — their own stores, shared with the army that has stood by them. +2 t of food.', severity: 1, effect: { type: 'food', delta: +2000 }, requires: { minResolve: 67 } },
  // The third determined-band gift, and the second earn source for `gold`
  // after raids (docs/CAMPAIGN_PLAN.md, Recruit phase — Stage E): coin is no
  // use to men who cannot get out to spend it, so a garrison that trusts you
  // sends its paychest over the wall to the army that can put it to work.
  { id: 'garrison_paychest', title: 'The Garrison\'s Paychest', description: 'Karrowgate\'s paymaster has a chest of coin and nowhere inside the walls to spend it. Trusting you to buy what the siege denies them, the garrison lowers it to your quartermasters. +75 gold.', severity: 1, effect: { type: 'gold', delta: +75 }, requires: { minResolve: 67 } },
  { id: 'garrison_night_sally', title: 'A Sally in the Night', description: 'Needing no prompting from you, the garrison throws open a postern in the small hours and falls on the sleeping siege lines; by dawn the enemy\'s forward works are a shambles of cut ropes and dead men.', severity: 3, effect: { type: 'enemy_losses', factor: 0.92 }, requires: { minResolve: 67 } },
  {
    id: 'garrison_recovery', title: 'A Chance to Mend the Bond', description: 'The garrison\'s trust has worn thin, but a grey-haired captain sends word over the wall: stand with them now, and the old faith might be rekindled.', severity: 2,
    effect: { type: 'choice' }, valence: 'neutral', requires: { maxResolve: 33 },
    choices: [
      { id: 'mend_the_bond', label: 'Send stores and stand the watch with them', description: 'Spend from your larder to prove your word. The garrison marks it, and something of the old trust comes back.', effect: { type: 'multi', effects: [{ type: 'food', delta: -2000 }, { type: 'garrison', delta: +15 }] } },
      { id: 'turn_away',      label: 'Turn away — you have your own to feed',      description: 'Keep your stores whole. The captain\'s face closes, and word of it hardens every heart on the wall against you.', effect: { type: 'garrison', delta: -10 } },
    ],
  },
  // ── fates with choices (resolve-then-choose) ── The fired rung's `choices`
  // hand the player a decision instead of an effect: end-day pends it
  // (dayResolution) and a follow-up POST applies the picked branch. Branches
  // live HERE like the rung ladders (the slot copy stores display fields plus
  // the `choice` sentinel — the schema requires an effect; it never applies).
  // Option text is phrases only, NO numbers (augury.test.js tripwires it) —
  // the player weighs directions, never exact magnitudes. A choice event has
  // no single effect, so it DECLARES its valence for the augur's header and
  // the counter_event raid draw (eventValenceFor below).
  {
    id: 'merchant_caravan', title: 'A Merchant Caravan', description: 'A well-guarded trade caravan makes camp within sight of your pickets, its masters keen to deal.', severity: 1,
    effect: { type: 'choice' }, valence: 'neutral',
    choices: [
      { id: 'buy_provisions',     label: 'Buy up their provisions',   description: 'Pay in tools and timber to fill the larder against the lean weeks ahead.', effect: { type: 'multi', effects: [{ type: 'materials', delta: -15 }, { type: 'food', delta: +3000 }] } },
      { id: 'sell_for_materials', label: 'Trade rations for their wares', description: 'Part with some of your stores for the cordage, nails and worked timber the camp sorely needs.', effect: { type: 'multi', effects: [{ type: 'food', delta: -2000 }, { type: 'materials', delta: +25 }] } },
    ],
  },
  {
    id: 'refugees', title: 'Refugees at the Palisade', description: 'A column of burned-out villagers begs shelter at the camp gates.', severity: 1,
    effect: { type: 'choice' }, valence: 'neutral',
    choices: [
      { id: 'turn_away', label: 'Turn them away',                    description: 'The war is not theirs to eat through. They trudge on; the stores stay whole.', effect: { type: 'none' } },
      { id: 'take_in',   label: 'Take them in — more mouths, more hands', description: 'Feeding them will cost stores, but the able-bodied among them will take up arms as militia.', effect: { type: 'multi', effects: [{ type: 'food', delta: -3000 }, { type: 'roster', unit: 'Militia', delta: +20 }] } },
    ],
  },
  {
    id: 'baggage_plague', title: 'Plague in the Baggage Train', description: 'Fever breaks out among the wagons; the sick multiply by the day.', severity: 2,
    effect: { type: 'choice' }, valence: 'bad',
    choices: [
      { id: 'quarantine', label: 'Quarantine and burn the tainted stores', description: 'Harsh, but sure: the sickness dies with the supplies it touched.', effect: { type: 'food', delta: -4000 } },
      { id: 'march_on',   label: 'March on and trust to providence',       description: 'Keep the stores and the pace — and let the fever take whom it takes.', effect: { type: 'all_roster', factor: 0.98 } },
    ],
  },
  // The first two `forage_modifier` fates (S3) — one per target, so both levers
  // of the standing-pressure system have a live source. Each leaves a mark that
  // lasts the rest of the campaign unless the player fights it off: the raidable
  // branches put a persistent card on the raid board (generateRaidOpportunities)
  // that lifts the modifier by being beaten.
  {
    id: 'foraging_riders', title: 'Riders in the Foraging Grounds', description: 'Enemy light horse have taken to shadowing your foraging parties — never closing, never quite leaving. The wagons come back lighter each day.', severity: 2,
    effect: { type: 'choice' }, valence: 'bad',
    choices: [
      // Buy the problem off yourself: a smaller, PERMANENT tax with no card to
      // beat — the escorts are troops not gathering, for the rest of the war.
      { id: 'escort', label: 'Escort every party', description: 'Spears walk with the wagons from now on. The riders keep their distance — and your foragers are that many fewer.', effect: { type: 'forage_modifier', id: 'foraging_riders', label: 'Foraging parties under escort', target: 'playerYield', factor: 0.85, raidable: false } },
      // Take the harder hit for a chance to end it outright.
      { id: 'unguarded', label: 'Let them forage unguarded', description: 'Every hand stays on the harvest and the riders are left to their sport — until you can find their camp and finish them.', effect: { type: 'forage_modifier', id: 'foraging_riders', label: 'Harried by enemy horse', target: 'playerYield', factor: 0.6, raidable: true } },
    ],
  },
  {
    id: 'enemy_supply_depot', title: 'The Enemy Digs In', description: 'Scouts report the enemy has thrown up a fortified supply depot behind their lines and is stripping the countryside on a schedule now, not by chance.', severity: 2,
    // enemyDrain, so the mood flips: MORE enemy drain empties the shared rings
    // faster. Raidable — the depot is a thing you can burn.
    effect: { type: 'forage_modifier', id: 'enemy_supply_depot', label: 'Enemy supply depot', target: 'enemyDrain', deltaKg: 4000, raidable: true },
  },
  // A major boon with a real three-way fork: turn footmen into a mounted arm
  // NOW, bank the animals as remounts for the Recruit phase, or cash the herd
  // in for supply. The mount branch is the `convert` mechanic's first use —
  // Soldiers become Cavalry (a placeable/spawnable engine unit), at a cost in
  // materials for tack and shoeing. The keep branch (Stage E, grilled
  // 2026-08-03) is the EVENT tap for `horses`, beside the raid board's horse
  // drove: headcount parity with mounting the veterans, so the fork is a
  // choice of KIND, not of size — upgrade the men you already have at once,
  // versus a stockpile that grows the army instead but spends food, materials
  // and irreplaceable workers a hire at a time, across days of the one-hire
  // cadence.
  {
    id: 'horses', title: 'A Captured Herd', description: 'Your outriders drive in a herd of enemy remounts — sound warhorses by the dozen, yours to use as you will.', severity: 3,
    effect: { type: 'choice' }, valence: 'good',
    choices: [
      { id: 'mount_veterans', label: 'Mount your veterans as cavalry', description: 'Put your steadiest footmen in the saddle. Saddlery and shoeing eat into your materials, but you raise a mounted arm from your own ranks.', effect: { type: 'multi', effects: [{ type: 'convert', from: 'Soldier', to: 'Cavalry', count: 25 }, { type: 'materials', delta: -20 }] } },
      { id: 'keep_the_herd',  label: 'Keep the herd at the horse lines', description: 'Spend none of them today. The animals stand ready at the picket, and your recruiting officers put a rider on each in their own time.', effect: { type: 'horses', delta: +25 } },
      { id: 'sell_herd',      label: 'Sell the herd to the baggage train', description: 'Trade the horses to the quartermasters for supply. The stores swell and the wagons roll a little heavier.', effect: { type: 'multi', effects: [{ type: 'materials', delta: +30 }, { type: 'food', delta: +4000 }] } },
    ],
  },
  {
    id: 'sellswords', title: 'Sellswords at the Camp', description: 'A free company of veteran mercenaries rides in and offers their spears — for the right price in supply.', severity: 2,
    effect: { type: 'choice' }, valence: 'good',
    choices: [
      { id: 'hire', label: 'Hire the company', description: 'Pay them out of your stores and swell your line with hardened fighters who ask no oath but coin.', effect: { type: 'multi', effects: [{ type: 'roster', unit: 'Soldier', delta: +20 }, { type: 'food', delta: -3000 }, { type: 'materials', delta: -10 }] } },
      { id: 'decline', label: 'Send them on their way', description: 'You keep your stores whole; they shrug and ride off to sell their steel elsewhere.', effect: { type: 'none' } },
    ],
  },
  {
    id: 'drillmaster', title: 'A Hard-Handed Drillmaster', description: 'A grizzled sergeant offers to break your raw levy into proper soldiers — if you can feed them through the drilling.', severity: 2,
    effect: { type: 'choice' }, valence: 'neutral',
    choices: [
      { id: 'drill', label: 'Drill the levy into soldiers', description: 'Weeks of hard training on full rations turn militia into line troops — at a real cost in food.', effect: { type: 'multi', effects: [{ type: 'convert', from: 'Militia', to: 'Soldier', count: 20 }, { type: 'food', delta: -3000 }] } },
      { id: 'leave_be', label: 'Leave them to forage', description: 'Keep the levy at their sacks and spades. Green they stay, but the stores stay fuller.', effect: { type: 'none' } },
    ],
  },
  {
    id: 'deserter_lord', title: 'An Enemy Captain Defects', description: 'An enemy officer, out of favour with his warlord, slips into camp under a white flag with his whole company at his back.', severity: 3,
    effect: { type: 'choice' }, valence: 'good',
    choices: [
      { id: 'take_the_oath', label: 'Take his oath and his men', description: 'Swell your banner with a full company of turncoats — trusting that a man who betrayed once will not do it twice.', effect: { type: 'roster', unit: 'Soldier', delta: +35 } },
      { id: 'send_home', label: 'Send him back to sow discord', description: 'Refuse the oath but let him return whispering mutiny — his warlord\'s ranks thin as the rot spreads.', effect: { type: 'enemy_losses', factor: 0.93 } },
    ],
  },
  // ── neutral fates: something happens, nothing tips the scales. One per pool
  // so all three magnitudes of the "neutral" reading show up in play. A
  // `none` effect is a genuine no-op at end-of-turn — the drama is in the
  // reading, not the result (a "dire" omen that comes to nothing is a relief).
  { id: 'lull',          title: 'A Quiet Fortnight', description: 'The siege grinds on without incident — no gift, no blow.',  severity: 1, effect: { type: 'none' } },
  { id: 'rains',         title: 'Season of Rains',   description: 'Downpours foul every bowstring on both siege lines alike. Neither host gains an edge.', severity: 2, effect: { type: 'none' } },
  { id: 'comet',         title: 'A Comet Overhead',  description: 'A comet burns over Karrowgate for a fortnight. The men mutter of doom, but nothing comes of it.', severity: 3, effect: { type: 'none' } },
]
// (The old 'intel' event died with auguryScore; a defector event returns as a
// scouting-points effect when the scouting stage lands.)

// Garrison sortie events (Garrison Resolve slice 4, docs/CAMPAIGN_PLAN.md) — the
// third cost feeding the resolve track: committed troops. These are NOT augury
// fates (they never appear in EVENT_POOL, so never a vision or decoy). They are
// authored as events so they can reuse the event-prerequisite machinery — each
// is `requires`-gated on the garrison's own standing (minResolve). The raid
// board (generateRaidOpportunities, raid.js) spawns a `garrison_sortie` raid
// opportunity for every one whose gate is currently met, so the OFFER itself is
// the raid: commit a party (a raid-style battle, cost = battle-day readiness,
// the troops land in raid.assignment) and a WIN feeds `sortie.resolve` back into
// the track. A version either thins the besiegers (`thinsEnemy`) OR pays other
// loot — the enemy-reduction is one possible reward, unneeded when there's
// another (user, 2026-07-22). resolve gained is hidden bookkeeping (adjustResolve),
// never a number in the log; the loot (if any) is a normal revealable reward.
export const GARRISON_SORTIE_EVENTS = [
  {
    id: 'sortie_probe',
    title: 'A Coordinated Sally',
    description:
      'Karrowgate\'s captains, heartened that you have stood with them, propose a joint stroke: your squads strike the siege lines from without while the garrison sallies from a postern to catch the besiegers between two fires. Commit a party and hit them together.',
    // Steadfast trust or better — a garrison that has come to rely on you.
    requires: { minResolve: 50 },
    sortie: { resolve: 10, thinsEnemy: true },
  },
  {
    id: 'sortie_grand',
    title: 'A Sortie Against the Siege Train',
    description:
      'Trusting your banner utterly, the garrison offers to throw the gates wide for a combined blow at the enemy\'s siege park. Break in among the engines and wagons massed against the walls, and carry off what stores you can while the defenders cover your withdrawal.',
    // Only a devoted garrison risks opening its own gates for you.
    requires: { minResolve: 75 },
    sortie: { resolve: 14, materials: 250 },
  },
]

// The scripted siege spine (S8): the schedule seeded onto campaign.scheduledEvents
// at creation (routes/campaigns.js). Each entry forces its `chained` beat (above)
// into an augury slot when the campaign reaches `day` (drawAugury → drainScheduled).
// All early turns, before a walls breach can plausibly land.
export const SIEGE_SPINE = [
  { eventId: 'siege_lines_close', day: 2 },
  { eventId: 'breach_threatens', day: 5 },
  { eventId: 'wardens_van', day: 8 },
]

export const rosterTotal = (roster) =>
  [...roster.values()].reduce((a, b) => a + b, 0)

// The augur's state (roster, eventFlags) reaches here as a Mongoose Map on the
// live doc but a plain object at creation-time draws and in tests — read both.
const bagGet = (bag, key) => (bag instanceof Map ? bag.get(key) : bag?.[key]) ?? 0

// Prerequisites (R1): does this event's `requires` block hold against the
// current campaign context {day, roster, eventFlags}? An event with no
// `requires` is always eligible. Every clause is ANDed; the context is
// duck-typed so the same predicate serves the draw path (live doc), the
// creation route (plain STARTING_ROSTER), and the unit tests. Ineligible
// events are dropped from the draw entirely — a gated fate can be neither the
// truth nor the decoy until its trigger is met, so a chain's later beat can't
// surface early and a state-flavoured fate can't fire on the wrong army.
export const eventEligible = (event, ctx = {}) => {
  const req = event.requires
  if (!req) return true
  const day = ctx.day ?? 1
  if (req.minDay != null && day < req.minDay) return false
  if (req.maxDay != null && day > req.maxDay) return false
  if (req.flags && !req.flags.every((f) => bagGet(ctx.eventFlags, f) > 0)) return false
  if (req.notFlags && req.notFlags.some((f) => bagGet(ctx.eventFlags, f) > 0)) return false
  if (req.hasUnit && bagGet(ctx.roster, req.hasUnit) <= 0) return false
  // Garrison Resolve gate: the standing track opens high-trust garrison fates
  // and closes them (or unlocks soured-relationship ones) as the relationship
  // shifts. Absent garrison context reads as the starting resolve, so a
  // creation-time draw gates exactly as a fresh campaign would.
  if (req.minResolve != null || req.maxResolve != null) {
    const resolve = ctx.garrison?.resolve ?? GARRISON_RESOLVE_START
    if (req.minResolve != null && resolve < req.minResolve) return false
    if (req.maxResolve != null && resolve > req.maxResolve) return false
  }
  return true
}

// The draw pool as the campaign state currently allows it. The augur draws
// both the truth and the decoy from here (augury.js), so nothing ineligible
// can ever reach the player. `chained` events (part 2 follow-ups) are excluded
// outright: they are guaranteed beats surfaced ONLY by the schedule queue
// (drawAugury drains them into forced slots), never a random draw or a decoy.
export const eligiblePool = (ctx) =>
  EVENT_POOL.filter((e) => !e.chained && eventEligible(e, ctx))

// The single source of an event's mood: good / bad / neutral, derived from its
// own effect. The augur's header labels the SHOWN card with this (so a bluff
// reads as the flavour it shows), and the pool leak-guards use it too — one
// classifier, so the two can never disagree. Anything without a clear gain or
// loss (a no-op `none`, or an unknown effect) is neutral.
export const eventValence = (effect) => {
  if (!effect) return 'neutral'
  switch (effect.type) {
    case 'food':
    case 'materials':
    case 'gold':
    case 'horses':
      return effect.delta > 0 ? 'good' : effect.delta < 0 ? 'bad' : 'neutral'
    case 'roster':
      if (effect.delta !== undefined)
        return effect.delta > 0 ? 'good' : effect.delta < 0 ? 'bad' : 'neutral'
      return effect.factor > 1 ? 'good' : effect.factor < 1 ? 'bad' : 'neutral'
    case 'all_roster':
      return effect.factor > 1 ? 'good' : effect.factor < 1 ? 'bad' : 'neutral'
    // The enemy's losses and betrayed secrets are our gain.
    case 'enemy_losses':
    case 'enemy_reveal':
      return 'good'
    // Upgrading units in place (mount soldiers as cavalry) is a gain.
    case 'convert':
      return 'good'
    // A Garrison Resolve move is a relationship shift, neither gain nor loss —
    // its sibling effects in a bundle carry the fate's actual mood.
    case 'garrison':
      return 'neutral'
    // A standing forage pressure (S3). The two targets read in OPPOSITE
    // directions: more of the player's own capacity is a gain, but more enemy
    // drain strips the shared rings faster, so it's a loss. Both levers point
    // the same way once the sign is flipped for the enemy-side one.
    case 'forage_modifier': {
      const lift = (effect.factor ?? 1) - 1 + (effect.deltaKg ?? 0)
      const forPlayer = effect.target === 'enemyDrain' ? -lift : lift
      return forPlayer > 0 ? 'good' : forPlayer < 0 ? 'bad' : 'neutral'
    }
    // A bundle reads as its parts' shared mood; genuinely mixed bundles
    // (a gain and a loss in one fate) net out to neutral.
    case 'multi': {
      const moods = new Set(
        effect.effects.map(eventValence).filter((v) => v !== 'neutral'),
      )
      return moods.size === 1 ? [...moods][0] : 'neutral'
    }
    default:
      return 'neutral'
  }
}

// What an effect DOES, in the abstract: the MATH, never the outcome of a roll
// (user, 2026-08-10 — "if there is a roll, you don't need to show the result of
// the roll, just the math"). A fate that reads as pure flavour is a fate the
// player cannot price, which is the whole complaint this answers.
//
// Deliberately NOT a dump of the effect's fields. It goes to the same player as
// applyEffect's log, so it obeys the same disclosure rules, and getting this
// wrong would quietly undo three separate gates:
//   - hidden state never crosses as a NUMBER. `garrison` and `schedule` move
//     bookkeeping the prerequisite gates read (minResolve thresholds, the
//     scheduled queue), so they describe as a DIRECTION only — see below.
//     `flag` stays silent outright.
//   - the enemy's numbers are recon-gated, so enemy-side effects stay PHRASES.
//   - an enemy-side forage modifier is likewise a phrase; only the player's own
//     yield carries a figure.
//
// The direction-only lines for `garrison`/`schedule` are new (2026-08-10, the
// "every card states its reward" pass) and replace a blanket silence. The
// silence was over-broad: it was reasoned for applyEffect's LOG, where naming a
// scheduled follow-up would spoil a beat the player never chose. But every
// `schedule` and `garrison` effect in the pool sits on a CHOICE the player is
// being asked to make, and each option's own prose already promises the thing
// ("the blow will fall a fortnight hence", "does not forget who stayed in
// camp"). Saying it mechanically therefore leaks nothing new, while the silence
// left five options priceable only by reading tone. Numbers still never cross:
// no resolve delta, no scheduled event id, no target day.
// Returns an array so `multi` flattens naturally and callers can join to taste.
export const describeEffect = (effect) => {
  if (!effect) return []
  // Zero takes NO sign: "Food −0 t" is what a naive ternary prints, and it
  // reads as a loss that isn't one. Unreachable from today's pool (a nothing
  // event is `type: 'none'` → "No consequence"), but the reveal card now shows
  // these lines on every fate, so an authoring slip must not print a lie.
  const sign = (n) => (n > 0 ? '+' : n < 0 ? '−' : '')
  const signed = (n) => `${sign(n)}${Math.abs(n)}`
  const tons = (kg) => `${+(Math.abs(kg) / 1000).toFixed(1)} t`
  const signedTons = (kg) => `${sign(kg)}${tons(kg)}`
  switch (effect.type) {
    case 'food':
      return [`Food ${signedTons(effect.delta)}`]
    case 'materials':
      return [`Materials ${signed(effect.delta)}`]
    case 'gold':
      return [`Gold ${signed(effect.delta)}`]
    case 'horses':
      return [`Horses ${signed(effect.delta)}`]
    case 'roster':
      return [
        effect.delta !== undefined
          ? `${effect.unit} ${signed(effect.delta)}`
          : `${effect.unit} ×${effect.factor}`,
      ]
    case 'all_roster':
      return [`Every unit ×${effect.factor}`]
    case 'convert':
      return [`Up to ${effect.count} ${effect.from} → ${effect.to}`]
    case 'enemy_losses':
      // The MULTIPLIER, not a headcount: how hard the enemy is hit is the
      // mechanical fact the player is owed, and it discloses nothing about how
      // many of them there are — which is the recon-gated part.
      return [`The enemy host ×${effect.factor}`]
    case 'enemy_reveal':
      return ['The enemy host lies open to your scouts for a turn']
    case 'forage_modifier': {
      if (effect.target === 'enemyDrain')
        return [
          (effect.deltaKg ?? 0) >= 0
            ? 'The enemy strips the countryside faster'
            : 'The enemy strips the countryside slower',
        ]
      if (effect.deltaKg) return [`Your foraging ${signedTons(effect.deltaKg)}/turn`]
      return [`Your foraging ×${effect.factor ?? 1}`]
    }
    case 'garrison':
      // Direction, never the delta — the resolve TRACK is what minResolve /
      // maxResolve gates read, so a figure here would let the player solve for
      // which fates are about to open or close.
      return [
        effect.delta > 0
          ? 'Karrowgate thinks the better of you'
          : effect.delta < 0
            ? 'Karrowgate thinks the worse of you'
            : 'Karrowgate\'s regard is unmoved',
      ]
    case 'schedule':
      // That a follow-up is coming, and nothing else: naming the event would
      // spoil the beat, and the target day would hand over the queue the
      // augury drains. `delay` is not disclosed for the same reason.
      return ['Sets a fate in motion, to come to pass in a later turn']
    case 'multi':
      return (effect.effects ?? []).flatMap(describeEffect)
    case 'none':
      return ['No consequence']
    default:
      return [] // flag (pure bookkeeping) / choice / unknown — see above
  }
}

// A choice branch as the player sees it on a card: its label, its prose, and —
// since 2026-08-10 — what it MECHANICALLY does. The effect itself never
// crosses (the branch is re-looked-up by id at choose time), so effectText is
// the only channel by which an option can be priced.
//
// One helper because two places build these cards — the tent's reveal beat
// (dayResolution's pendChoice) and the campaign view's pendingChoices — and a
// player who read an option at the tent must not meet a different one when the
// decision is still owed a screen later.
export const optionCard = ({ id, label, description, effect }) => ({
  id,
  label,
  description,
  effectText: describeEffect(effect),
})

// An EVENT's mood, where eventValence above classifies an EFFECT: honours a
// declared `valence` (looked up in the pool by id, since a stored slot copy
// carries neither the declaration nor the choices it stands in for), falling
// back to the effect-derived one. Use this wherever the input is an event —
// the augur's header (campaignView) and the counter_event raid draw both do.
export const eventValenceFor = (event) => {
  const pooled = EVENT_POOL.find((e) => e.id === event?.id)
  return pooled?.valence ?? eventValence(event?.effect)
}

// The choice set a pending decision points at: pool lookup by event id +
// fired rung (the sealed-fate rule — a mid-campaign pool edit changes the
// branches, never an already-recorded decision's identity). Null when the id
// is gone from the pool or the rung carries no choices.
export const choiceRung = (eventId, rung) => {
  const pooled = EVENT_POOL.find((e) => e.id === eventId)
  const def = rung === 'blind' ? pooled : pooled?.rungs?.[rung]
  if (!def?.choices) return null
  return { title: def.title, description: def.description, choices: def.choices }
}

// Mutates the campaign in place; caller saves. Returns log lines.
export function applyEffect(campaign, effect) {
  const log = []
  if (effect.type === 'food') {
    campaign.resources.food = Math.max(0, campaign.resources.food + effect.delta)
    log.push(`Food ${effect.delta > 0 ? '+' : ''}${+(effect.delta / 1000).toFixed(1)} t.`)
  } else if (effect.type === 'materials') {
    campaign.resources.materials = Math.max(0, campaign.resources.materials + effect.delta)
    log.push(`Materials ${effect.delta > 0 ? '+' : ''}${effect.delta}.`)
  } else if (effect.type === 'gold') {
    // Coin (Recruit phase, Stage E): a plain visible resource like food and
    // materials — the caster lane's currency, so the figure is exactly what
    // the player weighs a Mage or Priest hire against.
    campaign.resources.gold = Math.max(0, (campaign.resources.gold ?? 0) + effect.delta)
    log.push(`Gold ${effect.delta > 0 ? '+' : ''}${effect.delta}.`)
  } else if (effect.type === 'horses') {
    // Remounts (Recruit phase, Stage E): the event tap for the resource
    // Cavalry/LightCavalry hires spend, beside the raid board's horse drove.
    // Visible like gold — a hire costs five, so the figure is what the player
    // counts hires in.
    campaign.resources.horses = Math.max(0, (campaign.resources.horses ?? 0) + effect.delta)
    log.push(`Horses ${effect.delta > 0 ? '+' : ''}${effect.delta}.`)
  } else if (effect.type === 'roster') {
    const cur = campaign.roster.get(effect.unit) ?? 0
    const next =
      effect.delta !== undefined
        ? Math.max(0, cur + effect.delta)
        : Math.floor(cur * effect.factor)
    campaign.roster.set(effect.unit, next)
    log.push(`${effect.unit}: ${cur} → ${next}.`)
  } else if (effect.type === 'all_roster') {
    for (const [type, n] of campaign.roster)
      campaign.roster.set(type, Math.floor(n * effect.factor))
    log.push(`All units ×${effect.factor}.`)
  } else if (effect.type === 'enemy_losses') {
    // The scouts' reversal (anticipated rung): the blow lands on the enemy
    // instead. The log is player-visible, so it stays a phrase — enemy
    // numbers never leak through it.
    for (const [type, n] of campaign.enemy.army)
      campaign.enemy.army.set(type, Math.floor(n * effect.factor))
    log.push('The enemy detachment is cut down to a man.')
  } else if (effect.type === 'enemy_reveal') {
    // Prisoners talk: the enemy is an open book for the coming turn (applied
    // at end-of-day N, so day N+1 — campaignView widens the enemy view to the
    // full Overwhelming tier while it holds).
    campaign.enemy.revealedUntilDay = campaign.day + 1
    log.push('Prisoners betray the enemy camp — their host is laid bare.')
  } else if (effect.type === 'convert') {
    // Upgrade units in place: up to `count` of `from` become `to` (mount
    // soldiers as cavalry). Capped at what the source holds — no negative
    // roster, and you only ever upgrade troops you actually have.
    const cur = campaign.roster.get(effect.from) ?? 0
    const moved = Math.min(effect.count, cur)
    campaign.roster.set(effect.from, cur - moved)
    campaign.roster.set(effect.to, (campaign.roster.get(effect.to) ?? 0) + moved)
    log.push(`${moved} ${effect.from} → ${effect.to}.`)
  } else if (effect.type === 'flag') {
    // Chain/prerequisite bookkeeping (R0): mark campaign state so a later fate
    // can gate on it (eventEligible). `value` sets, `delta` increments,
    // default set-to-1 (a plain "this happened" marker). Produces NO log line
    // — a flag is hidden state; the chain's narrative lives in event text, and
    // a numeric line here would leak that state to the player.
    if (!campaign.eventFlags) campaign.eventFlags = new Map()
    const flags = campaign.eventFlags
    const cur = bagGet(flags, effect.name)
    const next = effect.delta !== undefined ? cur + effect.delta : (effect.value ?? 1)
    if (flags instanceof Map) flags.set(effect.name, next)
    else flags[effect.name] = next
  } else if (effect.type === 'forage_modifier') {
    // Standing forage pressure (S3): push a modifier onto forage.modifiers,
    // where resolveForaging folds it into the player's capacity or the enemy's
    // drain every turn until something lifts it. Permanent unless `turnsLeft`
    // says otherwise — the campaign is short, so a setback should mark it.
    // Re-granting the same id REPLACES rather than stacks, so a fate that can
    // recur can't silently multiply its own penalty.
    // Degrade safely on a campaign with no forage block at all (the same
    // convention the `flag` branch uses for eventFlags) — every fate in the
    // pool gets swept through applyEffect by the structural tests.
    if (!campaign.forage) campaign.forage = {}
    if (!campaign.forage.modifiers) campaign.forage.modifiers = []
    const mods = campaign.forage.modifiers
    const existing = mods.findIndex((m) => m.id === effect.id)
    const mod = {
      id: effect.id,
      label: effect.label,
      target: effect.target,
      factor: effect.factor ?? 1,
      deltaKg: effect.deltaKg ?? 0,
      turnsLeft: effect.turnsLeft ?? null,
      raidable: effect.raidable ?? false,
    }
    if (existing >= 0) mods.set ? mods.set(existing, mod) : (mods[existing] = mod)
    else mods.push(mod)
    // A playerYield pressure is the player's OWN foraging, so naming it is fair
    // play. An enemyDrain one is enemy-side fact — campaignView recon-gates even
    // the label, so no line here (it would leak past the gate into the log).
    if (effect.target === 'playerYield') log.push(`${effect.label} — your foraging suffers for it.`)
  } else if (effect.type === 'garrison') {
    // Garrison Resolve delta (docs/CAMPAIGN_PLAN.md "Garrison Resolve"): move
    // the standing track by `delta`, clamped to [MIN, MAX]. Hidden state like
    // `flag` — the relationship's story lives in the event text, so NO
    // player-visible number (a leaked figure would cheapen the fiction and the
    // band is all the player is meant to read). adjustResolve (garrison.js) is
    // the single writer — init from the starting value + clamp live there.
    adjustResolve(campaign, effect.delta)
  } else if (effect.type === 'schedule') {
    // Chain follow-up (part 2): guarantee `event` surfaces as a fate `delay`
    // turns from now (default the next turn). Queued as {eventId, day} on
    // campaign.scheduledEvents; drawAugury (augury.js) drains it into a forced
    // slot once campaign.day reaches the target. NO log line — the scheduling
    // is hidden state (like `flag`); the beat announces itself when it lands,
    // and a line here would leak that a follow-up is coming.
    if (!campaign.scheduledEvents) campaign.scheduledEvents = []
    campaign.scheduledEvents.push({
      eventId: effect.event,
      day: (campaign.day ?? 1) + (effect.delay ?? 1),
    })
  } else if (effect.type === 'multi') {
    // A bundled fate: every part lands, in order.
    for (const part of effect.effects) log.push(...applyEffect(campaign, part))
  } else if (effect.type === 'none') {
    // A neutral fate: it passes without tipping the scales.
    log.push('The fortnight passes without consequence.')
  }
  return log
}

// Which rung of a fate actually fires at the given scouting band (Stage 4
// 1c). Takes the event AS STORED in an augury slot (display fields + effect
// only) and looks its ladder up in EVENT_POOL by id — plain events, and ids
// no longer in the pool, pass through as their own 'blind' rung. The
// `intervened` flag is the day report's "scouts intervened" signal.
// A specific rung by NAME — used when a deferred slot's recorded rung must
// apply at end-day exactly as it was revealed at acceptance, even if the
// scouting band has shifted since. Unknown names (or a plain event) degrade
// to the blind rung of the stored card.
export const rungOf = (event, rungName) => {
  const pooled = EVENT_POOL.find((e) => e.id === event.id)
  if (rungName !== 'blind' && pooled?.rungs?.[rungName])
    return { rung: rungName, intervened: true, reconSensitive: true, ...pooled.rungs[rungName] }
  return {
    rung: 'blind',
    intervened: false,
    reconSensitive: !!pooled?.reconSensitive,
    title: event.title,
    description: event.description,
    effect: event.effect,
    // A choice-fate's branches ride along (from the pool, never the stored
    // copy) so dayResolution can pend the decision instead of applying.
    choices: pooled?.choices,
  }
}

export const firedRung = (event, band) => {
  const pooled = EVENT_POOL.find((e) => e.id === event.id)
  const rungName = pooled?.reconSensitive ? (EVENT_RUNG_BY_BAND[band] ?? 'blind') : 'blind'
  return rungOf(event, rungName)
}
