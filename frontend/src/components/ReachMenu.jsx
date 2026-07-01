import { useState } from 'react'

const ReachMenu = ({ hex, placements, roster, units, hexTerrain, hexCapacity, onPlace, onClose }) => {
  const stackCounts = Object.fromEntries(placements.map(p => [p.type, p.count]))

  const [counts, setCounts] = useState(() =>
    Object.fromEntries(units.map(u => [u.type, stackCounts[u.type] ?? 0]))
  )

  const isForbidden = (unit) => unit.forbiddenTerrain?.includes(hexTerrain)

  const sizeUsedByOthers = (type) =>
    units.reduce((sum, u) => {
      if (u.type === type) return sum
      return sum + (counts[u.type] ?? 0) * (u.placementSize ?? 1)
    }, 0)

  const maxCount = (unit) => {
    if (isForbidden(unit)) return 0
    const cap = Math.floor((hexCapacity - sizeUsedByOthers(unit.type)) / (unit.placementSize ?? 1))
    return Math.min(roster[unit.type] ?? 0, Math.max(0, cap))
  }

  const totalSizeUsed = units.reduce(
    (sum, u) => sum + (counts[u.type] ?? 0) * (u.placementSize ?? 1), 0
  )

  const handleChange = (unit, rawVal) => {
    if (isForbidden(unit)) return
    const val = Math.min(Math.max(0, parseInt(rawVal) || 0), maxCount(unit))
    setCounts(c => ({ ...c, [unit.type]: val }))
  }

  const commit = () => {
    units.forEach(u => {
      onPlace(hex.col, hex.row, u.type, isForbidden(u) ? 0 : (counts[u.type] ?? 0))
    })
    onClose()
  }

  return (
    <div className="reach-menu">
      <div className="reach-menu-header">
        <span>({hex.col},{hex.row}) {hexTerrain}</span>
        <button className="reach-close" onClick={onClose}>×</button>
      </div>
      <div className="reach-capacity">
        {totalSizeUsed} / {hexCapacity}
      </div>
      {units.map(u => {
        const forbidden = isForbidden(u)
        return (
          <div key={u.type} className={`reach-row${forbidden ? ' reach-row-forbidden' : ''}`}>
            <span className="reach-symbol">{u.symbol}</span>
            <span className="reach-type">{u.type}</span>
            <span className="reach-avail">/{roster[u.type] ?? 0}</span>
            <input
              type="number"
              min={0}
              max={maxCount(u)}
              value={forbidden ? 0 : (counts[u.type] ?? 0)}
              onChange={e => handleChange(u, e.target.value)}
              className="reach-input"
              disabled={forbidden}
            />
          </div>
        )
      })}
      <button className="reach-commit" onClick={commit}>Place</button>
    </div>
  )
}

export default ReachMenu
