const CampaignHUD = ({ day, food, augury, roster }) => {
  const totalUnits = Object.values(roster).reduce((a, b) => a + b, 0)
  const dailyCost = Math.ceil(totalUnits / 10)

  return (
    <header className="hud">
      <span className="hud-day">Day {day}</span>
      <span className="hud-food">Food: {food} (-{dailyCost}/day)</span>
      <span className="hud-augury">Augury: {augury}%</span>
      <span className="hud-roster">
        {Object.entries(roster)
          .filter(([, n]) => n > 0)
          .map(([type, n]) => `${n} ${type}`)
          .join('  ·  ')}
      </span>
    </header>
  )
}

export default CampaignHUD
