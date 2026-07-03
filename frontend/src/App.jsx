import React, { useState, useEffect } from 'react'
import { getInfo, getMap, setToken } from './services/api'
import useCampaign from './hooks/useCampaign'
import HexGrid from './components/HexGrid'
import EventCards from './components/EventCards'
import ForagePanel from './components/ForagePanel'
import CampaignHUD from './components/CampaignHUD'
import BattleResult from './components/BattleResult'
import ReplayView from './components/ReplayView'
import LoginForm from './components/LoginForm'
import TutorialIntro from './components/TutorialIntro'
import './App.css'

// All campaign state (day, food, roster, events, enemy) lives server-side —
// this component is a client of the campaign view and only owns UI state:
// which screen is showing, in-progress placements, and the auth session.

const App = () => {
  const [info,         setInfo]         = useState(null)
  const [map,          setMap]          = useState(null)
  const [phase,        setPhase]        = useState('setup')
  const [placements,   setPlacements]   = useState([])
  const [battleResult, setBattleResult] = useState(null)
  const [error,        setError]        = useState(null)
  const [user,         setUser]         = useState(null) // { token, username, name }
  const [authNotice,   setAuthNotice]   = useState(null)
  const [tutorial,     setTutorial]     = useState(
    () => window.localStorage.getItem('tutorialEnabled') !== 'off',
  )

  const { campaign, loading, create, pickEvent, assignForagers, fight, endDay } = useCampaign(user)

  useEffect(() => {
    Promise.all([getInfo(), getMap()])
      .then(([infoData, mapData]) => { setInfo(infoData); setMap(mapData) })
      .catch(() => setError('Could not reach game server. Start it with: ./game server'))
  }, [])

  // Rehydrate a stored session; the token may be stale (1h expiry) — the
  // first protected call after expiry gets a 401 and logs back out.
  useEffect(() => {
    const stored = window.localStorage.getItem('loggedGameUser')
    if (stored) {
      const u = JSON.parse(stored)
      setToken(u.token)
      setUser(u)
    }
  }, [])

  const handleLogin = (u) => {
    window.localStorage.setItem('loggedGameUser', JSON.stringify(u))
    setToken(u.token)
    setUser(u)
    setAuthNotice(null)
  }

  const handleLogout = () => {
    window.localStorage.removeItem('loggedGameUser')
    setToken(null)
    setUser(null)
    setPhase('setup')
  }

  const toggleTutorial = () => {
    const next = !tutorial
    window.localStorage.setItem('tutorialEnabled', next ? 'on' : 'off')
    setTutorial(next)
  }

  // Campaign calls share one error path: an expired token drops back to the
  // login screen instead of the fatal connection-error screen.
  const guarded = (fn) => async (...args) => {
    try {
      return await fn(...args)
    } catch (e) {
      if (e.response?.status === 401) {
        handleLogout()
        setAuthNotice('Session expired — log in again.')
      } else if (e.response?.data?.error) {
        setAuthNotice(e.response.data.error)
      } else {
        setError('Campaign server call failed. Check that it is running.')
      }
      return undefined
    }
  }

  const startCampaign = guarded(async () => {
    await create()
    setPhase('setup')
  })

  const startAugury = () => setPhase('augury')

  const handlePickEvent = guarded(async (event) => {
    await pickEvent(event.id)
    setPlacements([])
    setPhase('placement')
  })

  const startBattle = guarded(async () => {
    if (placements.length === 0) return
    setPhase('battling')

    const toAxial = (col, row) => ({ q: col - Math.floor(row / 2), r: row })
    const playerPlacement = placements.flatMap(p => {
      const { q, r } = toAxial(p.col, p.row)
      const holdTurns = p.holdTurns ?? 0
      return Array.from({ length: p.count }, () => ({ unit_type: p.type, q, r, hold_turns: holdTurns }))
    })

    const result = await fight(playerPlacement)
    if (!result) {
      setPhase('placement') // guarded() already surfaced the error
      return
    }
    setBattleResult(result)
    setPhase('result')
  })

  const nextDay = guarded(async () => {
    await endDay()
    setPlacements([])
    setBattleResult(null)
    setPhase('setup')
  })

  if (error) {
    return (
      <div className="error-screen">
        <h2>Connection Error</h2>
        <p>{error}</p>
      </div>
    )
  }

  if (!info || !map) {
    return <div className="loading">Connecting to game server...</div>
  }

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
      {authNotice && <span className="login-error" data-testid="auth-notice">{authNotice}</span>}
    </div>
  )

  // ── Pre-campaign screens ──────────────────────────────────────────────────
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
        </div>
      </div>
    )
  }

  if (campaign.status !== 'active') {
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
  // Units out foraging are unavailable for this turn's battle line.
  const forageAssignment = campaign.forage?.assignment ?? {}
  const availableRoster = Object.fromEntries(
    Object.entries(roster).map(([type, n]) => [type, n - (forageAssignment[type] ?? 0)]),
  )

  return (
    <div className="app">
      <CampaignHUD
        day={campaign.day}
        food={campaign.resources.food}
        foodNeed={campaign.resources.foodNeedPerTurn}
        materials={campaign.resources.materials}
        augury={campaign.auguryScore}
        roster={roster}
        forage={campaign.forage}
      />
      {authBar}

      {phase === 'setup' && (
        <div className="phase-setup">
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
            Food stores: <strong>{campaign.resources.food} kg</strong> —
            they will eat <strong>{campaign.resources.foodNeedPerTurn} kg</strong> this turn.
          </p>
          {campaign.resources.food <= 0 && (
            <p className="warning">No food! Units will desert.</p>
          )}
          {campaign.enemy.battleOffer && (
            <p className="warning">Enemy banners are formed up — they offer battle this turn.</p>
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
          {campaign.events.length > 0 ? (
            <button className="btn-primary" onClick={startAugury}>
              Consult the Augur
            </button>
          ) : (
            <button className="btn-primary" onClick={() => setPhase('placement')}>
              Muster for Battle
            </button>
          )}
        </div>
      )}

      {phase === 'augury' && (
        <>
          <TutorialIntro
            id="augury"
            enabled={tutorial}
            title="The augur speaks"
            lines={[
              'Three omens are shown; choose one and its fate befalls the camp.',
              'The percentages hint at how much you trust the augur today.',
            ]}
          />
          <EventCards events={campaign.events} onPick={handlePickEvent} />
        </>
      )}

      {(phase === 'placement' || phase === 'battling') && (
        <div className="phase-placement">
          <TutorialIntro
            id="placement"
            enabled={tutorial}
            title="Deployment"
            lines={[
              'Click a highlighted hex in your half to place troops; the enemy waits beyond the red line.',
              'Units left unplaced stay safe in camp; foragers are out sweeping the rings.',
              'Fight when ready — or end the turn without battle.',
            ]}
          />
          <HexGrid
            info={info}
            map={map}
            placements={placements}
            onPlacementsChange={setPlacements}
            roster={availableRoster}
            disabled={phase === 'battling'}
          />
          <div className="placement-bar">
            <span>{placements.reduce((s, p) => s + p.count, 0)} units placed in {placements.length} hex{placements.length !== 1 ? 'es' : ''}</span>
            {phase === 'placement' && (
              <>
                <button
                  className="btn-primary"
                  onClick={startBattle}
                  disabled={placements.length === 0 || campaign.battleFoughtToday}
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
          onNextDay={nextDay}
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
