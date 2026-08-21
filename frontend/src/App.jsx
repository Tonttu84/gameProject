import React, { useState, useEffect } from 'react'
import { getInfo, getMap } from './services/api'
import useAuthStore from './stores/useAuthStore'
import useNoticeStore from './stores/useNoticeStore'
import useCampaignStore from './stores/useCampaignStore'
import usePlacementStore from './stores/usePlacementStore'
import useUiStore from './stores/useUiStore'
import { guarded } from './stores/guarded'
import {
  handleLogin, handleLogout, startCampaign, breakCamp, acceptFates,
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
import RecruitPanel from './components/RecruitPanel'
import CampPanel from './components/CampPanel'
import CharacterPanel from './components/CharacterPanel'
import ItemStorePanel from './components/ItemStorePanel'
import CampaignHUD from './components/CampaignHUD'
import CampaignIntro from './components/CampaignIntro'
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

// The turn's phases, in the server's order (models/campaign.js TURN_PHASES).
// The client's `phase` is the SCREEN, which is a superset: report/placement/
// battling/result/replay are UI-only and have no server phase (the battle ones
// all sit inside the server's 'deploy'). Anything not on this ladder is such a
// screen, so it compares as -1 and is never treated as a passed phase.
const TURN_PHASES = ['prepare', 'omens', 'raids', 'recruit', 'deploy']
const phaseRank = (phase) => TURN_PHASES.indexOf(phase)

const App = () => {
  const [info, setInfo] = useState(null)
  const [map,  setMap]  = useState(null)

  const {
    phase, setPhase, battleResult, setBattleResult, raidBattle, setRaidBattle,
    dayReport, setDayReport, demoBattle, setDemoBattle, demoLoading,
    tutorial, toggleTutorial, connectionError, setConnectionError,
    introSeen, setIntroSeen, storeRequest,
  } = useUiStore()

  const { placements, squadPlacements } = usePlacementStore()

  const user = useAuthStore((s) => s.user)
  const authNotice = useNoticeStore((s) => s.message)

  const { campaign, loading, consultAugur, rerollAugur, setEffort, advancePhase, fortify, launchRaids, scoutRaid, openRecruit, hireRecruit, takeSquadUpgrade, bindSquadBanner, attachCharacter, setCharacterHangBack, resolveChoice, reload } = useCampaignStore()

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

  // The turn's phase is SERVER state now (campaign.phase), so the screen
  // follows it: a mid-turn reload lands where the turn actually stands rather
  // than dumping the player back on the War Council with every button 409ing.
  // Only turn phases are synced — a UI-only screen (report/placement/result/…)
  // is left alone, since the server phase hasn't moved under it.
  // Forward-only, and only from another TURN screen: a UI-only screen
  // (report/placement/result/replay, rank −1) is never yanked out from under
  // the player — end-day pushes the server back to 'prepare' while the day
  // report is still on screen, and that must not skip the report.
  const serverPhase = campaign?.phase
  useEffect(() => {
    if (!serverPhase) return
    const current = useUiStore.getState().phase
    if (phaseRank(current) === -1) return
    if (phaseRank(current) < phaseRank(serverPhase)) setPhase(serverPhase)
  }, [serverPhase, setPhase])

  // Anything the player is LOOKING at that the turn has already marched past
  // is a record, not a control: the panels render read-only and the server
  // refuses their writes anyway (routes' rejectIfPhasePassed). One value
  // suffices — only one turn-phase screen is mounted at a time.
  const committed = phaseRank(phase) > -1 && phaseRank(phase) < phaseRank(serverPhase)

  // The turn runs as a sequence of single-purpose screens the player advances
  // through: Prepare (forage + camp) → Omens (the augur) → Raids → Recruit →
  // Deploy. Splitting them keeps the pipeline clear and, crucially, puts the
  // fates BEFORE raider assignment so a counter-raid is an informed choice,
  // not a blind one (docs/CAMPAIGN_PLAN.md, 2026-07-18). Recruit sits after
  // Raids so gold earned from a raid (resolved synchronously on launch) is
  // spendable the same turn (docs/CAMPAIGN_PLAN.md, Recruit phase design).
  //
  // Advancing is a SERVER call (the phase field is the authority); the sync
  // effect above then moves the screen. Nothing advances locally, so a failed
  // call leaves the player where they were rather than on a screen the server
  // disagrees with.
  const readOmens = guarded(() => advancePhase('omens'))
  const toRaids = guarded(() => advancePhase('raids'))
  // Recruit is the ONE transition that isn't a pure phase change: entering it
  // draws the day's offer, so it goes through openRecruit (which stamps the
  // phase too). Only advance if the draw actually landed — guarded returns
  // undefined on failure, and marching onto an offerless screen would strand
  // the player with no way forward.
  const toRecruit = async () => {
    if (campaign.recruit?.drawn) return setPhase('recruit')
    if (await guarded(openRecruit)() !== undefined) setPhase('recruit')
  }
  // Back-steps are pure LOOKING now: the phase they return to is behind the
  // turn, so its panels render read-only (`committed` above) and the server
  // refuses any write that got through. Nothing is undone by going back, and
  // nothing can be re-decided there — that's the whole point of the one-way
  // march (docs/CAMPAIGN_PLAN.md "Effort slider", decision 12).
  const backToPrepare = () => setPhase('prepare')
  const backToOmens = () => setPhase('omens')
  // Resolve a pending choice-fate (events with choices). Guarded like every
  // campaign action; the reveal screen reads the undefined-on-failure return
  // to keep the options up for another try.
  const chooseFate = guarded(resolveChoice)

  // What a back-stepped screen shows in place of its advance button: this is a
  // record of a decision already made, and the only way out of it is forward
  // again to where the turn actually stands.
  const PHASE_NAMES = { prepare: 'the Council', omens: 'the Omens', raids: 'the Raids', recruit: 'Recruiting', deploy: 'the battle line' }
  const committedBanner = (
    <div className="phase-committed" data-testid="phase-committed">
      <p>Already decided — the turn has moved on to {PHASE_NAMES[serverPhase] ?? serverPhase}.</p>
      <button
        className="btn-primary"
        data-testid="back-to-current-phase"
        onClick={() => setPhase(serverPhase)}
      >
        Return to {PHASE_NAMES[serverPhase] ?? serverPhase}
      </button>
    </div>
  )

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

  // One-time scene-setter on turn 1: the situation at Karrowgate, before the
  // war council. Not tutorial-gated (it's story); dismissed by "Take command".
  if (campaign.day === 1 && !introSeen) {
    return (
      <div className="app">
        {authBar}
        <CampaignIntro onBegin={() => setIntroSeen(true)} />
      </div>
    )
  }

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

  // Choosing an item for a slot takes over the screen the same way a replay
  // does; Back returns to whatever phase the player was in (6-14). It sits
  // ABOVE the pending-choices overlay deliberately — binding is not a campaign
  // action the server 409s on, so a player who opened the stores can finish
  // what they were doing rather than being bounced into the choice cards.
  if (storeRequest) {
    return (
      <div className="app">
        {authBar}
        <ItemStorePanel onBind={guarded(bindSquadBanner)} />
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
                'Each turn covers two weeks of the siege: your army eats, the land around Karrowgate empties, the augur reads the signs.',
                'First prepare — send out foragers and see to your camp. Then read the omens, loose your raiders, and deploy your line.',
                // Karrowgate's walls re-derived from the boss-fight meter band
                // (+ bossFightDue), the single signal since stance was retired.
                // FLAGGED FOR PLAYTEST: this band→prose mapping is a first pass.
                `Karrowgate's walls ${campaign.bossFightDue ? 'are breached — the enemy turns to give battle this turn' : campaign.meter?.band === 'breached' ? 'are breached; the city cannot hold much longer' : campaign.meter?.band === 'damaged' ? 'are battered and breaking' : 'still stand firm'}.`,
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
            {campaign.bossFightDue && (
              <p className="warning" data-testid="pitched-battle-warning">
                Karrowgate&apos;s walls are breached — the pitched battle is upon you
                this turn. You must deploy your whole army and give battle before the
                turn can end. Foragers and raiders sent out now will be missing from
                the line.
              </p>
            )}
            {campaign.scouting && (
              <ScoutReport scouting={campaign.scouting} enemy={campaign.enemy} />
            )}
            {campaign.forage && (
              <ForagePanel
                key={campaign.day}
                onSetShare={guarded(setEffort)}
                locked={committed}
              />
            )}
            {committed ? committedBanner : (
              <button className="btn-primary" data-testid="to-omens" onClick={readOmens}>
                Read the Omens
              </button>
            )}
          </div>
          {campaign.fortification && (
            <CampPanel onFortify={guarded(fortify)} locked={committed} />
          )}
          {/* Characters live on the camp screen because posting one to a squad
              is a PREPARE-phase decision in spirit — though the server gates it
              nowhere (5-7), so it stays usable if the player comes back to it. */}
          <CharacterPanel
            onAttach={guarded(attachCharacter)}
            onSetHangBack={guarded(setCharacterHangBack)}
          />
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
            title="The augur and the Vael"
            lines={[
              'The augur reads the coming fortnight in the Vael — the unshaped stuff of what may yet be — and shows one vision for each of its three fates.',
              'A vision may mislead: the gravest fates lie deepest and read least clearly, and only the end of the turn tells truth from shadow.',
              'Click a vision to trouble its thread in the Vael — that does not re-read the same fate, it draws a different one in its place, for better or worse.',
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
            locked={committed}
          />
          {committed && committedBanner}
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
          {campaign.bossFightDue && (
            <p className="warning" data-testid="pitched-battle-raids">
              The pitched battle is today — raiders you commit now will be absent
              from the decisive line. Raid greedily, or hold them for the fight.
            </p>
          )}
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
              locked={committed}
            />
          )}
          <div className="raids-bar">
            <button className="login-toggle" data-testid="back-to-omens" onClick={backToOmens}>
              Back to the Omens
            </button>
            {committed ? committedBanner : (
              <button className="btn-primary" data-testid="to-recruit" onClick={toRecruit}>
                Continue to Recruiting
              </button>
            )}
          </div>
        </div>
      )}

      {/* Phase 4 — RECRUIT: with raid gold in hand, spend the day's one hire,
          then close the turn. No back button: opening this screen closed
          the camp for the day, so there is nothing behind it that would still
          accept an action. The exit stays locked until the hire is resolved —
          the hire is the only way forward, which the free Travellers card
          guarantees is always possible.

          The exit is deployment ONLY on the pitched-battle day; on a quiet turn
          it ends the turn outright (breakCamp), since there is no battle to
          deploy for and an empty deployment screen read as an offer of one. */}
      {phase === 'recruit' && (
        <div className="phase-recruit">
          <h2>Recruiting</h2>
          <RecruitPanel
            key={`recruit-${campaign.day}`}
            onHire={guarded(hireRecruit)}
            onTakeUpgrade={guarded(takeSquadUpgrade)}
          />
          <div className="raids-bar">
            <button
              className="btn-primary"
              data-testid="to-deploy"
              onClick={breakCamp}
              disabled={!campaign.recruit?.hiredToday}
              title={campaign.recruit?.hiredToday ? undefined : 'Take the day\'s hire before you march'}
            >
              {campaign.bossFightDue ? 'Deploy for Battle' : 'End the Turn'}
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
              'The pitched battle commits the whole army: Fight unlocks once every unit is on the field. Only foragers and raiders, out beyond the line, stay behind.',
              'This screen only opens on the day of the pitched battle — the fight is decisive and mandatory, and the turn cannot end until it is fought.',
            ]}
          />
          {campaign.bossFightDue && (
            <p className="warning" data-testid="pitched-battle-deploy">
              Pitched battle! The enemy has committed to a decisive fight this turn.
              Deploy your whole army — this battle decides the campaign, and the turn
              cannot end until it is fought.
            </p>
          )}
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
                {/* Fight! only exists on the pitched-battle day: before the
                    meter fills the enemy offers no battle (server 400s the
                    battle route), so deploying-to-fight is impossible and the
                    button would only lead to a raw error. */}
                {campaign.bossFightDue && (
                  <button
                    className="btn-primary"
                    onClick={startBattle}
                    disabled={(placedCount === 0 && squadPlacedCount === 0) || inCamp > 0 || campaign.battleFoughtToday}
                    title={inCamp > 0 ? `Deploy your whole army — ${inCamp} still in camp` : undefined}
                  >
                    Fight!
                  </button>
                )}
                {/* The pitched battle is mandatory: the turn cannot end until it
                    is fought (the server 400s end-day otherwise), so the "end
                    without battle" escape is withheld until the field is won or
                    lost. It also stays as the no-soft-lock guarantee: this screen
                    has no back button, and breakCamp only opens it when the
                    battle is due, so should a campaign ever land here without one
                    the turn can still be ended. */}
                {!(campaign.bossFightDue && !campaign.battleFoughtToday) && (
                  <button className="login-toggle" data-testid="end-day" onClick={nextDay}>
                    End Turn{campaign.battleFoughtToday ? '' : ' (no battle)'}
                  </button>
                )}
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
