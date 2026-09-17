import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './useAuth.js'

function formatTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

const QUICK_STATUSES = ['Chilling 🎧', 'At Work 💼', 'Busy 🔴', 'BRB ⚡']
const SPOTIFY_TOKEN_KEY = 'mxitx-spotify-token'
const SPOTIFY_VERIFIER_KEY = 'mxitx-spotify-verifier'
const SPOTIFY_SCOPE = 'user-read-currently-playing'

function readMediaSessionTrack() {
  const metadata = navigator.mediaSession?.metadata
  if (!metadata?.title) return null
  return {
    name: metadata.title,
    artist: metadata.artist || 'Unknown artist',
  }
}

function spotifyRedirectUri() {
  return import.meta.env.VITE_SPOTIFY_REDIRECT_URI || window.location.origin
}

function base64UrlEncode(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function createSpotifyVerifier() {
  const bytes = crypto.getRandomValues(new Uint8Array(64))
  return base64UrlEncode(bytes)
}

async function createSpotifyChallenge(verifier) {
  const data = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(digest)
}

function playNotificationSound(isPing = false) {
  if (typeof window === 'undefined') return

  const AudioContext = window.AudioContext || window.webkitAudioContext
  if (!AudioContext) return

  const audioContext = new AudioContext()
  const now = audioContext.currentTime
  const oscillator = audioContext.createOscillator()
  const gain = audioContext.createGain()

  oscillator.type = isPing ? 'square' : 'sine'
  oscillator.frequency.setValueAtTime(isPing ? 220 : 660, now)
  if (!isPing) oscillator.frequency.exponentialRampToValueAtTime(880, now + 0.08)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(isPing ? 0.08 : 0.045, now + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (isPing ? 0.24 : 0.13))
  oscillator.connect(gain)
  gain.connect(audioContext.destination)
  oscillator.start(now)
  oscillator.stop(now + (isPing ? 0.25 : 0.14))
  oscillator.addEventListener('ended', () => audioContext.close(), { once: true })
}

async function enrichContactRequests(requests) {
  if (!requests.length) return []
  const requesterIds = requests.map((request) => request.requester_id)
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, mx_pin')
    .in('id', requesterIds)
  const profilesById = (profiles ?? []).reduce((result, profile) => ({ ...result, [profile.id]: profile }), {})
  return requests.map((request) => ({
    ...request,
    requester: profilesById[request.requester_id] ?? {
      username: request.requester_pin,
      mx_pin: request.requester_pin,
    },
  }))
}

async function loadAcceptedContacts(userId) {
  const { data: links, error: linksError } = await supabase
    .from('contacts')
    .select('contact_id, room_id')
    .eq('user_id', userId)
  if (linksError || !links?.length) return { contacts: [], rooms: [], error: linksError }

  const contactIds = links.map((link) => link.contact_id)
  const roomIds = links.map((link) => link.room_id)
  const [{ data: profiles }, { data: rooms }] = await Promise.all([
    supabase.from('profiles').select('id, username, mx_pin, presence, status').in('id', contactIds),
    supabase.from('chat_rooms').select('id, name, category, created_at').in('id', roomIds),
  ])
  const roomsByContact = links.reduce((result, link) => ({ ...result, [link.contact_id]: link.room_id }), {})
  return {
    contacts: (profiles ?? []).map((contact) => ({ ...contact, room_id: roomsByContact[contact.id] })),
    rooms: rooms ?? [],
    error: null,
  }
}

export default function Dashboard() {
  const { user, profile, signOut } = useAuth()
  const [rooms, setRooms] = useState([])
  const [selectedRoomId, setSelectedRoomId] = useState(null)
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [loadingRooms, setLoadingRooms] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [copied, setCopied] = useState(false)
  const [statusMessage, setStatusMessage] = useState(profile?.status || 'Available')
  const [statusDraft, setStatusDraft] = useState(profile?.status || 'Available')
  const [statusEditing, setStatusEditing] = useState(false)
  const [savingStatus, setSavingStatus] = useState(false)
  const presenceChannelRef = useRef(null)
  const [contactModalOpen, setContactModalOpen] = useState(false)
  const [contactPinDraft, setContactPinDraft] = useState('')
  const [findingContact, setFindingContact] = useState(false)
  const [contactRequests, setContactRequests] = useState([])
  const [contacts, setContacts] = useState([])
  const [inviteMessage, setInviteMessage] = useState('')
  const [screenShaking, setScreenShaking] = useState(false)
  const [spotifyConnected, setSpotifyConnected] = useState(Boolean(localStorage.getItem(SPOTIFY_TOKEN_KEY)))
  const [spotifyConnecting, setSpotifyConnecting] = useState(false)
  const [mediaSessionTrack, setMediaSessionTrack] = useState(null)
  const [songQuery, setSongQuery] = useState('')
  const [songResults, setSongResults] = useState([])
  const [searchingSongs, setSearchingSongs] = useState(false)
  const [pinningSong, setPinningSong] = useState(false)
  const spotifyTokenRef = useRef(localStorage.getItem(SPOTIFY_TOKEN_KEY))
  const spotifyLastStatusRef = useRef(null)
  const shakeTimeoutRef = useRef(null)

  const selectedRoom = useMemo(
    () => rooms.find((room) => room.id === selectedRoomId) ?? null,
    [rooms, selectedRoomId],
  )
  const fallbackHandle = user?.user_metadata?.username || user?.email?.split('@')[0] || 'mx_user'
  const senderHandle = profile?.username || fallbackHandle
  const senderMxPin = profile?.mx_pin || ''
  const presence = profile?.presence || 'online'

  function roomCategoryLabel(category) {
    return category || 'general'
  }

  useEffect(() => {
    let mounted = true

    async function loadDashboard() {
      setLoadingRooms(true)
      setError('')

      const [roomsResult, requestsResult] = await Promise.all([
        supabase
        .from('chat_rooms')
        .select('id, name, category, created_at')
        .order('created_at'),
        supabase
          .from('contact_requests')
          .select('id, requester_id, requester_pin, status, created_at')
          .eq('recipient_id', user.id)
          .eq('status', 'pending')
          .order('created_at', { ascending: false }),
      ])

      if (!mounted) return

      if (roomsResult.error) {
        setError(roomsResult.error.message)
      } else {
        setRooms((roomsResult.data ?? []).filter((room) => !room.category?.startsWith('private:')))
        setLoadingMessages(true)
        setSelectedRoomId((currentRoomId) => currentRoomId ?? roomsResult.data?.find((room) => !room.category?.startsWith('private:'))?.id ?? null)
      }

      if (!requestsResult.error) setContactRequests(await enrichContactRequests(requestsResult.data ?? []))
      const acceptedContacts = await loadAcceptedContacts(user.id)
      if (!acceptedContacts.error) {
        setContacts(acceptedContacts.contacts)
        setRooms((currentRooms) => [...currentRooms, ...acceptedContacts.rooms.filter((room) => !currentRooms.some((currentRoom) => currentRoom.id === room.id))])
      }

      setLoadingRooms(false)
    }

    loadDashboard()
    return () => { mounted = false }
  }, [user.id])

  useEffect(() => {
    let mounted = true
    const channel = supabase
      .channel(`contact-requests-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contact_requests', filter: `recipient_id=eq.${user.id}` }, async (payload) => {
        if (payload.eventType === 'INSERT' && payload.new.status === 'pending') {
          const [request] = await enrichContactRequests([payload.new])
          if (mounted && request) setContactRequests((currentRequests) => (
            currentRequests.some((currentRequest) => currentRequest.id === request.id)
              ? currentRequests
              : [request, ...currentRequests]
          ))
        }
        if (payload.eventType === 'UPDATE') {
          setContactRequests((currentRequests) => currentRequests.filter((request) => request.id !== payload.new.id || payload.new.status === 'pending'))
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts', filter: `user_id=eq.${user.id}` }, async () => {
        const acceptedContacts = await loadAcceptedContacts(user.id)
        if (!mounted || acceptedContacts.error) return
        setContacts(acceptedContacts.contacts)
        setRooms((currentRooms) => [...currentRooms, ...acceptedContacts.rooms.filter((room) => !currentRooms.some((currentRoom) => currentRoom.id === room.id))])
      })
      .subscribe()

    return () => {
      mounted = false
      supabase.removeChannel(channel)
    }
  }, [user.id])

  useEffect(() => {
    if (!selectedRoomId) {
      return undefined
    }

    let mounted = true

    async function loadMessages() {
      const { data, error: messageError } = await supabase
        .from('messages')
        .select('id, room_id, sender_id, sender_handle, sender_mx_pin, text, is_ping, created_at')
        .eq('room_id', selectedRoomId)
        .order('created_at', { ascending: true })

      if (!mounted) return
      if (messageError) setError(messageError.message)
      else setMessages(data ?? [])
      setLoadingMessages(false)
    }

    loadMessages()

    const channel = supabase
      .channel(`room-${selectedRoomId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${selectedRoomId}` },
        (payload) => {
          const incomingMessage = payload.new
          if (incomingMessage.sender_id !== user.id) {
            playNotificationSound(incomingMessage.is_ping)
            if (incomingMessage.is_ping) {
              window.clearTimeout(shakeTimeoutRef.current)
              setScreenShaking(false)
              window.requestAnimationFrame(() => setScreenShaking(true))
              shakeTimeoutRef.current = window.setTimeout(() => setScreenShaking(false), 480)
            }
          }
          setMessages((currentMessages) => (
            currentMessages.some((message) => message.id === incomingMessage.id)
              ? currentMessages
              : [...currentMessages, incomingMessage]
          ))
        },
      )
      .subscribe()

    return () => {
      mounted = false
      window.clearTimeout(shakeTimeoutRef.current)
      supabase.removeChannel(channel)
    }
  }, [selectedRoomId, user.id])

  useEffect(() => {
    if (!profile?.mx_pin) return undefined

    const channel = supabase.channel('online-users', {
      config: { presence: { key: user.id } },
    })

    presenceChannelRef.current = channel

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({
          username: senderHandle,
          mx_pin: senderMxPin,
          presence: profile.presence || 'online',
          status: statusMessage,
        })
      }
    })

    return () => {
      channel.untrack()
      supabase.removeChannel(channel)
      presenceChannelRef.current = null
    }
  }, [profile, senderHandle, senderMxPin, statusMessage, user.id])

  useEffect(() => {
    let mounted = true

    async function exchangeSpotifyCode() {
      const code = new URLSearchParams(window.location.search).get('code')
      const verifier = localStorage.getItem(SPOTIFY_VERIFIER_KEY)
      const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID
      if (!code || !verifier || !clientId) return

      setSpotifyConnecting(true)
      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          grant_type: 'authorization_code',
          code,
          redirect_uri: spotifyRedirectUri(),
          code_verifier: verifier,
        }),
      })
      const token = await response.json()
      if (mounted && response.ok && token.access_token) {
        spotifyTokenRef.current = token.access_token
        localStorage.setItem(SPOTIFY_TOKEN_KEY, token.access_token)
        setSpotifyConnected(true)
        window.history.replaceState({}, document.title, window.location.pathname)
      }
      localStorage.removeItem(SPOTIFY_VERIFIER_KEY)
      if (mounted) setSpotifyConnecting(false)
    }

    exchangeSpotifyCode().catch(() => {
      localStorage.removeItem(SPOTIFY_VERIFIER_KEY)
      if (mounted) setSpotifyConnecting(false)
    })
    return () => { mounted = false }
  }, [])

  async function connectSpotify() {
    const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID
    if (!clientId) {
      setError('Add VITE_SPOTIFY_CLIENT_ID to connect Spotify.')
      return
    }

    const verifier = await createSpotifyVerifier()
    const challenge = await createSpotifyChallenge(verifier)
    localStorage.setItem(SPOTIFY_VERIFIER_KEY, verifier)
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: spotifyRedirectUri(),
      code_challenge_method: 'S256',
      code_challenge: challenge,
      scope: SPOTIFY_SCOPE,
    })
    window.location.assign(`https://accounts.spotify.com/authorize?${params}`)
  }

  async function syncMediaSessionStatus() {
    const track = readMediaSessionTrack()
    setMediaSessionTrack(track)
    await updateStatus(track ? `🎵 Now Playing: ${track.name} - ${track.artist}` : 'Available')
  }

  async function searchSongs(event) {
    event.preventDefault()
    const query = songQuery.trim()
    if (!query || searchingSongs) return

    setSearchingSongs(true)
    setError('')
    try {
      const response = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=6`)
      if (!response.ok) throw new Error('Song search is unavailable right now.')
      const result = await response.json()
      setSongResults(result.results ?? [])
    } catch (searchError) {
      setError(searchError.message)
    } finally {
      setSearchingSongs(false)
    }
  }

  async function pinSong(track) {
    if (pinningSong) return
    setPinningSong(true)
    await updateStatus(`🎵 Now Playing: ${track.trackName} - ${track.artistName}`)
    setPinningSong(false)
    setSongResults([])
    setSongQuery('')
    setStatusEditing(false)
  }

  const updateStatus = useCallback(async (nextStatus) => {
    if (spotifyLastStatusRef.current === nextStatus) return
    spotifyLastStatusRef.current = nextStatus
    setStatusMessage(nextStatus)
    setStatusDraft(nextStatus)
    const { error: statusError } = await supabase
      .from('profiles')
      .update({ status: nextStatus })
      .eq('id', user.id)
    if (statusError) setError(statusError.message)
    if (presenceChannelRef.current) {
      await presenceChannelRef.current.track({
        username: senderHandle,
        mx_pin: senderMxPin,
        presence: profile?.presence || 'online',
        status: nextStatus,
      })
    }
  }, [profile, senderHandle, senderMxPin, user.id])

  useEffect(() => {
    if (!spotifyConnected || !spotifyTokenRef.current) return undefined
    let mounted = true

    async function pollSpotify() {
      const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
        headers: { Authorization: `Bearer ${spotifyTokenRef.current}` },
      })
      if (response.status === 401) {
        localStorage.removeItem(SPOTIFY_TOKEN_KEY)
        spotifyTokenRef.current = null
        if (mounted) setSpotifyConnected(false)
        return
      }
      if (!response.ok || response.status === 204) {
        if (mounted) await updateStatus('Available')
        return
      }
      const playback = await response.json()
      const track = playback.is_playing && playback.item
      const nextStatus = track
        ? `🎵 Now Playing: ${track.name} - ${track.artists?.[0]?.name || 'Unknown artist'}`
        : 'Available'
      if (mounted) await updateStatus(nextStatus)
    }

    pollSpotify().catch(() => {})
    const interval = window.setInterval(() => { pollSpotify().catch(() => {}) }, 12000)
    return () => {
      mounted = false
      window.clearInterval(interval)
    }
  }, [spotifyConnected, updateStatus])

  useEffect(() => {
    if (!statusEditing || spotifyConnected) return undefined
    const sync = () => setMediaSessionTrack(readMediaSessionTrack())
    sync()
    const interval = window.setInterval(sync, 5000)
    return () => window.clearInterval(interval)
  }, [statusEditing, spotifyConnected])

  function handleRoomSelect(roomId) {
    setMessages([])
    setLoadingMessages(true)
    setError('')
    setSelectedRoomId(roomId)
  }

  async function sendMessage(activeRoom, messageText, isPing = false) {
    if (!activeRoom?.id || !profile?.username || !profile?.mx_pin) return

    const optimisticId = `optimistic-${crypto.randomUUID()}`
    const optimisticMessage = {
      id: optimisticId,
      room_id: activeRoom.id,
      sender_id: user.id,
      sender_handle: profile.username,
      sender_mx_pin: profile.mx_pin,
      text: messageText,
      is_ping: isPing,
      created_at: new Date().toISOString(),
    }
    setMessages((currentMessages) => [...currentMessages, optimisticMessage])
    setSending(true)
    setError('')
    const { data: savedMessage, error: sendError } = await supabase.from('messages').insert({
      room_id: activeRoom.id,
      sender_id: user.id,
      sender_handle: profile.username,
      sender_mx_pin: profile.mx_pin,
      text: messageText,
      is_ping: isPing,
    }).select('id, room_id, sender_id, sender_handle, sender_mx_pin, text, is_ping, created_at').single()

    if (sendError) {
      setMessages((currentMessages) => currentMessages.filter((message) => message.id !== optimisticId))
      setError(sendError.message)
    } else {
      setMessages((currentMessages) => {
        const withoutOptimistic = currentMessages.filter((message) => message.id !== optimisticId)
        return withoutOptimistic.some((message) => message.id === savedMessage.id)
          ? withoutOptimistic
          : [...withoutOptimistic, savedMessage]
      })
      if (!isPing) {
        setDraft('')
      }
    }
    setSending(false)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const messageText = draft.trim()
    const activeRoom = selectedRoom
    if (!messageText || !activeRoom || sending) return

    await sendMessage(activeRoom, messageText)
  }

  async function handlePing() {
    if (!selectedRoomId || sending) return

    await sendMessage(selectedRoom, 'PING!', true)
  }

  async function copyMxPin() {
    if (!profile?.mx_pin) return
    await navigator.clipboard.writeText(profile.mx_pin)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  async function saveStatus(nextStatus = statusDraft) {
    const nextMessage = nextStatus.trim()
    if (!nextMessage || savingStatus) return

    setSavingStatus(true)
    setError('')
    const { error: statusError } = await supabase
      .from('profiles')
      .update({ status: nextMessage })
      .eq('id', user.id)

    if (statusError) {
      setError(statusError.message)
    } else {
      setStatusMessage(nextMessage)
      setStatusDraft(nextMessage)
      setStatusEditing(false)
      if (presenceChannelRef.current) {
        await presenceChannelRef.current.track({
          username: senderHandle,
          mx_pin: senderMxPin,
          presence: profile?.presence || 'online',
          status: nextMessage,
        })
      }
    }
    setSavingStatus(false)
  }

  async function openContactChat(contact) {
    if (!contact.room_id) return
    handleRoomSelect(contact.room_id)
  }

  async function acceptContactRequest(request) {
    setError('')
    const { data: requester, error: requesterError } = await supabase
      .from('profiles')
      .select('id, username, mx_pin')
      .eq('id', request.requester_id)
      .single()

    if (requesterError) {
      setError(requesterError.message)
      return
    }

    const roomKey = `private:${[user.id, requester.id].sort().join(':')}`
    const roomName = `${senderHandle} / ${requester.username}`
    let { data: room, error: roomError } = await supabase
      .from('chat_rooms')
      .select('id, name, category, created_at')
      .eq('category', roomKey)
      .maybeSingle()

    if (roomError) {
      setError(roomError.message)
      return
    }
    if (!room) {
      const result = await supabase
        .from('chat_rooms')
        .insert({ name: roomName, category: roomKey })
        .select('id, name, category, created_at')
        .single()
      room = result.data
      roomError = result.error
    }
    if (roomError || !room) {
      setError(roomError?.message || 'Could not create the private room.')
      return
    }

    const { error: contactsError } = await supabase.from('contacts').upsert([
      { user_id: user.id, contact_id: requester.id, room_id: room.id },
      { user_id: requester.id, contact_id: user.id, room_id: room.id },
    ], { onConflict: 'user_id,contact_id' })
    if (contactsError) {
      setError(contactsError.message)
      return
    }

    const { error: requestError } = await supabase
      .from('contact_requests')
      .update({ status: 'accepted' })
      .eq('id', request.id)
    if (requestError) {
      setError(requestError.message)
      return
    }

    const acceptedContact = { ...requester, room_id: room.id }
    setContacts((currentContacts) => [...currentContacts.filter((contact) => contact.id !== requester.id), acceptedContact])
    setContactRequests((currentRequests) => currentRequests.filter((currentRequest) => currentRequest.id !== request.id))
    setRooms((currentRooms) => currentRooms.some((currentRoom) => currentRoom.id === room.id) ? currentRooms : [...currentRooms, room])
    handleRoomSelect(room.id)
  }

  async function declineContactRequest(request) {
    const { error: requestError } = await supabase
      .from('contact_requests')
      .update({ status: 'declined' })
      .eq('id', request.id)
    if (requestError) setError(requestError.message)
    else setContactRequests((currentRequests) => currentRequests.filter((currentRequest) => currentRequest.id !== request.id))
  }

  async function handleAddContact(event) {
    event.preventDefault()
    const mxPin = contactPinDraft.trim().toUpperCase()
    if (!mxPin || findingContact) return

    setFindingContact(true)
    setError('')
    const { data: contact, error: contactError } = await supabase
      .from('profiles')
      .select('id, username, mx_pin')
      .eq('mx_pin', mxPin)
      .maybeSingle()

    if (contactError) {
      setError(contactError.message)
    } else if (!contact) {
      setError(`No profile found for ${mxPin}.`)
    } else if (contacts.some((currentContact) => currentContact.id === contact.id)) {
      setError('This contact is already in your contacts.')
    } else {
      const { error: requestError } = await supabase.from('contact_requests').insert({
        requester_id: user.id,
        recipient_id: contact.id,
        requester_pin: senderMxPin,
        status: 'pending',
      })
      if (requestError) {
        setError(requestError.code === '23505' ? 'A contact request is already pending.' : requestError.message)
      } else {
        setInviteMessage(`Contact request sent to ${contact.username}.`)
        setContactModalOpen(false)
        setContactPinDraft('')
      }
    }
    setFindingContact(false)
  }

  return (
    <main className={`dashboard-shell ${screenShaking ? 'screen-shake' : ''}`}>
      <aside className="room-sidebar">
        <div className="sidebar-header">
          <img src="/logo.png" alt="MxitX" className="block object-contain" style={{ height: '80px', width: 'auto' }} />
          <button type="button" className="sign-out-button" onClick={signOut} aria-label="Sign out">Exit</button>
        </div>
        {contactRequests.length > 0 && (
          <section className="contact-requests-section" aria-label="Contact requests">
            <p className="sidebar-section-label">CONTACT REQUESTS <span>{contactRequests.length.toString().padStart(2, '0')}</span></p>
            {contactRequests.map((request) => (
              <div className="contact-request" key={request.id}>
                <div><strong>{request.requester?.username || request.requester_pin}</strong><small>{request.requester?.mx_pin || request.requester_pin}</small></div>
                <button type="button" onClick={() => acceptContactRequest(request)} aria-label={`Accept ${request.requester?.username || request.requester_pin}`}>✓</button>
                <button type="button" onClick={() => declineContactRequest(request)} aria-label={`Decline ${request.requester?.username || request.requester_pin}`}>×</button>
              </div>
            ))}
          </section>
        )}
        <button type="button" className="add-contact-button" onClick={() => { setError(''); setInviteMessage(''); setContactModalOpen(true) }}>
          <span>+</span> Add Contact by MX-PIN
        </button>
        <section className="contacts-section" aria-label="Contacts">
          <p className="sidebar-section-label">CONTACTS <span>{contacts.length.toString().padStart(2, '0')}</span></p>
          {contacts.length === 0 && <p className="sidebar-note">Accepted contacts appear here.</p>}
          {contacts.map((contact) => (
            <button type="button" className={`contact-room ${contact.room_id === selectedRoomId ? 'active' : ''}`} key={contact.id} onClick={() => openContactChat(contact)}>
              <span className="contact-avatar" aria-hidden="true">{contact.username.slice(0, 2).toUpperCase()}</span>
              <span><strong>{contact.username}</strong><small>{contact.mx_pin}</small></span>
              <i className={contact.presence === 'away' ? 'away' : contact.presence === 'online' ? '' : 'offline'} />
            </button>
          ))}
        </section>
        <p className="sidebar-section-label rooms-label">ROOMS <span>{rooms.filter((room) => !room.category?.startsWith('private:')).length.toString().padStart(2, '0')}</span></p>
        <nav className="room-list" aria-label="Chat rooms">
          {loadingRooms && <p className="sidebar-note">Loading rooms...</p>}
          {!loadingRooms && rooms.length === 0 && <p className="sidebar-note">No chat rooms yet.</p>}
          {rooms.filter((room) => !room.category?.startsWith('private:')).map((room) => (
            <button
              type="button"
              className={`room-item ${room.id === selectedRoomId ? 'active' : ''}`}
              key={room.id}
              onClick={() => handleRoomSelect(room.id)}
            >
              <span className="room-name">{room.name}</span>
              <span className="room-category">{roomCategoryLabel(room.category)}</span>
            </button>
          ))}
        </nav>
        <div className="profile-card">
          <span className="avatar" aria-hidden="true">{senderHandle.slice(0, 2).toUpperCase()}</span>
          <div className="profile-details">
            <strong>{senderHandle}</strong>
            <div className="pin-row"><span>{senderMxPin}</span><button type="button" className="copy-pin" onClick={copyMxPin} disabled={!profile?.mx_pin}>{copied ? 'COPIED' : 'COPY'}</button></div>
            {!statusEditing && (
              <button type="button" className="status-message" onClick={() => { setStatusDraft(statusMessage); setStatusEditing(true) }} title="Edit your status">
                {statusMessage}
              </button>
            )}
            {statusEditing && (
              <form className="status-editor" onSubmit={(event) => { event.preventDefault(); saveStatus() }}>
                <div className="status-quick-list">
                  {QUICK_STATUSES.map((quickStatus) => (
                    <button
                      type="button"
                      key={quickStatus}
                      onClick={() => saveStatus(quickStatus)}
                      disabled={savingStatus}
                    >
                      {quickStatus}
                    </button>
                  ))}
                </div>
                <button type="button" className="spotify-button" onClick={connectSpotify} disabled={spotifyConnecting}>
                  {spotifyConnecting ? 'Connecting...' : spotifyConnected ? 'Spotify Connected' : 'Connect Spotify'}
                </button>
                <button type="button" className="media-button" onClick={syncMediaSessionStatus}>
                  {mediaSessionTrack ? `Use ${mediaSessionTrack.name}` : 'Use Browser Media'}
                </button>
                <div className="song-search">
                  <form onSubmit={searchSongs}>
                    <input
                      type="search"
                      value={songQuery}
                      onChange={(event) => setSongQuery(event.target.value)}
                      placeholder="Search a song to pin..."
                      aria-label="Search a song to pin"
                    />
                    <button type="submit" disabled={searchingSongs}>{searchingSongs ? '...' : 'SEARCH'}</button>
                  </form>
                  {songResults.length > 0 && (
                    <div className="song-results">
                      {songResults.map((track) => (
                        <button type="button" key={track.trackId} onClick={() => pinSong(track)} disabled={pinningSong}>
                          <strong>{track.trackName}</strong>
                          <small>{track.artistName}</small>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <input
                  type="text"
                  value={statusDraft}
                  onChange={(event) => setStatusDraft(event.target.value)}
                  maxLength="80"
                  autoFocus
                  aria-label="Custom status"
                />
                <button type="submit" disabled={savingStatus}>OK</button>
              </form>
            )}
          </div>
          <span className={`presence-badge profile-presence ${presence === 'away' ? 'away' : ''}`}><i />{presence}</span>
        </div>
      </aside>

      {contactModalOpen && (
        <div className="contact-modal-backdrop" role="presentation" onMouseDown={() => setContactModalOpen(false)}>
          <section className="contact-modal" role="dialog" aria-modal="true" aria-labelledby="contact-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setContactModalOpen(false)} aria-label="Close">×</button>
            <p className="eyebrow">Direct message</p>
            <h2 id="contact-modal-title">Add a contact</h2>
            <p className="modal-copy">Enter their MX-PIN to send a contact request.</p>
            {inviteMessage && <p className="modal-success" role="status">{inviteMessage}</p>}
            <form onSubmit={handleAddContact}>
              <label htmlFor="contact-mx-pin">MX-PIN</label>
              <input id="contact-mx-pin" value={contactPinDraft} onChange={(event) => setContactPinDraft(event.target.value)} placeholder="MX-NA8L7" autoFocus required />
              {error && <p className="modal-error" role="alert">{error}</p>}
              <button type="submit" disabled={findingContact}>{findingContact ? 'Searching...' : 'Open private chat'}</button>
            </form>
          </section>
        </div>
      )}

      <section className="chat-panel" aria-label="Active chat">
        <header className="chat-header">
          <div>
            <p className="eyebrow">Live room</p>
            <h1>{selectedRoom?.name || 'Choose a room'}</h1>
          </div>
          {selectedRoom && <span className="live-indicator"><i /> realtime</span>}
        </header>

        <div className="message-list" aria-live="polite">
          {loadingMessages && <p className="empty-chat">Loading messages...</p>}
          {!loadingMessages && selectedRoom && messages.length === 0 && <p className="empty-chat">The room is quiet. Start the conversation.</p>}
          {!loadingMessages && !selectedRoom && <p className="empty-chat">Select a room to start chatting.</p>}
          {messages.map((message) => (
            <article className={`message ${message.sender_id === user.id ? 'own-message' : ''} ${message.is_ping ? 'ping-message' : ''}`} key={message.id}>
              <div className="message-meta"><strong>{message.sender_handle}</strong><span>{message.sender_mx_pin}</span><time>{formatTime(message.created_at)}</time></div>
              <p>{message.text}</p>
            </article>
          ))}
        </div>

        <div className="composer-wrap">
          {error && <p className="dashboard-error" role="alert">{error}</p>}
          <form className="message-composer" onSubmit={handleSubmit}>
            <input type="text" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={selectedRoom ? 'Say something...' : 'Choose a room first'} disabled={!selectedRoom || sending} aria-label="Message" />
            <button type="submit" disabled={!selectedRoom || !draft.trim() || sending} aria-label="Send message">Send</button>
            <button type="button" className="ping-button" onClick={handlePing} disabled={!selectedRoom || sending} aria-label="Send a ping">PING!</button>
          </form>
        </div>
      </section>
    </main>
  )
}
