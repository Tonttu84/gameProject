import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import mongoose from 'mongoose'
import UnitType from '../models/unitType.js'
import Battle from '../models/battle.js'
import Tick from '../models/tick.js'
import { startTestDb, stopTestDb, clearDb } from './helpers/db.js'
import { catalogFixture } from './fixtures/catalog.js'

beforeAll(startTestDb)
afterAll(stopTestDb)
beforeEach(clearDb)

const validUnit = () => structuredClone(catalogFixture.units[0])

describe('UnitType schema enforcement', () => {
  test('accepts a valid catalog entry', async () => {
    const doc = await UnitType.create(validUnit())
    expect(doc.name).toBe('Soldier')
    expect(doc.stats.maxHP).toBe(10)
  })

  test('rejects a missing required field (size)', async () => {
    const u = validUnit()
    delete u.size
    await expect(UnitType.create(u)).rejects.toThrow(mongoose.Error.ValidationError)
  })

  test('rejects a missing stats block', async () => {
    const u = validUnit()
    delete u.stats
    await expect(UnitType.create(u)).rejects.toThrow(mongoose.Error.ValidationError)
  })

  test('rejects an unknown category', async () => {
    const u = validUnit()
    u.category = 'Submarine'
    await expect(UnitType.create(u)).rejects.toThrow(mongoose.Error.ValidationError)
  })

  test('rejects a non-numeric stat', async () => {
    const u = validUnit()
    u.stats.maxHP = 'lots'
    await expect(UnitType.create(u)).rejects.toThrow(mongoose.Error.ValidationError)
  })
})

describe('Battle schema enforcement', () => {
  test('accepts a valid battle and defaults user to null', async () => {
    const b = await Battle.create({
      map: 'sample_battle',
      winner: 'blue',
      blueSurvivors: { Soldier: 2 },
      redSurvivors: {},
      tickCount: 3,
    })
    expect(b.user).toBeNull()
    expect(b.blueSurvivors.get('Soldier')).toBe(2)
  })

  test('rejects an invalid winner', async () => {
    await expect(
      Battle.create({ map: 'm', winner: 'green', tickCount: 0 }),
    ).rejects.toThrow(mongoose.Error.ValidationError)
  })
})

describe('Tick schema enforcement', () => {
  test('rejects a unit state missing position', async () => {
    await expect(
      Tick.create({
        battle: new mongoose.Types.ObjectId(),
        index: 0,
        units: [{ id: 1, type: 'Soldier', team: 'blue', hp: 10 }],
      }),
    ).rejects.toThrow(mongoose.Error.ValidationError)
  })

  test('rejects duplicate (battle, index) pairs', async () => {
    await Tick.init() // ensure the unique compound index exists
    const battle = new mongoose.Types.ObjectId()
    const unit = { id: 1, type: 'Soldier', team: 'blue', q: 1, r: 1, hp: 10 }
    await Tick.create({ battle, index: 0, units: [unit] })
    await expect(Tick.create({ battle, index: 0, units: [unit] })).rejects.toThrow()
  })
})
