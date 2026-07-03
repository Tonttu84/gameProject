import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import User from '../models/user.js'
import config from '../utils/config.js'

const router = Router()

router.post('/', async (req, res) => {
  const { username, password } = req.body ?? {}

  const user = await User.findOne({ username })
  const passwordCorrect = user === null
    ? false
    : await bcrypt.compare(password ?? '', user.passwordHash)

  // Same message for unknown user and wrong password — don't leak which.
  if (!passwordCorrect)
    return res.status(401).json({ error: 'invalid username or password' })

  const token = jwt.sign(
    { username: user.username, id: user._id.toString() },
    config.SECRET,
    { expiresIn: '1h' },
  )

  res.json({ token, username: user.username, name: user.name })
})

export default router
