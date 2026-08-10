import mongoose from 'mongoose'

// Mirror of the C++ unit catalog (./game dump-units). The C++ engine is the
// single source of truth — this schema only enforces shape/type on import so
// a malformed or drifted export fails loudly at sync time instead of
// producing silently-broken campaign data.
const statsSchema = new mongoose.Schema(
  {
    maxHP: { type: Number, required: true, min: 1 },
    attack: { type: Number, required: true },
    defence: { type: Number, required: true },
    armour: { type: Number, required: true },
    speed: { type: Number, required: true, min: 0 },
    // Ranged competence on the melee-attack scale (10 = trained archer);
    // campaign scouting/foraging values are derived from speed + this.
    ballisticSkill: { type: Number, required: true, min: 0 },
    preferredRange: { type: Number, required: true, min: 0 },
    // Signed scouting adjustment (LightCavalry +, Warhorse −, most types 0);
    // feeds fieldPointValue in utils/capabilities.js.
    reconTag: { type: Number, required: true },
  },
  { _id: false },
)

const unitTypeSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  symbol: { type: String, required: true, minlength: 1, maxlength: 1 },
  size: { type: Number, required: true, min: 1 },
  category: {
    type: String,
    required: true,
    enum: ['Foot', 'Mounted', 'Flyer', 'Beast', 'Skirmisher'],
  },
  forbiddenTerrain: { type: [String], default: [] },
  // How this type may legitimately enter play (engine UnitRole, see
  // backend/engine/include/UnitCatalog.hpp). Composable and descriptive: a
  // type carries every channel that applies, so Scorpion is ['Enemy','Mount']
  // and Soldier is ['Player','Enemy'] (the enemy host fields Soldiers too).
  //
  // Replaced the old placeable/spawnable booleans, which said this twice:
  //   placeable → roles includes 'Player'
  //   spawnable → roles includes 'Player' or 'Enemy'
  // `validate` rather than `required`, because [] passes a required array
  // check — and a type reachable through no channel at all is exactly the
  // drift this field exists to catch.
  roles: {
    type: [String],
    required: true,
    enum: ['Player', 'Enemy', 'Summon', 'Mount'],
    validate: {
      validator: (v) => Array.isArray(v) && v.length > 0,
      message: 'unit type must carry at least one role',
    },
  },
  stats: { type: statsSchema, required: true },
})

unitTypeSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret._id
    delete ret.__v
    return ret
  },
})

export default mongoose.model('UnitType', unitTypeSchema)
