const EventCards = ({ events, onPick }) => (
  <div className="event-phase">
    <h2>The Augur Speaks</h2>
    <p className="event-hint">One vision is true. The others are shadows.</p>
    <div className="event-cards">
      {events.map((ev) => (
        <button
          key={ev.id}
          className="event-card"
          onClick={() => onPick(ev)}
        >
          <div className="event-prob">{ev.probability}%</div>
          <div className="event-title">{ev.title}</div>
          <div className="event-desc">{ev.description}</div>
          <div className="event-effect">{effectLabel(ev.effect)}</div>
        </button>
      ))}
    </div>
  </div>
)

const effectLabel = (effect) => {
  switch (effect.type) {
    case 'food':
      return effect.delta > 0 ? `+${effect.delta} food` : `${effect.delta} food`
    case 'roster':
      return effect.delta !== undefined
        ? `${effect.delta > 0 ? '+' : ''}${effect.delta} ${effect.unit}`
        : `${effect.unit} -${Math.round((1 - effect.factor) * 100)}%`
    case 'all_roster':
      return `All units -${Math.round((1 - effect.factor) * 100)}%`
    case 'augury':
      return `${effect.delta > 0 ? '+' : ''}${effect.delta} augury`
    case 'enemy_advance':
      return 'Enemy gains ground'
    default:
      return ''
  }
}

export default EventCards
