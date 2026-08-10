import React, { useState, useEffect, useRef } from 'react'
import TutorialIntro from './TutorialIntro'
import { tons } from '../utils/format'
import useCampaignStore from '../stores/useCampaignStore'
import useUiStore from '../stores/useUiStore'
import { EMPTY_OBJECT } from '../stores/selectors'

// The effort slider (S2, docs/CAMPAIGN_PLAN.md "Effort slider"): ONE points
// pool (forage.pool), split between foraging and scouting by forage.share.
// Foraging is passive now — no per-unit assignment, no roster steppers — so
// this panel is just the split control plus a live preview computed by
// multiplying the server-provided scalars (pool, kgPerPoint, the food/
// materials shares, the meter's two endpoint fills). All math the client
// shows still comes from the campaign view — the server owns the formulas,
// the client only multiplies. `locked` means the turn marched past Prepare:
// the committed split stays on screen as a record, but can no longer be
// changed (the server refuses it too — routes' rejectIfPhasePassed).
//
// Mount with key={campaign.day} so a new turn resets the local draft to the
// (sticky) committed share.

const RING_NAMES = ['Near', 'Middle', 'Far']

// Turns-to-breach — the meter readout the player can actually price (decided
// 2026-08-10). "+80 to the boss-fight meter" was a number against an invisible
// scale: the threshold is server-side, so 80 could be a tenth of the siege or
// the whole of it, and the one lever with a real cost read as noise.
//
// Two things constrain how it may be computed, and both are easy to get wrong:
//
//   • The meter is RECON-GATED. `meter.remaining` arrives already derived from
//     the same displayBracket estimate the HUD shows, and is null while Blind.
//     Never reconstruct it from a client-side threshold (the HUD's
//     WALLS_METER_THRESHOLD mirror is for scaling a bar, nothing else) — the
//     remainder subtracted from 1000 IS the hidden counter.
//   • Turns is remaining/fill — HYPERBOLIC in share, unlike the fill itself.
//     So the fill is interpolated linearly (below, which is valid) and divided
//     HERE. Interpolating between two turn endpoints would agree at both ends
//     of the track and be quietly wrong across the whole middle of it.
const breachReadout = (remaining, fill, fillAtNoForage) => {
  if (remaining) {
    if (remaining.high <= 0) return 'The walls are breached — the assault comes now'
    if (!(fill > 0)) return null
    // Ceil, then floor at 1: a part-turn still has to be taken, and the meter
    // fills at end of day, so the soonest any breach can land is next turn.
    const soonest = Math.max(1, Math.ceil(remaining.low / fill))
    const latest = Math.max(1, Math.ceil(remaining.high / fill))
    // Collapses to one number at the top recon level, same as format.js
    // `estimate` — the range narrowing IS the thing scouting bought.
    return soonest === latest
      ? `Walls breached in ~${soonest} turn${soonest === 1 ? '' : 's'} at this effort`
      : `Walls breached in ${soonest}–${latest} turns at this effort`
  }
  // Blind (recon 0): no estimate exists, so say it RELATIVELY. Both endpoint
  // fills are already public and this uses nothing else, so it needs no gate —
  // the ratio says what this slider position costs without saying how far along
  // the siege is.
  if (!(fillAtNoForage > 0)) return null
  const times = fill / fillAtNoForage
  if (times < 1.05) return 'Walls fall as slowly as they can at this effort'
  return `Walls fall about ${+times.toFixed(1)}× as fast as holding everyone back`
}

const ForagePanel = ({ onSetShare, locked }) => {
  const forage = useCampaignStore((s) => s.campaign?.forage ?? EMPTY_OBJECT)
  const meter = useCampaignStore((s) => s.campaign?.meter ?? EMPTY_OBJECT)
  const tutorial = useUiStore((s) => s.tutorial)
  const [share, setShare] = useState(forage.share ?? 0.5)
  const [saving, setSaving] = useState(false)

  const setDraft = (raw) => setShare(Math.max(0, Math.min(1, Number(raw))))

  // The split commits itself — no separate "Set effort" press (user,
  // 2026-08-10). Debounced rather than sent on every change: a range input
  // fires per STEP while dragging, so a single sweep across the track would be
  // a dozen writes to a route that seals the turn's split.
  //
  // Debounce, not onPointerUp, because the slider is also driven by arrow keys
  // and that route has no release event to hang a commit on — one timer covers
  // mouse, touch and keyboard alike.
  const committed = useRef(forage.share ?? 0.5)
  // onSetShare is a fresh closure on most renders. Held in a ref so it is NOT
  // an effect dependency: as a dependency it would restart the timer on every
  // render and the commit would never fire.
  const latestSetShare = useRef(onSetShare)
  useEffect(() => { latestSetShare.current = onSetShare })

  useEffect(() => {
    if (locked || share === committed.current) return undefined
    const timer = setTimeout(async () => {
      committed.current = share
      setSaving(true)
      try {
        await latestSetShare.current(share)
      } finally {
        setSaving(false)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [share, locked])

  const pool = forage.pool ?? 0
  const kgPerPoint = forage.kgPerPoint ?? 0
  // Standing pressures (S3) reach us as coefficients, not a finished total, so
  // the preview bends with them at every slider position: kgPerPoint already
  // carries their combined factor, flatKg the additive half. Floors at 0 —
  // the same clamp resolveForaging applies.
  const capacityKg = Math.max(0, pool * share * kgPerPoint + (forage.flatKg ?? 0))
  const foodKg = capacityKg * (forage.foodShare ?? 0)
  const materialsKg = capacityKg * (forage.materialsShare ?? 0)
  const scoutingPoints = pool * (1 - share)
  // The meter's fill is linear in share (services/meter.js): interpolate
  // between the two endpoints the server sent rather than reimplementing the
  // formula here.
  const meterAtNoForage = forage.meterFillAtNoForage ?? 0
  const meterAtFullForage = forage.meterFillAtFullForage ?? 0
  const meterFill = meterAtNoForage + (meterAtFullForage - meterAtNoForage) * share
  // ...and the fill is only the input: what the player reads is how long the
  // walls last at it. See breachReadout above.
  const breachText = breachReadout(meter.remaining, meterFill, meterAtNoForage)

  return (
    <div className="forage-panel" data-testid="forage-panel">
      <TutorialIntro
        id="forage"
        enabled={tutorial}
        title="Foraging"
        lines={[
          'The land around Karrowgate must feed your army through the siege — strip it before the enemy does.',
          'The whole army works the land passively now: slide the effort split toward Forage for food and materials, or toward Screen for raid-board points.',
          'Screening is the riders out ahead — they bring back word of the enemy AND harry what they find, which is what turns up targets worth raiding.',
          'The near ring empties first and nothing grows back — the land is a clock.',
          'The enemy drains the same rings on its own account and gets no credit for it — just fewer supplies for everyone.',
          'Leaning toward Forage exposes more of the army — Karrowgate’s walls fall faster for it.',
        ]}
      />
      <h3>Effort</h3>
      <div className="forage-rings">
        {(forage.rings ?? []).map((r) => (
          <div className="forage-ring" key={r.ring} data-testid={`forage-ring-${r.ring}`}>
            <span>{RING_NAMES[r.ring] ?? `Ring ${r.ring}`}</span>
            <meter min="0" max={r.initialRichness} value={r.richness} />
            <span>{tons(r.richness)} left</span>
          </div>
        ))}
      </div>
      <div className="effort-slider">
        <label>
          Forage
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={share}
            data-testid="effort-slider"
            disabled={locked}
            onChange={(e) => setDraft(e.target.value)}
          />
          Screen
        </label>
      </div>
      <div className="effort-preview">
        <span data-testid="effort-preview-food">{tons(foodKg)} food</span>
        <span data-testid="effort-preview-materials">{tons(materialsKg)} materials</span>
        <span data-testid="effort-preview-scouting">{Math.round(scoutingPoints)} screening points</span>
        {breachText && <span data-testid="effort-preview-breach">{breachText}</span>}
        <span data-testid="effort-enemy-drain">
          Enemy foraging: {forage.enemyDrainKg == null ? 'unknown' : `${tons(forage.enemyDrainKg)}/turn`}
        </span>
      </div>
      {/* Standing pressures on the foraging (S3). The server has already
          filtered out any enemy-side one the current recon can't see, so
          whatever arrives here is safe to name. A permanent one (turnsLeft
          null) says so — that it won't simply pass is the point of it. */}
      {(forage.modifiers ?? []).length > 0 && (
        <ul className="effort-modifiers" data-testid="effort-modifiers">
          {forage.modifiers.map((m) => (
            <li key={m.id} data-testid={`effort-modifier-${m.id}`}>
              {m.label}
              {/* What it actually does. Without this the line named a pressure
                  and gave its duration, which together say something is wrong
                  but not how badly — nothing you can act on. */}
              {m.effectText?.length > 0 && (
                <span className="effort-modifier-effect"> — {m.effectText.join(', ')}</span>
              )}
              {' — '}
              <span className="effort-modifier-term">
                {m.turnsLeft == null
                  ? 'for the rest of the campaign'
                  : `${m.turnsLeft} turn${m.turnsLeft === 1 ? '' : 's'} left`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {/* A status line, not a control: the split saves itself, so the only
          thing left to say is whether it has landed. */}
      <p className="effort-status" data-testid="effort-status">
        {locked ? 'Effort is committed' : saving ? 'Saving…' : 'Effort set'}
      </p>
    </div>
  )
}

export default ForagePanel
