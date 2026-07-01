import { useState, useEffect } from 'react'
import { getInfo, postBattle } from './services/api'
import HexGrid from './components/HexGrid'
import EventCards from './components/EventCards'
import CampaignHUD from './components/CampaignHUD'
import BattleResult from './components/BattleResult'
import './App.css'

const EVENT_POOL = [
  { id: 'supply',         title: 'Supply Cache',        description: 'Scouts find an abandoned depot.',               effect: { type: 'food',       delta: +30 } },
  { id: 'reinforcement',  title: 'Reinforcements',       description: 'A company joins your banner. +20 Soldiers.',    effect: { type: 'roster',     unit: 'Soldier', delta: +20 } },
  { id: 'desertion',      title: 'Desertion',            description: 'Low morale: 10% of soldiers desert overnight.', effect: { type: 'roster',     unit: 'Soldier', factor: 0.9 } },
  { id: 'plague',         title: 'Plague',               description: 'Disease thins the ranks by 5%.',               effect: { type: 'all_roster', factor: 0.95 } },
  { id: 'intel',          title: 'Enemy Intel',          description: 'A defector brings battle plans.',               effect: { type: 'augury',     delta: +15 } },
  { id: 'ambush',         title: 'Enemy Ambush',         description: 'Enemy scouts have located your camp.',          effect: { type: 'enemy_advance' } },
  { id: 'weather',        title: 'Harsh Weather',        description: 'Cold snap drains rations. -10 food.',           effect: { type: 'food',       delta: -10 } },
  { id: 'traders',        title: 'Traveling Traders',    description: 'Merchants sell supplies. +15 food.',            effect: { type: 'food',       delta: +15 } },
]

const drawEvents = (auguryScore) => {
  const shuffled = [...EVENT_POOL].sort(() => Math.random() - 0.5)
  const real   = shuffled[0]
  const decoy1 = shuffled[1]
  const decoy2 = shuffled[2]

  const realPct  = auguryScore
  const half     = Math.round((100 - auguryScore) / 2)
  const other    = 100 - realPct - half

  return [
    { ...real,   probability: realPct, isReal: true  },
    { ...decoy1, probability: half,    isReal: false },
    { ...decoy2, probability: other,   isReal: false },
  ].sort(() => Math.random() - 0.5)
}

const applyEffect = (effect, roster, food, augury) => {
  let r = { ...roster }
  let f = food
  let a = augury

  if (effect.type === 'food') {
    f = Math.max(0, food + effect.delta)
  } else if (effect.type === 'roster') {
    if (effect.delta !== undefined)
      r[effect.unit] = Math.max(0, (r[effect.unit] ?? 0) + effect.delta)
    else if (effect.factor !== undefined)
      r[effect.unit] = Math.floor((r[effect.unit] ?? 0) * effect.factor)
  } else if (effect.type === 'all_roster') {
    Object.keys(r).forEach(k => { r[k] = Math.floor(r[k] * effect.factor) })
  } else if (effect.type === 'augury') {
    a = Math.min(100, Math.max(0, augury + effect.delta))
  }
  // 'enemy_advance' has no immediate roster effect; handled at battle time (TODO)

  return { roster: r, food: f, augury: a }
}

const STARTING_ROSTER = { Soldier: 300, Archer: 50, Mage: 3, Priest: 3, Cavalry: 10 }

const App = () => {
  const [info,         setInfo]         = useState(null)
  const [phase,        setPhase]        = useState('setup')
  const [day,          setDay]          = useState(1)
  const [food,         setFood]         = useState(100)
  const [augury,       setAugury]       = useState(50)
  const [roster,       setRoster]       = useState(STARTING_ROSTER)
  const [placements,   setPlacements]   = useState([])
  const [events,       setEvents]       = useState([])
  const [battleResult, setBattleResult] = useState(null)
  const [error,        setError]        = useState(null)

  useEffect(() => {
    getInfo()
      .then(setInfo)
      .catch(() => setError('Could not reach game server. Start it with: ./game server'))
  }, [])

  const startAugury = () => {
    setEvents(drawEvents(augury))
    setPhase('augury')
  }

  const pickEvent = (event) => {
    const updated = applyEffect(event.effect, roster, food, augury)
    setRoster(updated.roster)
    setFood(updated.food)
    setAugury(updated.augury)
    setPlacements([])
    setPhase('placement')
  }

  const startBattle = async () => {
    if (placements.length === 0) return
    setPhase('battling')

    // Expand placements: each stack entry becomes `count` individual unit objects
    const playerUnits = placements.flatMap(p =>
      Array.from({ length: p.count }, () => ({ type: p.type, col: p.col, row: p.row }))
    )

    try {
      const result = await postBattle({ player: playerUnits, enemy_preset: 'default' })
      setBattleResult(result)
      setPhase('result')
    } catch (e) {
      setError('Battle subprocess failed. Check that ./game is built.')
      setPhase('placement')
    }
  }

  const nextDay = () => {
    if (battleResult?.blue_survivors) {
      setRoster({ ...battleResult.blue_survivors })
    }
    const totalUnits = Object.values(roster).reduce((a, b) => a + b, 0)
    setFood(f => Math.max(0, f - Math.ceil(totalUnits / 10)))
    setDay(d => d + 1)
    setPlacements([])
    setBattleResult(null)
    setPhase('setup')
  }

  if (error) {
    return (
      <div className="error-screen">
        <h2>Connection Error</h2>
        <p>{error}</p>
      </div>
    )
  }

  if (!info) {
    return <div className="loading">Connecting to game server...</div>
  }

  return (
    <div className="app">
      <CampaignHUD day={day} food={food} augury={augury} roster={roster} />

      {phase === 'setup' && (
        <div className="phase-setup">
          <h2>Day {day} — Morning Council</h2>
          <p>
            Your army has {Object.values(roster).reduce((a, b) => a + b, 0)} soldiers.
            Food stores: <strong>{food}</strong>.
          </p>
          {food <= 0 && (
            <p className="warning">No food! Units will desert.</p>
          )}
          <button className="btn-primary" onClick={startAugury}>
            Consult the Augur
          </button>
        </div>
      )}

      {phase === 'augury' && (
        <EventCards events={events} onPick={pickEvent} />
      )}

      {(phase === 'placement' || phase === 'battling') && (
        <div className="phase-placement">
          <HexGrid
            info={info}
            placements={placements}
            onPlacementsChange={setPlacements}
            roster={roster}
            disabled={phase === 'battling'}
          />
          <div className="placement-bar">
            <span>{placements.reduce((s, p) => s + p.count, 0)} units placed in {placements.length} hex{placements.length !== 1 ? 'es' : ''}</span>
            {phase === 'placement' && (
              <button
                className="btn-primary"
                onClick={startBattle}
                disabled={placements.length === 0}
              >
                Fight!
              </button>
            )}
            {phase === 'battling' && (
              <span className="battling-label">Battle in progress...</span>
            )}
          </div>
        </div>
      )}

      {phase === 'result' && battleResult && (
        <BattleResult result={battleResult} onNextDay={nextDay} />
      )}
    </div>
  )
}

export default App
