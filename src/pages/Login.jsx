import { useState } from 'react'
import { useAuth } from '../useAuth.js'

export default function Login({ onShowSignup }) {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      await signIn(email, password)
    } catch (authError) {
      setError(authError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="auth-shell">
      <div className="auth-intro">
        <img src="/logo.png" alt="MxitX" className="auth-logo" />
        <p className="eyebrow">Private social chat / 01</p>
        <h1>Find your people in the noise.</h1>
        <p className="intro-copy">A quieter place to talk, play, and stay in the loop with the people who matter.</p>
        <div className="signal-line" aria-hidden="true"><span /> <span /> <span /> <span /> <span /></div>
      </div>
      <div className="auth-panel">
        <div className="brand-mark">MX</div>
        <p className="panel-kicker">Welcome back</p>
        <h2>Sign in to MxitX</h2>
        <p className="secure-note"><span /> encrypted room access</p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="login-email">Email</label>
          <input id="login-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
          <label htmlFor="login-password">Password</label>
          <input id="login-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" disabled={submitting}>{submitting ? 'Signing in...' : 'Sign in'}</button>
        </form>
        <p className="switch-auth">New here? <button type="button" className="text-button" onClick={onShowSignup}>Create an account</button></p>
      </div>
    </section>
  )
}
