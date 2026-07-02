import UnitType from '../models/unitType.js'

// Import a `./game dump-units` export into the DB: upsert by name, delete
// types the engine no longer knows. Runs at server boot, which is what makes
// the C++ constructors the single source of truth: edit a stat → make →
// restart server → DB (and everything reading it) is current.
//
// Validation is strict and the whole sync throws on the first bad entry —
// a drifted export should stop the boot, not half-import.
export async function syncCatalog(catalog) {
  if (!catalog || !Array.isArray(catalog.units))
    throw new Error('catalog sync: expected { units: [...] }')

  for (const unit of catalog.units) {
    // Validate through the model before touching the collection so a bad
    // entry throws a ValidationError rather than upserting garbage.
    await new UnitType(unit).validate()
    await UnitType.findOneAndUpdate({ name: unit.name }, unit, {
      upsert: true,
      runValidators: true,
    })
  }

  const names = catalog.units.map((u) => u.name)
  await UnitType.deleteMany({ name: { $nin: names } })
  return names.length
}
