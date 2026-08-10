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

const ForagePanel = ({ onSetShare, locked }) => {
  const forage = useCampaignStore((s) => s.campaign?.forage ?? EMPTY_OBJECT)
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

  return (
    <div className="forage-panel" data-testid="forage-panel">
      <TutorialIntro
        id="forage"
        enabled={tutorial}
        title="Foraging"
        lines={[
          'The land around Karrowgate must feed your army through the siege — strip it before the enemy does.',
          'The whole army works the land passively now: slide the effort split toward Forage for food and materials, or toward Scout for raid-board points.',
          'The near ring empties first and nothing grows back — the land is a clock.',
          'The enemy drains the same rings on its own account and gets no credit for it — just fewer supplies for everyone.',
          'Leaning toward Forage exposes more of the army — it fills the boss-fight meter faster.',
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
          Scout
        </label>
      </div>
      <div className="effort-preview">
        <span data-testid="effort-preview-food">{tons(foodKg)} food</span>
        <span data-testid="effort-preview-materials">{tons(materialsKg)} materials</span>
        <span data-testid="effort-preview-scouting">{Math.round(scoutingPoints)} scouting points</span>
        <span data-testid="effort-preview-meter">+{Math.round(meterFill)} to the boss-fight meter</span>
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
