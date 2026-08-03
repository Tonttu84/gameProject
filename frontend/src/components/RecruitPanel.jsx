import React, { useState } from 'react'
import TutorialIntro from './TutorialIntro'
import useCampaignStore from '../stores/useCampaignStore'
import useUiStore from '../stores/useUiStore'

// Recruit phase (docs/CAMPAIGN_PLAN.md "Recruit phase — hiring troops", S2):
// up to 2 server-drawn options a day, one hire (or a skip) spends the day's
// cadence. The server owns generation, affordability, and the boost roll —
// this panel only shows what's on offer and submits the pick. Cost/count are
// already resolved against LIVE resources by campaignView (never stale), so
// the panel doesn't recompute them — it only previews affordability for the
// disabled/title state, same convention as CampPanel's fort/militia buttons.

const RESOURCE_LABELS = { food: 'food', materials: 'materials', workers: 'workers', gold: 'gold', horses: 'horses' }

const costLabel = (cost) =>
  Object.entries(cost)
    .map(([key, n]) => `${n} ${RESOURCE_LABELS[key] ?? key}`)
    .join(', ')

// recruit/resources/workers come straight from the campaign store; onHire is
// still a prop (a guarded action).
const RecruitPanel = ({ onHire }) => {
  const recruit = useCampaignStore((s) => s.campaign?.recruit)
  const resources = useCampaignStore((s) => s.campaign?.resources)
  const workers = useCampaignStore((s) => s.campaign?.workers)
  const tutorial = useUiStore((s) => s.tutorial)
  const [busy, setBusy] = useState(false)

  if (!recruit) return null

  const options = recruit.options ?? []
  const workersFree = workers?.available ?? 0

  const canAfford = (cost) =>
    Object.entries(cost).every(([key, n]) =>
      key === 'workers' ? workersFree >= n : (resources?.[key] ?? 0) >= n,
    )

  const hire = async (entryId) => {
    setBusy(true)
    try {
      await onHire({ entryId })
    } finally {
      setBusy(false)
    }
  }

  const skip = async () => {
    setBusy(true)
    try {
      await onHire({ skip: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="recruit-panel" data-testid="recruit-panel">
      <TutorialIntro
        id="recruit"
        enabled={tutorial}
        title="Recruiting"
        lines={[
          'Word of the camp\'s cause spreads — each day up to two ways to grow your strength turn up. Pick at most one.',
          'Troops draw on your workforce plus food and materials; casters cost gold instead. Cavalry also costs horses.',
          'Recruiting Fervor can boost the day\'s pick when it fires — a bigger hire at a bigger cost, or the same hire at a discount.',
        ]}
      />
      <h3>Recruit</h3>
      <p className="recruit-fervor" data-testid="recruit-fervor">
        Recruiting Fervor: {recruit.fervor}
        {recruit.boosted && <span className="recruit-boosted"> — today's pick is boosted!</span>}
      </p>
      {recruit.hiredToday ? (
        <p className="recruit-empty" data-testid="recruit-done">Recruiting is done for today.</p>
      ) : options.length === 0 ? (
        <p className="recruit-empty" data-testid="recruit-empty">Nothing to recruit today.</p>
      ) : (
        <>
          {options.map((o) => {
            const affordable = canAfford(o.cost)
            return (
              <div className="raid-card" key={o.id} data-testid={`recruit-card-${o.id}`}>
                <strong>
                  {o.count} {o.unit}
                  {o.secondUnit && ` + 1 ${o.secondUnit}`}
                </strong>
                <p data-testid={`recruit-cost-${o.id}`}>Cost: {costLabel(o.cost)}</p>
                <button
                  className="btn-primary"
                  data-testid={`recruit-hire-${o.id}`}
                  onClick={() => hire(o.id)}
                  disabled={busy || !affordable}
                  title={affordable ? undefined : 'Not enough stores to hire this'}
                >
                  Hire
                </button>
              </div>
            )
          })}
          <button
            className="login-toggle"
            data-testid="recruit-skip"
            onClick={skip}
            disabled={busy}
          >
            Skip today's recruiting
          </button>
        </>
      )}
    </div>
  )
}

export default RecruitPanel
