import { Router } from 'express'
import bcrypt from 'bcryptjs'
import User from '../models/user.js'

const router = Router()

// Register. Username rules (required, unique, minlength 3) live on the
// schema; the password rule is checked here because only the hash is stored.
router.post('/', async (req, res) => {
  const { username, name, password } = req.body ?? {}

  if (!password || password.length < 3)
    return res.status(400).json({ error: 'password must be at least 3 characters long' })

  const passwordHash = await bcrypt.hash(password, 10)
  const user = await User.create({ username, name, passwordHash })

  res.status(201).json(user)
})

export default router
