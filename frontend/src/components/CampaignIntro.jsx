import React from 'react'

// One-time scene-setter shown when a fresh campaign opens (turn 1), before the
// war council. Pure story — NOT tutorial-gated (everyone meets Karrowgate once);
// App gates it on day 1 + the UI store's introSeen flag, and "Take command"
// dismisses it into the normal turn-1 flow. The situation it describes is also
// what makes the mechanics read: why you cannot simply fight (too weak), why
// holding troops in reserve slows the walls' fall, and why the breach forces the
// one decisive pitched battle.
const PARAGRAPHS = [
  'War has come to the marches. Beyond the river Marn a great host is gathering, and when it is ready it will march west into the realm — if it can cross. For sixty miles in either direction the Marn runs deep and cold and bridgeless; only at Karrowgate does a bridge span it, and by the old edict of the Warden of the Marches no other ever may. One crossing is easier to watch, and if the day demands it, easier to break — so the whole frontier was built to funnel through a single gate.',
  'The enemy did not wait for his full strength. Ahead of the main host he loosed a swift column — hard riders and picked men, moving light and fast — to fall on Karrowgate before the realm even knew the war had begun. The gamble all but won: the column came out of the east far quicker than any muster could answer, and now it sits astride the town, storming the walls in haste. Let it take the bridge before the great host comes up behind, and the host will cross dry-shod and unopposed, with the whole march open before it.',
  'Karrowgate is not yours to command, but it is a city of your people — and it is the door to a hundred more. Its walls, sound for now, will not stand forever. No banner of the realm rides to its relief; the great lords are far off, and the muster that should have come has not come — not yet, and not in time.',
  'You are a commander of no great name. But you are near, and you have a handful of veterans and a country full of frightened men who will fight if someone will lead them. The summons finds you at your own gate: raise what troops you can and hold Karrowgate until the realm can answer — or the bridge, the river, and the road behind it are lost. There is no one else. You know it, and the knowing sits cold in your chest — but you go.',
  'You march, raising levies from the villages as you pass, putting spears in the hands of ploughmen and drilling them on the road because there is nowhere else. By the time your column comes in sight of the enemy — the siege lines thrown up about the walls, the smoke of their engines — you have already done the sum, and it comes out against you. Meet that column head-on and it will break you in an hour, levies and veterans alike, and Karrowgate with you.',
  'So you do not meet it. You shadow it instead, keeping to the high ground and the treeline, close enough to be seen and never close enough to be caught. Let them come at you and you melt away; the country is yours to move through and theirs only to reach for.',
  'And they cannot turn and hunt you down, not truly. Every hour spent chasing you through the hills is an hour not spent at the walls — and they have no hours to spare, for their own great host presses up behind and the bridge must be theirs before it arrives. Peel away to catch you and the assault falters and the whole gambit fails. So they stay at the walls cursing your name, and you stay at their backs.',
  'You throw up a camp within sight of the siege lines and set to the slow work of the weaker army: you harry their foragers, burn their supply, cut down their stragglers, and bleed them a little more with each fortnight that passes. Every man you hold in reserve is a man they must hold back to guard against you — and while you both watch and wait, the walls stand and the city breathes.',
  'But stone gives to iron in the end. One grey morning the breach will come, and then there is no more shadowing — only the enemy turning for the gap, and you, with all you have gathered and all you have held back, marching down to meet them in the open at last. Everything you have built will be spent in a single afternoon.',
  'Break them that day and the bridge holds, and the great host beyond the Marn may sit and rot on the wrong bank. Fail, and the crossing is theirs, and there is nothing left between the warlord and the heartland.',
]

const CampaignIntro = ({ onBegin }) => (
  <div className="phase-setup campaign-intro" data-testid="campaign-intro">
    <h2>The Relief of Karrowgate</h2>
    <div className="campaign-intro-prose">
      {PARAGRAPHS.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      <p className="campaign-intro-close">The country is watching.</p>
    </div>
    <button className="btn-primary" data-testid="take-command" onClick={onBegin}>
      Take command
    </button>
  </div>
)

export default CampaignIntro
