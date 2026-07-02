import { useState, useEffect, useRef, useCallback } from 'react'
import { getTicks } from '../services/api'

// Ticks are fetched from the campaign server in chunks of this many and
// cached for the lifetime of the hook, so scrubbing backward is instant.
export const CHUNK_SIZE = 50

// Playback state for one stored battle replay.
//   current — tick index being viewed
//   tick    — that tick's data ({ index, units, log }) or null while loading
//   seek/next/prev — scrubbing (clamped to [0, tickCount-1])
//   playing/setPlaying — auto-advance at PLAY_MS per tick
const PLAY_MS = 250

const useReplay = (battleId, tickCount) => {
  const [ticksByIndex, setTicksByIndex] = useState({})
  const [current, setCurrent] = useState(0)
  const [playing, setPlaying] = useState(false)
  const inFlight = useRef(new Set())

  const lastTick = Math.max(0, tickCount - 1)

  const ensureChunk = useCallback(
    (index) => {
      const start = Math.floor(index / CHUNK_SIZE) * CHUNK_SIZE
      if (start > lastTick || inFlight.current.has(start)) return
      inFlight.current.add(start)
      getTicks(battleId, start, start + CHUNK_SIZE - 1)
        .then((chunk) => {
          setTicksByIndex((prev) => {
            const next = { ...prev }
            chunk.forEach((t) => {
              next[t.index] = t
            })
            return next
          })
        })
        .catch(() => {
          inFlight.current.delete(start) // allow a retry on the next seek
        })
    },
    [battleId, lastTick],
  )

  useEffect(() => {
    ensureChunk(0)
  }, [ensureChunk])

  const seek = useCallback(
    (i) => {
      const clamped = Math.min(lastTick, Math.max(0, i))
      setCurrent(clamped)
      ensureChunk(clamped)
      // Prefetch the next chunk when close to its boundary so playback
      // doesn't stall at chunk edges.
      if (clamped % CHUNK_SIZE >= CHUNK_SIZE - 5) ensureChunk(clamped + CHUNK_SIZE)
    },
    [ensureChunk, lastTick],
  )

  const next = useCallback(() => seek(current + 1), [seek, current])
  const prev = useCallback(() => seek(current - 1), [seek, current])

  useEffect(() => {
    if (!playing) return undefined
    const id = setInterval(() => {
      setCurrent((c) => {
        if (c >= lastTick) {
          setPlaying(false)
          return c
        }
        const n = c + 1
        ensureChunk(n)
        if (n % CHUNK_SIZE >= CHUNK_SIZE - 5) ensureChunk(n + CHUNK_SIZE)
        return n
      })
    }, PLAY_MS)
    return () => clearInterval(id)
  }, [playing, lastTick, ensureChunk])

  return {
    current,
    tick: ticksByIndex[current] ?? null,
    seek,
    next,
    prev,
    playing,
    setPlaying,
  }
}

export default useReplay
