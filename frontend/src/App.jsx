import React, { useState, useEffect } from 'react'
import { getInfo, getMap } from './services/api'
import useAuthStore from './stores/useAuthStore'
import useNoticeStore from './stores/useNoticeStore'
import useCampaignStore from './stores/useCampaignStore'
import usePlacementStore from './stores/usePlacementStore'
import useUiStore from './stores/useUiStore'
import { guarded } from './stores/guarded'
import {
  handleLogin, handleLogout, startCampaign, musterForBattle, acceptFates,
  startBattle, watchRaid, nextDay, watchDemo,
} from './stores/flows'
import {
  useTotalUnits, usePlacedCount, useSquadPlacedCount, useInCamp,
} from './stores/selectors'
import HexGrid from './components/HexGrid'
import AuguryPanel from './components/AuguryPanel'
import EventRevealScreen from './components/EventRevealScreen'
import ForagePanel from './components/ForagePanel'
import RaidPanel from './components/RaidPanel'
import CampPanel from './components/CampPanel'
import CampaignHUD from './components/CampaignHUD'
import ScoutReport from './components/ScoutReport'
import BattleResult from './components/BattleResult'
import ReplayView from './components/ReplayView'
import LoginForm from './components/LoginForm'
import TutorialIntro from './components/TutorialIntro'
import BugReportButton from './components/BugReportButton'
import { tons } from './utils/format'
import './App.css'

// All campaign state (day, food, roster, events, enemy) lives server-side —
// this component is a client of the campaign view and only owns UI state:
// which screen is showing, in-progress placements, and the auth session.

const App = () => {
  const [info, setInfo] = useState(null)
  const [map,  setMap]  = useState(null)

  const {
    phase, setPhase, battleResult, setBattleResult, raidBattle, setRaidBattle,
    dayReport, setDayReport, demoBattle, setDemoBattle, demoLoading,
    tutorial, toggleTutorial, connectionError, setConnectionError,
  } = useUiStore()

  const { placements, squadPlacements } = usePlacementStore()

  const user = useAuthStore((s) => s.user)
  const authNotice = useNoticeStore((s) => s.message)

  const { campaign, loading, consultAugur, rerollAugur, assignForagers, fortify, buyMilitia, launchRaids, scoutRaid, resolveChoice, reload } = useCampaignStore()

  // Hooks, so called unconditionally here rather than after the early-return
  // guards below — each is safe against a null campaign (optional chaining
  // in stores/selectors.js), so there's nothing to gate on.
  const totalUnits = useTotalUnits()
  const placedCount = usePlacedCount()
  const squadPlacedCount = useSquadPlacedCount()
  const inCamp = useInCamp()

  // Server-side campaign state reacts to the login session: reload it when a
  // user logs in, drop it when they log out. Was useCampaign(user)'s internal
  // effect before campaign moved into its own store.
  useEffect(() => {
    if (!user) {
      useCampaignStore.getState().clear()
      return
    }
    reload().catch(() => useCampaignStore.getState().clear())
  }, [user, reload])

  // The campaign server boots slower than Vite (mongod spawn, catalog sync),
  // so the first fetches of a fresh `make serve` can land in that gap. Retry
  // through the boot window before declaring the server unreachable.
  useEffect(() => {
    let cancelled = false
    const attempt = (triesLeft) => {
      Promise.all([getInfo(), getMap()])
        .then(([infoData, mapData]) => {
          if (cancelled) return
          setInfo(infoData)
          setMap(mapData)
          setConnectionError(null)
        })
        .catch(() => {
          if (cancelled) return
          if (triesLeft > 0) setTimeout(() => attempt(triesLeft - 1), 2000)
          else setConnectionError('Could not reach the campaign server — start the stack with "make serve" and wait for its "campaign server on …" line.')
        })
    }
    attempt(10)
    return () => { cancelled = true }
  }, [setConnectionError])

  // Rehydrate a stored session; the token may be stale (1h expiry) — the
  // first protected call after expiry gets a 401 and logs back out.
  useEffect(() => {
    useAuthStore.getState().rehydrate()
  }, [])

  // The turn runs as a sequence of single-purpose screens the player advances
  // through: Prepare (forage + camp) → Omens (the augur) → Raids → Deploy.
  // Splitting them keeps the pipeline clear and, crucially, puts the fates
  // BEFORE raider assignment so a counter-raid is an informed choice, not a
  // blind one (docs/CAMPAIGN_PLAN.md, 2026-07-18).
  const readOmens = () => setPhase('omens')
  const toRaids = () => setPhase('raids')
  // Back-steps through the phased turn. Pure phase-state changes — no server
  // action is undone (forage/augury/raids the player already committed stay
  // committed); going back just re-renders an earlier screen, whose own guards
  // handle any already-done action. Lets the flow be walked both ways rather
  // than a one-way march (docs/CAMPAIGN_PLAN.md slices 2–3).
  const backToPrepare = () => setPhase('prepare')
  const backToOmens = () => setPhase('omens')
  // Resolve a pending choice-fate (events with choices). Guarded like every
  // campaign action; the reveal screen reads the undefined-on-failure return
  // to keep the options up for another try.
  const chooseFate = guarded(resolveChoice)

  if (connectionError) {
    return (
      <div className="error-screen">
        <h2>Connection Error</h2>
        <p>{connectionError}</p>
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    )
  }

  if (!info || !map) {
    return <div className="loading">Connecting to game server...</div>
  }

  // The screen the player is on, stamped onto any bug report they file. The
  // server validates this against a fixed enum, so unknown values are harmless.
  const currentScreen = !user
    ? 'login'
    : !campaign
      ? 'start'
      : campaign.status !== 'active'
        ? 'gameover'
        : phase

  const authBar = (
    <div className="auth-bar">
      {user ? (
        <>
          <span data-testid="auth-username">Logged in as {user.username}</span>
          <button className="login-toggle" data-testid="logout-button" onClick={handleLogout}>
            Log out
          </button>
        </>
      ) : (
        <LoginForm onLogin={handleLogin} />
      )}
      <button className="login-toggle" data-testid="tutorial-toggle" onClick={toggleTutorial}>
        Tutorial: {tutorial ? 'on' : 'off'}
      </button>
      {/* Reporting posts to a login-only route, so only offer it once logged in. */}
      {user && <BugReportButton screen={currentScreen} />}
      {authNotice && <span className="login-error" data-testid="auth-notice">{authNotice}</span>}
    </div>
  )

  // ── Pre-campaign screens ──────────────────────────────────────────────────
  // The demo battle plays through the very same ReplayView a campaign battle
  // uses, fed by the DB. It needs no login, so it must not be trapped behind
  // one: both the login screen and the logged-in no-campaign screen offer it
  // (hiding it after login is how it "vanished" in the 2026-07-15 playtest).
  if (demoBattle) {
    return (
      <div className="app">
        {authBar}
        <ReplayView
          battleId={demoBattle.id}
          tickCount={demoBattle.tickCount}
          info={info}
          map={map}
          autoPlay
          backLabel={user ? 'Back to camp' : 'Back to login'}
          onBack={() => setDemoBattle(null)}
        />
      </div>
    )
  }
  if (!user) {
    return (
      <div className="app">
        {authBar}
        <div className="phase-setup">
          <h2>The Campaign Awaits</h2>
          <TutorialIntro
            id="login"
            enabled={tutorial}
            title="Welcome, commander"
            lines={[
              'Log in (or register) to take command of your army.',
              'Each turn — two weeks of campaigning — you forage, read the omens, and fight or regroup.',
              'Your campaign is saved on the server; you can return any time.',
            ]}
          />
          <p>Log in to begin your campaign.</p>
          <p>Or see the engine in action first:</p>
          <button
            className="btn-primary"
            data-testid="watch-demo"
            onClick={watchDemo}
            disabled={demoLoading}
          >
            {demoLoading ? 'Mustering the armies…' : 'Watch a battle'}
          </button>
        </div>
      </div>
    )
  }

  if (loading && !campaign) {
    return (
      <div className="app">
        {authBar}
        <div className="loading">Loading campaign...</div>
      </div>
    )
  }

  if (!campaign) {
    return (
      <div className="app">
        {authBar}
        <div className="phase-setup">
          <h2>No Campaign In Progress</h2>
          <TutorialIntro
            id="start"
            enabled={tutorial}
            title="Starting a campaign"
            lines={[
              'You lead an army shadowed by an enemy host.',
              'Keep your soldiers fed, learn what you can, and break the enemy before the land is picked clean.',
            ]}
          />
          <button className="btn-primary" data-testid="start-campaign" onClick={startCampaign}>
            Start Campaign
          </button>
          <p>Or watch the engine fight a demo battle first:</p>
          <button
            className="btn-primary"
            data-testid="watch-demo"
            onClick={watchDemo}
            disabled={demoLoading}
          >
            {demoLoading ? 'Mustering the armies…' : 'Watch a battle'}
          </button>
        </div>
      </div>
    )
  }

  // A finished campaign shows the game-over screen — but not before the player
  // has seen the battle result/replay or the day report that ended it.
  if (campaign.status !== 'active' && !['result', 'replay', 'report'].includes(phase)) {
    return (
      <div className="app">
        {authBar}
        <div className="phase-setup">
          <h2>{campaign.status === 'won' ? 'Victory!' : 'Defeat'}</h2>
          <TutorialIntro
            id="gameover"
            enabled={tutorial}
            title="The campaign is over"
            lines={[
              campaign.status === 'won'
                ? 'The enemy host is broken — the country is yours.'
                : 'Your army is gone; the campaign ends here.',
              'Start a new campaign to take the field again from turn one.',
            ]}
          />
          <p>
            {campaign.status === 'won'
              ? `The enemy is broken after ${campaign.day} turns. The country is yours.`
              : `Your army is destroyed on turn ${campaign.day}.`}
          </p>
          <button className="btn-primary" data-testid="start-campaign" onClick={startCampaign}>
            New Campaign
          </button>
        </div>
      </div>
    )
  }

  // ── Active campaign ───────────────────────────────────────────────────────

  // Watching a raid replay takes over the screen; Back returns to whatever
  // phase the player was in (the phase state is untouched underneath).
  if (raidBattle) {
    return (
      <div className="app">
        {authBar}
        <ReplayView
          battleId={raidBattle.id}
          tickCount={raidBattle.tickCount}
          info={info}
          map={map}
          backLabel="Back to the raids"
          onBack={() => setRaidBattle(null)}
        />
      </div>
    )
  }

  // A decision owed with no report on screen (the report died with a reload):
  // reopen the choice cards straight from the view in choices-only mode. The
  // server 409s every other campaign action until they're resolved, so this
  // overlay IS the campaign until then; it drops away with the last choice.
  if ((campaign.pendingChoices?.length ?? 0) > 0 && !(phase === 'report' && dayReport)) {
    return (
      <div className="app">
        <CampaignHUD />
        {authBar}
        <EventRevealScreen pendingChoices={campaign.pendingChoices} onChoose={chooseFate} />
      </div>
    )
  }

  return (
    <div className="app">
      <CampaignHUD />
      {authBar}

      {/* Phase 1 — PREPARE: forage + camp. Plan supplies and defenses while
          stores are full; then read the omens. No raids or augury actions
          here — those are their own screens, in order. */}
      {phase === 'prepare' && (
        <div className="phase-setup">
          <div className="council-main">
            <h2>Turn {campaign.day} — War Council</h2>
            <TutorialIntro
              id="council"
              enabled={tutorial}
              title="The war council"
              lines={[
                'Each turn covers two weeks of campaigning: your army eats, the land empties, the augur reads the signs.',
                'First prepare — send out foragers and see to your camp. Then read the omens, loose your raiders, and deploy your line.',
                `The enemy is ${campaign.enemy.stance === 'camp' ? 'sitting in camp' : campaign.enemy.stance === 'offering_battle' ? 'offering battle' : 'shadowing your army'}.`,
              ]}
            />
            <p>
              Your army has {totalUnits} soldiers.
              Food stores: <strong>{tons(campaign.resources.food)}</strong> —
              they will eat <strong>{tons(campaign.resources.foodNeedPerTurn)}</strong> this turn.
            </p>
            {campaign.resources.food <= 0 && (
              <p className="warning">No food! Units will desert.</p>
            )}
            {campaign.enemy.battleOffer && (
              <p className="warning">Enemy banners are formed up — they offer battle this turn.</p>
            )}
            {campaign.scouting && (
              <ScoutReport scouting={campaign.scouting} enemy={campaign.enemy} />
            )}
            {campaign.forage && (
              <ForagePanel
                key={campaign.day}
                onAssign={guarded(assignForagers)}
              />
            )}
            <button className="btn-primary" data-testid="to-omens" onClick={readOmens}>
              Read the Omens
            </button>
          </div>
          {campaign.fortification && (
            <CampPanel
              onFortify={guarded(fortify)}
              onBuyMilitia={guarded(buyMilitia)}
            />
          )}
        </div>
      )}

      {/* Phase 2 — OMENS: the augur's tent. Read-only army/stores context and
          nothing to act on but the fates themselves. Accepting them plays the
          reveal, then continues on to the raids. */}
      {phase === 'omens' && (
        <div className="phase-omens">
          <TutorialIntro
            id="augury"
            enabled={tutorial}
            title="The augur's vision"
            lines={[
              'The augur reads the coming fortnight and shows one vision for each of its three fates.',
              'The augur may lie: severe omens are the hardest to read, and only the end of the turn tells truth from shadow.',
              'Click a vision to recast its bones — that does not re-read the same fate, it changes that fate itself, for better or worse.',
            ]}
          />
          <p className="omens-context" data-testid="omens-context">
            Your army has {totalUnits} soldiers. Food stores: <strong>{tons(campaign.resources.food)}</strong>;
            materials: <strong>{campaign.resources.materials}</strong>.
          </p>
          <AuguryPanel
            onConsult={guarded(consultAugur)}
            onReroll={guarded(rerollAugur)}
            onAccept={acceptFates}
            onContinue={toRaids}
          />
          <div className="phase-nav">
            <button className="login-toggle" data-testid="back-to-prepare" onClick={backToPrepare}>
              Back to the Council
            </button>
          </div>
        </div>
      )}

      {/* Phase 3 — RAIDS: with the fates now known, commit raiders (a
          counter-raid can unmake a bad omen), then deploy for battle. */}
      {phase === 'raids' && (
        <div className="phase-raids">
          <h2>Targets of Opportunity</h2>
          {campaign.scouting && (
            <ScoutReport scouting={campaign.scouting} enemy={campaign.enemy} />
          )}
          {campaign.raid && (
            <RaidPanel
              key={`raids-${campaign.day}`}
              units={info.units}
              onLaunchAll={guarded(launchRaids)}
              onScout={guarded(scoutRaid)}
              onWatch={watchRaid}
            />
          )}
          <div className="raids-bar">
            <button className="login-toggle" data-testid="back-to-omens" onClick={backToOmens}>
              Back to the Omens
            </button>
            <button className="btn-primary" data-testid="to-deploy" onClick={musterForBattle}>
              Deploy for Battle
            </button>
          </div>
        </div>
      )}

      {phase === 'report' && dayReport && (
        <EventRevealScreen
          report={dayReport}
          onChoose={chooseFate}
          // The mid-turn fates reveal (from the tent) continues on to the
          // raids; the end-of-turn report opens the next turn's council.
          onContinue={() => {
            const kind = dayReport.kind
            setDayReport(null)
            setPhase(kind === 'fates' ? 'raids' : 'prepare')
          }}
        />
      )}

      {(phase === 'placement' || phase === 'battling') && (
        <div className="phase-placement">
          <TutorialIntro
            id="placement"
            enabled={tutorial}
            title="Deployment"
            lines={[
              'Click a highlighted hex in your half to place troops; the enemy waits beyond the red line.',
              'Give standing orders in the Orders section — set Hold (turns) to make a stack hold position instead of advancing; a ⌛ badge marks held hexes.',
              'Battle commits the whole army: Fight unlocks once every unit is on the field. Only foragers, out sweeping the rings, stay behind.',
              'Fight when ready — or end the turn without battle.',
            ]}
          />
          {campaign.scouting && (
            <ScoutReport scouting={campaign.scouting} enemy={campaign.enemy} />
          )}
          <HexGrid info={info} map={map} />
          <div className="placement-bar">
            <span>
              {placedCount + squadPlacedCount} units placed in {placements.length} hex{placements.length !== 1 ? 'es' : ''}
              {Object.keys(squadPlacements).length > 0 &&
                ` + ${Object.keys(squadPlacements).length} squad${Object.keys(squadPlacements).length !== 1 ? 's' : ''}`}
              {inCamp > 0 && (
                <span className="placement-in-camp" data-testid="placement-in-camp">
                  {' '}— {inCamp} still in camp
                </span>
              )}
            </span>
            {phase === 'placement' && (
              <>
                <button
                  className="btn-primary"
                  onClick={startBattle}
                  disabled={(placedCount === 0 && squadPlacedCount === 0) || inCamp > 0 || campaign.battleFoughtToday}
                  title={inCamp > 0 ? `Deploy your whole army — ${inCamp} still in camp` : undefined}
                >
                  Fight!
                </button>
                <button className="login-toggle" data-testid="end-day" onClick={nextDay}>
                  End Turn{campaign.battleFoughtToday ? '' : ' (no battle)'}
                </button>
              </>
            )}
            {phase === 'battling' && (
              <span className="battling-label">Battle in progress...</span>
            )}
          </div>
        </div>
      )}

      {phase === 'result' && battleResult && (
        <BattleResult
          result={battleResult}
          onNextDay={
            campaign.status === 'active'
              ? nextDay
              // The battle ended the campaign: end-day would 400, go to game over.
              : () => { setBattleResult(null); setPhase('prepare') }
          }
          onWatchReplay={
            battleResult.id && battleResult.tickCount > 0
              ? () => setPhase('replay')
              : undefined
          }
        />
      )}

      {phase === 'replay' && battleResult?.id && (
        <ReplayView
          battleId={battleResult.id}
          tickCount={battleResult.tickCount}
          info={info}
          map={map}
          onBack={() => setPhase('result')}
        />
      )}
    </div>
  )
}

export default App
