import React from 'react'
import useCampaignStore from '../stores/useCampaignStore'
import useUiStore from '../stores/useUiStore'
import { EMPTY_ARRAY, EMPTY_OBJECT } from '../stores/selectors'
import SquadCharterPage from './SquadCharterPage'
import SquadUpgradePanel from './SquadUpgradePanel'
import CharacterPanel from './CharacterPanel'

// THE SQUAD SCREEN (docs/CAMPAIGN_PLAN.md, decision 13) — the hub the whole
// squad overhaul was built toward, and the screen the other twelve decisions
// are finally visible on.
//
// A TAKEOVER, reachable from the HUD in every phase (13-7): squads are picked
// for raids, placed at deploy and posted to in prepare, and two of its actions
// have no server phase gate at all, so binding it to one phase would hide it
// for most of the turn. Back returns to the phase underneath, which was never
// unmounted — the ItemStorePanel/ReplayView pattern.
//
// A ROLL, THEN A PAGE PER CHARTER (13-8), because the design target is an army
// of many charters rather than today's three: cards side by side stop scaling
// at about five. The page swap is `useUiStore.squadScreen`; there is no router
// in this app and this screen deliberately does not add one.
//
// THE ROLL IS THE WHOLE ARMY (13-9) — charters, then the loose pool, then the
// characters nobody has posted. The loose pool is the fuel every refill eats
// (13-2/13-13), so "why did nobody join?" has to be answerable on the same page
// that shows the shortfall, and an unposted caster is a resource going to waste.

// Composition is counts by type (13-10), so a charter's strength is a sum
// against the sum of its caps. Only characters are individuals.
const totalOf = (bag) => Object.values(bag ?? {}).reduce((a, b) => a + b, 0)

const SquadRoll = () => {
  const squads = useCampaignStore((s) => s.campaign?.squads ?? EMPTY_ARRAY)
  const characters = useCampaignStore((s) => s.campaign?.characters ?? EMPTY_ARRAY)
  const loose = useCampaignStore((s) => s.campaign?.loose ?? EMPTY_OBJECT)
  // Squads already sent on a raid this turn — the server's own ledger, the
  // same one the raid picker greys its cards out from.
  const raiding = useCampaignStore((s) => s.campaign?.raid?.squadAssignment ?? EMPTY_ARRAY)
  const showPage = useUiStore((s) => s.showSquadPage)

  const raidingIds = new Set(raiding)
  // 13-13: the pool is drained by the refills and holds only what no charter
  // could take. A type at zero is not news — it is the ordinary state.
  const looseRows = Object.entries(loose).filter(([, n]) => n > 0)
  const unposted = characters.filter((c) => c.alive && c.squadId == null)
  const fallen = characters.filter((c) => !c.alive)

  return (
    <div className="squad-roll" data-testid="squad-roll">
      <h3>Charters</h3>
      {squads.length === 0 && <p data-testid="squad-roll-empty">No charters on the rolls.</p>}
      {squads.map((squad) => {
        const strength = totalOf(squad.composition)
        const cap = totalOf(squad.caps)
        const waiting = (squad.upgradeOffer?.options?.length ?? 0) > 0
        return (
          <div className="raid-card" key={squad.id} data-testid={`roll-squad-${squad.id}`}>
            <strong>{squad.name}</strong>
            <p data-testid={`roll-strength-${squad.id}`}>
              {squad.rank} — {strength} of {cap} at muster
            </p>
            {/* 13-11: free, or out raiding today. The third state (tied up for
                X turns) is decision 12's and does not exist yet — a branch
                nothing in the game can reach is how a stale reader survives. */}
            <p data-testid={`roll-availability-${squad.id}`}>
              {raidingIds.has(squad.id) ? 'Out raiding today' : 'In camp, ready'}
            </p>
            {/* 13-15: the roll MARKS the charters with a draft waiting; the
                cards themselves live on the honours screen. */}
            {waiting && (
              <p className="roll-honour-waiting" data-testid={`roll-honour-${squad.id}`}>
                An honour waits to be claimed.
              </p>
            )}
            <button
              className="btn-primary"
              data-testid={`roll-open-${squad.id}`}
              onClick={() => showPage('charter', squad.id)}
            >
              Inspect
            </button>
          </div>
        )
      })}

      {/* The loose pool: what no charter holds. It is what the end-of-turn
          refills eat and what the player hand-places at deploy, so it belongs
          on the same page as the charters that are short. */}
      <h3>Loose Troops</h3>
      {looseRows.length === 0 ? (
        <p data-testid="roll-loose-empty">
          Nobody is loose — every body on the rolls stands under a charter.
        </p>
      ) : (
        <p data-testid="roll-loose">
          {looseRows.map(([type, n]) => `${n} ${type}`).join(' · ')}
        </p>
      )}
      <p className="squad-roll-note">
        Loose troops are what the charters draw on to refill, and what you place by hand
        when the line is drawn up.
      </p>

      {/* 13-9: an unattached caster is a resource going to waste, so the roll
          names them rather than leaving them on a screen of their own. */}
      <h3>Characters</h3>
      {unposted.length === 0 ? (
        <p data-testid="roll-unposted-none">Every living character is posted to a charter.</p>
      ) : (
        <p data-testid="roll-unposted">
          In camp, unposted: {unposted.map((c) => `${c.name} (${c.type})`).join(' · ')}
        </p>
      )}
      <button
        className="btn-secondary"
        data-testid="roll-to-company"
        onClick={() => showPage('company')}
      >
        The Company{fallen.length > 0 ? ` — and ${fallen.length} fallen` : ''}
      </button>
    </div>
  )
}

// The shell: one back button, one page at a time. `onBack` closes the whole
// screen and returns to the phase the player opened it from.
const SquadScreen = ({ onTakeUpgrade, onAttach, onSetHangBack }) => {
  const screen = useUiStore((s) => s.squadScreen)
  const close = useUiStore((s) => s.closeSquadScreen)
  const openRoll = useUiStore((s) => s.openSquadScreen)

  if (!screen) return null
  const onRoll = screen.page === 'roll'

  return (
    <div className="squad-screen" data-testid="squad-screen">
      <h2>The Army</h2>
      {onRoll && <SquadRoll />}
      {screen.page === 'charter' && <SquadCharterPage squadId={screen.squadId} />}
      {/* 13-15/13-16: these two survive as SCREENS reached from the roll rather
          than being dissolved into the charter page. The upgrade cards carry a
          permanence confirm that wants room of its own, and 5-9's roll of the
          dead has nowhere to live on a charter page. */}
      {screen.page === 'honours' && <SquadUpgradePanel onTakeUpgrade={onTakeUpgrade} />}
      {screen.page === 'company' && (
        <CharacterPanel onAttach={onAttach} onSetHangBack={onSetHangBack} />
      )}
      <div className="squad-screen-nav">
        {!onRoll && (
          <button className="btn-secondary" data-testid="squad-screen-roll" onClick={openRoll}>
            Back to the roll
          </button>
        )}
        <button className="login-toggle" data-testid="squad-screen-back" onClick={close}>
          Back
        </button>
      </div>
    </div>
  )
}

export default SquadScreen
