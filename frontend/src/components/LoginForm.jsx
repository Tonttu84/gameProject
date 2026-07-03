import React, { useState } from 'react'
import { login, register } from '../services/api'

// Login / register form shown in the HUD strip while logged out. Register
// mode creates the account and then logs in with the same credentials, so
// both paths end in onLogin({ token, username, name }).
const LoginForm = ({ onLogin }) => {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('login') // 'login' | 'register'
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    try {
      if (mode === 'register') await register({ username, password })
      const user = await login({ username, password })
      setUsername('')
      setPassword('')
      onLogin(user)
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not reach game server')
    }
  }

  return (
    <form className="login-form" onSubmit={handleSubmit}>
      <input
        placeholder="username"
        value={username}
        onChange={e => setUsername(e.target.value)}
        data-testid="login-username"
      />
      <input
        type="password"
        placeholder="password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        data-testid="login-password"
      />
      <button className="btn-primary" type="submit" data-testid="login-submit">
        {mode === 'login' ? 'Log in' : 'Register'}
      </button>
      <button
        type="button"
        className="login-toggle"
        data-testid="login-toggle"
        onClick={() => { setMode(m => (m === 'login' ? 'register' : 'login')); setError(null) }}
      >
        {mode === 'login' ? 'New commander? Register' : 'Have an account? Log in'}
      </button>
      {error && <span className="login-error">{error}</span>}
    </form>
  )
}

export default LoginForm
