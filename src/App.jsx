import { useState } from 'react'
import { useAuth } from './useAuth.js'
import './App.css'
import Dashboard from './Dashboard.jsx'
import Login from './pages/Login.jsx'
import Signup from './pages/Signup.jsx'

function App() {
  const { user, loading } = useAuth()
  const [showSignup, setShowSignup] = useState(false)

  if (loading) {
    return <main className="loading-screen">Connecting to MxitX...</main>
  }

  if (!user) {
    return showSignup
      ? <Signup onShowLogin={() => setShowSignup(false)} />
      : <Login onShowSignup={() => setShowSignup(true)} />
  }

  return <Dashboard />
}

export default App
