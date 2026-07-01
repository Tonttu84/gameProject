import { useState } from 'react'

const ReachMenu = ({ hex, placements, roster, units, onPlace, onClose }) => {
  const stackCounts = Object.fromEntries(
    placements.map(p => [p.type, p.count])
  )

  const [counts, setCounts] = useState(() =>
    Object.fromEntries(units.map(u => [u.type, stackCounts[u.type] ?? 0]))
  )

  const commit = () => {
    units.forEach(u => {
      onPlace(hex.col, hex.row, u.type, counts[u.type] ?? 0)
    })
    onClose()
  }

  return (
    <div className="reach-menu">
      <div className="reach-menu-header">
        <span>Hex ({hex.col}, {hex.row})</span>
        <button className="reach-close" onClick={onClose}>×</button>
      </div>
      {units.map(u => (
        <div key={u.type} className="reach-row">
          <span className="reach-symbol">{u.symbol}</span>
          <span className="reach-type">{u.type}</span>
          <span className="reach-avail">/{roster[u.type] ?? 0}</span>
          <input
            type="number"
            min={0}
            max={roster[u.type] ?? 0}
            value={counts[u.type] ?? 0}
            onChange={e => setCounts(c => ({
              ...c,
              [u.type]: Math.min(
                Math.max(0, parseInt(e.target.value) || 0),
                roster[u.type] ?? 0
              )
            }))}
            className="reach-input"
          />
        </div>
      ))}
      <button className="reach-commit" onClick={commit}>Place</button>
    </div>
  )
}

export default ReachMenu
