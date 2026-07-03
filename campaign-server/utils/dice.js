// JS port of the engine's exploding d6 (backend/engine/src/Utility.cpp
// Utility::throwDice): roll a value d6, then a SEPARATE explosion d6 — a 6 on
// the explosion die adds a whole recursive throw. The two dice are distinct
// draws, so a queued sequence [4, 6, 3, 2] means: value 4, explosion 6 →
// explode, value 3, explosion 2 → stop = 7. tests/dice.test.js pins this
// vector so the JS semantics can never drift from the C++ ones.
//
// Like Utility::pushDiceRoll, tests inject exact draws through a FIFO queue;
// every getRandom() consumes one queued value before falling back to Math.random.

let queue = []

export const pushRoll = (value) => queue.push(value)
export const clearRolls = () => { queue = [] }

export function getRandom(lowerBound, upperBound) {
  if (queue.length > 0) return queue.shift()
  return lowerBound + Math.floor(Math.random() * (upperBound - lowerBound + 1))
}

export function throwDice() {
  const result = getRandom(1, 6)
  if (getRandom(1, 6) === 6) return result + throwDice()
  return result
}

// Bernoulli helper for probability rolls (forager clash chance): one draw on
// a d1000 so queued tests can force either outcome precisely.
export const chanceRoll = (p) => getRandom(1, 1000) <= Math.round(p * 1000)
