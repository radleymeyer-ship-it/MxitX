import { useState } from 'react'
import { useAuth } from '../useAuth.js'

export default function Signup({ onShowLogin }) {
  const { signUp } = useAuth()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setMessage('')
    setSubmitting(true)

    try {
      const result = await signUp(email, password, username.trim())
      setMessage(result.needsEmailConfirmation
        ? 'Check your email to confirm your account, then sign in.'
        : 'Your account is ready.')
    } catch (authError) {
      setError(authError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="auth-shell">
      <div className="auth-intro signup-intro">
        <img src="/logo.png" alt="MxitX" className="auth-logo" />
        <p className="eyebrow">Make your mark / 02</p>
        <h1>Your corner of the conversation.</h1>
        <p className="intro-copy">Choose a handle, get your MX PIN, and step into a chat room that feels like yours.</p>
        <div className="pin-preview"><span>YOUR MX PIN</span><strong>MX-•••••</strong></div>
      </div>
      <div className="auth-panel">
        <div className="brand-mark">MX</div>
        <p className="panel-kicker">Start here</p>
        <h2>Create your account</h2>
        <p className="secure-note"><span /> your identity, your rooms</p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="signup-username">Username</label>
          <input id="signup-username" type="text" value={username} onChange={(event) => setUsername(event.target.value)} required minLength="2" maxLength="30" autoComplete="nickname" />
          <label htmlFor="signup-email">Email</label>
          <input id="signup-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
          <label htmlFor="signup-password">Password</label>
          <input id="signup-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength="6" autoComplete="new-password" />
          {error && <p className="form-error" role="alert">{error}</p>}
          {message && <p className="form-success" role="status">{message}</p>}
          <button type="submit" disabled={submitting}>{submitting ? 'Creating account...' : 'Create account'}</button>
        </form>
        <p className="switch-auth">Already have an account? <button type="button" className="text-button" onClick={onShowLogin}>Sign in</button></p>
      </div>
    </section>
  )
}
