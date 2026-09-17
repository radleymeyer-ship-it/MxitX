import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { AuthContext } from './authContext.js'

const PIN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const MAX_PIN_ATTEMPTS = 8

function createMxPin() {
  const suffix = Array.from({ length: 5 }, () => {
    const index = Math.floor(Math.random() * PIN_ALPHABET.length)
    return PIN_ALPHABET[index]
  }).join('')

  return `MX-${suffix}`
}

async function createProfile(user, username) {
  for (let attempt = 0; attempt < MAX_PIN_ATTEMPTS; attempt += 1) {
    const mxPin = createMxPin()
    const { error } = await supabase.from('profiles').insert({
      id: user.id,
      username,
      mx_pin: mxPin,
      status: 'Available',
      presence: 'online',
    })

    if (!error) return mxPin
    if (error.code === '23505') {
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id, username, mx_pin, status, presence, now_playing')
        .eq('id', user.id)
        .maybeSingle()
      if (existingProfile) return existingProfile
      continue
    }
    throw error
  }

  throw new Error('Could not create a unique MX PIN. Please try again.')
}

async function ensureProfile(user) {
  const { data: existingProfile, error: profileError } = await supabase
    .from('profiles')
    .select('id, username, mx_pin, status, presence, now_playing')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) throw profileError
  if (existingProfile) return existingProfile

  const username = user.user_metadata?.username || user.email?.split('@')[0] || 'mx_user'
  const createdProfile = await createProfile(user, username)
  if (typeof createdProfile === 'object') return createdProfile

  return {
    id: user.id,
    username,
    mx_pin: createdProfile,
    status: 'Available',
    presence: 'online',
    now_playing: null,
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    async function hydrateSession(currentSession) {
      if (!currentSession?.user) {
        if (mounted) {
          setSession(null)
          setProfile(null)
          setLoading(false)
        }
        return
      }

      try {
        const currentProfile = await ensureProfile(currentSession.user)
        if (mounted) {
          setSession(currentSession)
          setProfile(currentProfile)
        }
      } catch (profileError) {
        if (mounted) console.error('Unable to load MxitX profile:', profileError)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      hydrateSession(currentSession)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        hydrateSession(nextSession)
      },
    )

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  async function signUp(email, password, username) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username } },
    })

    if (error) throw error
    if (!data.user) throw new Error('Signup did not return a user.')

    if (data.session) {
      const currentProfile = await ensureProfile(data.user)
      setProfile(currentProfile)
    }

    return { needsEmailConfirmation: !data.session }
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, profile, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

