import React from 'react'

// Short what-to-do intro shown at the top of a screen, for first-time demo
// players. Gated on the global tutorial flag (toggled in the HUD); rendering
// nothing when disabled keeps veterans' screens clean.
const TutorialIntro = ({ id, title, lines, enabled }) => {
  if (!enabled) return null
  return (
    <aside className="tutorial-intro" data-testid={`tutorial-${id}`}>
      <strong>{title}</strong>
      <ul>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </aside>
  )
}

export default TutorialIntro
