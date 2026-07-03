// Food/materials mass display: the campaign server computes everything in kg,
// the player reads tonnes (that's how anyone talks about army-scale food).
// One decimal, trailing .0 dropped: 50000 → "50 t", 12432 → "12.4 t".
export const tons = (kg) => `${+((kg ?? 0) / 1000).toFixed(1)} t`
