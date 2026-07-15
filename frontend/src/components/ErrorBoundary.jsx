import React, { Component } from 'react'

// Last-resort net around the whole app: a render crash anywhere below shows a
// readable screen instead of going blank (the zombie-server incident crashed
// App on campaign.augury of a foreign-shaped campaign and left only a console
// stack). Deliberately dependency-free — no api calls, no hooks, nothing that
// can throw again inside the fallback. Class component because error
// boundaries have no hook equivalent.
class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // The console keeps the full picture for bug reports; the screen shows
    // only the message.
    console.error('ErrorBoundary caught:', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="error-screen">
        <h2>Something broke</h2>
        <p>
          The screen crashed instead of rendering. Reloading usually recovers;
          if it does not, the browser console has the details — please file a
          bug report from the login bar with what you did last.
        </p>
        <pre className="error-detail">{String(this.state.error?.message ?? this.state.error)}</pre>
        <button onClick={() => window.location.reload()}>Reload</button>
      </div>
    )
  }
}

export default ErrorBoundary
