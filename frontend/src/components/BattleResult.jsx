import React from 'react'
const BattleResult = ({ result, onNextDay }) => {
  const { winner, blue_survivors, red_survivors } = result

  const totalBlue = Object.values(blue_survivors).reduce((a, b) => a + b, 0)
  const totalRed  = Object.values(red_survivors).reduce((a, b) => a + b, 0)

  return (
    <div className="result-screen">
      <h2 className={`result-title result-${winner}`}>
        {winner === 'blue' ? 'Victory' : winner === 'red' ? 'Defeat' : 'Draw'}
      </h2>
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
      <button className="result-next" onClick={onNextDay}>
        {winner === 'blue' ? 'Press On' : 'Retreat & Regroup'}
      </button>
    </div>
  )
}

export default BattleResult
