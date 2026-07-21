// Food/materials mass display: the campaign server computes everything in kg,
// the player reads tonnes (that's how anyone talks about army-scale food).
// Below one tonne the display switches to kg ("600 kg") so a real, non-zero
// amount never rounds down to "0 t"; above it, one decimal with trailing .0
// dropped: 50000 → "50 t", 12432 → "12.4 t".
//
// A missing value is a bug upstream (the view didn't send it) and must LOOK
// broken — coercing it to 0 once hid a missing-foodNeedPerTurn wiring hole.
export const tons = (kg) => {
  if (typeof kg !== 'number' || !Number.isFinite(kg)) return '?? t'
  const rounded = Math.round(kg)
  if (Math.abs(rounded) < 1000) return `${rounded} kg`
  return `${+(kg / 1000).toFixed(1)} t`
}

// A recon numeric estimate ({low, high} from services/recon.js displayBracket)
// as the player reads it: one number once the bracket has collapsed to exact
// (top recon level or a free reveal, low === high), else an en-dashed range.
// Callers handle the null case (recon level 0 — no estimate is shown at all).
export const estimate = ({ low, high }) => (low === high ? `${low}` : `${low}–${high}`)
