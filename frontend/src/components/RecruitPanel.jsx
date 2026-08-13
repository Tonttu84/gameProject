import React, { useState } from 'react'
import TutorialIntro from './TutorialIntro'
import SquadReinforcePanel from './SquadReinforcePanel'
import SquadUpgradePanel from './SquadUpgradePanel'
import useCampaignStore from '../stores/useCampaignStore'
import useUiStore from '../stores/useUiStore'

// Recruit phase (docs/CAMPAIGN_PLAN.md "Recruit phase — hiring troops"): the
// day's 2 server-drawn options, one of which must be hired — there is no skip,
// and the free Travellers card is always among them when the real pool can't
// fill both slots, so a hire is always possible. The server owns generation,
// affordability, and the boost roll — this panel only shows what's on offer
// and submits the pick. Cost/count are already resolved against LIVE resources
// by campaignView (never stale), so the panel doesn't recompute them — it only
// previews affordability for the disabled/title state, same convention as
// CampPanel's fortify button.

const RESOURCE_LABELS = { food: 'food', materials: 'materials', workers: 'workers', gold: 'gold', horses: 'horses' }

// An empty cost is the Travellers card — say so rather than rendering a blank.
const costLabel = (cost) =>
  Object.entries(cost)
    .map(([key, n]) => `${n} ${RESOURCE_LABELS[key] ?? key}`)
    .join(', ') || 'free'

// recruit/resources/workers come straight from the campaign store; onHire and
// onReinforce are still props (guarded actions).
const RecruitPanel = ({ onHire, onReinforce, onTakeUpgrade }) => {
  const recruit = useCampaignStore((s) => s.campaign?.recruit)
  const resources = useCampaignStore((s) => s.campaign?.resources)
  const workers = useCampaignStore((s) => s.campaign?.workers)
  // Needed for the trainee check: everything above Militia is a promotion, so
  // affordability depends on the roster as much as on the stores.
  const roster = useCampaignStore((s) => s.campaign?.roster)
  const tutorial = useUiStore((s) => s.tutorial)
  const [busy, setBusy] = useState(false)

  if (!recruit) return null

  const options = recruit.options ?? []
  const workersFree = workers?.available ?? 0

  // An option is affordable only if the TRAINEES exist too: above Militia the
  // count comes off the rung below, one for one, so a card can be perfectly
  // affordable in food and materials and still be unpayable. Without this the
  // button would arm and the server would then quietly train only as many as
  // the roster held.
  const canAfford = (o) =>
    Object.entries(o.cost).every(([key, n]) =>
      key === 'workers' ? workersFree >= n : (resources?.[key] ?? 0) >= n,
    ) && (!o.from || (roster?.[o.from] ?? 0) >= o.count)

  const hire = async (entryId) => {
    setBusy(true)
    try {
      await onHire({ entryId })
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
          'Word of the camp\'s cause spreads — each day two ways to grow your strength turn up. Take one; you cannot march without recruiting.',
          'Militia are raised from your workforce. Better troops are TRAINED OUT OF THEM — a soldier is a militiaman drilled and equipped, and horse are made from soldiers — so each promotion spends the men on the rung below, plus food and materials. Casters cost gold instead; cavalry also costs horses.',
          'When little is on offer, a band of travellers will always take your colours for nothing.',
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
            const affordable = canAfford(o)
            const trainees = o.from ? (roster?.[o.from] ?? 0) : 0
            return (
              <div className="raid-card" key={o.id} data-testid={`recruit-card-${o.id}`}>
                <strong>
                  {o.count} {o.unit}
                  {o.secondUnit && ` + 1 ${o.secondUnit}`}
                </strong>
                <p data-testid={`recruit-cost-${o.id}`}>Cost: {costLabel(o.cost)}</p>
                {/* The trainees are the real price of a promotion — troops
                    leaving one line of the roster for another — so they get
                    their own line rather than hiding among the resources, with
                    what you actually have beside it. */}
                {o.from && (
                  <p data-testid={`recruit-from-${o.id}`}>
                    Trained from: {o.count} {o.from} (you have {trainees})
                  </p>
                )}
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
        </>
      )}
      {/* The phase's OTHER sink, and deliberately below the hire: the hire is
          the mandatory exit, replacements are optional. Neither gates the
          other server-side (docs/CAMPAIGN_PLAN.md "SLICE 3", decision I), so
          this section stays live once the day's hire is resolved. */}
      {/* Honours sit ABOVE replacements: an upgrade can raise the caps and
          intake the panel below prices against, so choosing one first means
          the replacement arithmetic on screen is already the upgraded one. */}
      <SquadUpgradePanel onTakeUpgrade={onTakeUpgrade} />
      <SquadReinforcePanel onReinforce={onReinforce} />
    </div>
  )
}

export default RecruitPanel
