import React from 'react'
import useUiStore from '../stores/useUiStore'
import TutorialIntro from './TutorialIntro'

const BattleResult = ({ result, onNextDay, onWatchReplay }) => {
  const tutorial = useUiStore((s) => s.tutorial)
  const { winner, blue_survivors, red_survivors } = result

  const totalBlue = Object.values(blue_survivors).reduce((a, b) => a + b, 0)
  const totalRed  = Object.values(red_survivors).reduce((a, b) => a + b, 0)

  return (
    <div className="result-screen">
      <h2 className={`result-title result-${winner}`}>
        {winner === 'blue' ? 'Victory' : winner === 'red' ? 'Defeat' : 'Draw'}
      </h2>
      <TutorialIntro
        id="result"
        enabled={tutorial}
        title="After the battle"
        lines={[
          'The survivors on each side are tallied here — the fallen are gone from your roster for good.',
          onWatchReplay
            ? 'Watch the replay to see how the lines broke, or press on to resolve the fortnight.'
            : 'Press on to resolve the rest of the fortnight.',
        ]}
      />
      <div className="result-columns">
        <div className="result-col result-col-blue">
          <h3>Your survivors ({totalBlue})</h3>
          {Object.entries(blue_survivors).map(([type, n]) => (
            <div key={type}>{n} {type}</div>
          ))}
        </div>
        <div className="result-col result-col-red">
          <h3>Enemy survivors ({totalRed})</h3>
          {Object.entries(red_survivors).map(([type, n]) => (
            <div key={type}>{n} {type}</div>
          ))}
        </div>
      </div>
      {onWatchReplay && (
        <button className="result-replay" onClick={onWatchReplay}>
          Watch Replay
        </button>
      )}
      <button className="result-next" onClick={onNextDay}>
        {winner === 'blue' ? 'Press On' : 'Retreat & Regroup'}
      </button>
    </div>
  )
}

export default BattleResult
