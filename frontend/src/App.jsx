import React, { useState, useEffect } from 'react'
import { getInfo, getMap } from './services/api'
import useAuthStore from './stores/useAuthStore'
import useNoticeStore from './stores/useNoticeStore'
import useCampaignStore from './stores/useCampaignStore'
import usePlacementStore from './stores/usePlacementStore'
import useUiStore from './stores/useUiStore'
import { guarded } from './stores/guarded'
import {
  handleLogin, handleLogout, startCampaign, musterForBattle, startBattle,
  watchRaid, nextDay, watchDemo,
} from './stores/flows'
import HexGrid from './components/HexGrid'
import AuguryPanel from './components/AuguryPanel'
import DayReport from './components/DayReport'
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

  const { placements, squadPlacements, setPlacements, setSquadPlacements } = usePlacementStore()

  const user = useAuthStore((s) => s.user)
  const authNotice = useNoticeStore((s) => s.message)

  const { campaign, loading, consultAugur, rerollAugur, assignForagers, fortify, buyMilitia, launchRaids, reload } = useCampaignStore()

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

  const startAugury = () => setPhase('augury')

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
  const roster = campaign.roster
  const totalUnits = Object.values(roster).reduce((a, b) => a + b, 0)
  const squads = campaign.squads ?? []
  // Units out foraging are unavailable for this turn's battle line. Squad
  // members are earmarked to their squad and aren't offered individually
  // under "Troops" — a squad is placed as a whole (HexGrid/ReachMenu), not
  // built up unit-by-unit like loose stock.
  const forageAssignment = campaign.forage?.assignment ?? {}
  const squadCommitted = {}
  squads.forEach(sq => Object.entries(sq.composition).forEach(([type, n]) => {
    squadCommitted[type] = (squadCommitted[type] ?? 0) + n
  }))
  const availableRoster = Object.fromEntries(
    Object.entries(roster).map(([type, n]) =>
      [type, n - (forageAssignment[type] ?? 0) - (squadCommitted[type] ?? 0)]),
  )
  // Battle commits the WHOLE army (user, 2026-07-05): only foragers stay
  // behind. Fight unlocks when every available unit — loose stock AND every
  // squad — is on the field; the server enforces the same rule.
  const placedCount = placements.reduce((s, p) => s + p.count, 0)
  const squadPlacedCount = Object.keys(squadPlacements).reduce((sum, id) => {
    const sq = squads.find(s => String(s.id) === String(id))
    if (!sq) return sum
    return sum + Object.values(sq.composition).reduce((a, b) => a + b, 0)
  }, 0)
  const totalAvailableCount = Object.values(roster).reduce((a, b) => a + b, 0)
    - Object.values(forageAssignment).reduce((a, b) => a + b, 0)
  const inCamp = totalAvailableCount - placedCount - squadPlacedCount

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
          backLabel="Back to the council"
          onBack={() => setRaidBattle(null)}
        />
      </div>
    )
  }

  return (
    <div className="app">
      <CampaignHUD
        day={campaign.day}
        food={campaign.resources.food}
        foodNeed={campaign.resources.foodNeedPerTurn}
        materials={campaign.resources.materials}
        fortLevel={campaign.fortification?.level ?? 0}
        roster={roster}
        forage={campaign.forage}
      />
      {authBar}

      {phase === 'setup' && (
        <div className="phase-setup">
          <div className="council-main">
            <h2>Turn {campaign.day} — War Council</h2>
            <TutorialIntro
              id="council"
              enabled={tutorial}
              title="The war council"
              lines={[
                'Each turn covers two weeks of campaigning: your army eats, the land empties, the augur reads the signs.',
                'Send out foragers, consult the augur, then deploy your line — or rest and regroup.',
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
                forage={campaign.forage}
                roster={roster}
                onAssign={guarded(assignForagers)}
                tutorial={tutorial}
              />
            )}
            {campaign.raid && (
              <RaidPanel
                key={`raids-${campaign.day}`}
                raid={campaign.raid}
                scouting={campaign.scouting}
                roster={roster}
                forageAssignment={forageAssignment}
                units={info.units}
                onLaunchAll={guarded(launchRaids)}
                onWatch={watchRaid}
                tutorial={tutorial}
              />
            )}
            {!campaign.augury.consulted ? (
              <button className="btn-primary" onClick={startAugury}>
                Visit the Augur
              </button>
            ) : (
              <button className="btn-primary" onClick={musterForBattle}>
                Muster for Battle
              </button>
            )}
          </div>
          {campaign.fortification && (
            <CampPanel
              fortification={campaign.fortification}
              resources={campaign.resources}
              workers={campaign.workers}
              onFortify={guarded(fortify)}
              onBuyMilitia={guarded(buyMilitia)}
              tutorial={tutorial}
            />
          )}
        </div>
      )}

      {phase === 'augury' && (
        <>
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
          <AuguryPanel
            augury={campaign.augury}
            onConsult={guarded(consultAugur)}
            onReroll={guarded(rerollAugur)}
            onContinue={musterForBattle}
          />
        </>
      )}

      {phase === 'report' && dayReport && (
        <DayReport
          report={dayReport}
          onContinue={() => { setDayReport(null); setPhase('setup') }}
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
          <HexGrid
            info={info}
            map={map}
            placements={placements}
            onPlacementsChange={setPlacements}
            roster={availableRoster}
            disabled={phase === 'battling'}
            fortifiedSides={campaign.fortification?.sides ?? []}
            squads={squads}
            squadPlacements={squadPlacements}
            onSquadPlacementsChange={setSquadPlacements}
            enemyPlacements={campaign.enemy.placements ?? []}
          />
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
              : () => { setBattleResult(null); setPhase('setup') }
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
