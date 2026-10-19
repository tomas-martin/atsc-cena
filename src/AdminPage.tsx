import { useEffect, useState, useRef, useMemo } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import QRCode from 'qrcode'
import {
  LockKeyhole, LogOut, RefreshCw,
  Camera, CheckCircle2, XCircle, AlertTriangle, Users,
  Ticket, ArrowLeft, Search, Check, Send,
  UserPlus, Minus, Plus,
  Gift, Trophy, Sparkles, Dices, RotateCcw, Volume2, VolumeX,
  Copy, Trash2, Award, ChevronDown, ChevronUp
} from 'lucide-react'
import { supabase } from './lib/supabase'
import { sendTicketsEmail } from './lib/email'
import {
  type OrderConfirmation,
  type IssuedTicket,
  type AttendeeRole,
  type Category,
  type AttendeeDetail,
  CATEGORIES
} from './types'
import ClubLogo from './ClubLogo'
import './admin.css'

interface OrderRow {
  id: string
  buyer_full_name: string
  buyer_dni: string
  buyer_email: string
  buyer_phone: string
  quantity: number
  total_ars: number
  payment_method: string
  status: string
  transfer_reference?: string
  created_at: string
}

interface TicketRow {
  id: string
  order_id: string
  attendee_name: string
  qr_token: string
  status: string // 'valid' | 'used' | 'cancelled'
  checked_in_at?: string
  created_at: string
  ticket_number?: number | null
}

interface ScanResult {
  status: 'valid' | 'used' | 'invalid'
  message: string
  attendeeName?: string
  ticketNumber?: string
  checkedInAt?: string
  buyerName?: string
}

export interface RaffleParticipant {
  ticket: TicketRow
  ticketNumber: string
  order?: OrderRow
  isCheckedIn: boolean
}

export interface WinnerRecord {
  id: string
  timestamp: number
  prizeName: string
  participant: RaffleParticipant
}

export default function AdminPage({
  onBack,
  logoUrl
}: {
  onBack?: () => void
  logoUrl?: string | null
}) {
  const clubLogo = logoUrl || (import.meta.env.VITE_CLUB_LOGO_URL as string) || null
  // Autenticación exclusiva por Email y Contraseña (Supabase Auth)
  const [signedIn, setSignedIn] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [loading, setLoading] = useState(false)

  // Tabs del panel: 'scanner' | 'presencial' | 'tickets' | 'orders' | 'sorteo'
  const [activeTab, setActiveTab] = useState<'scanner' | 'presencial' | 'tickets' | 'orders' | 'sorteo'>('scanner')
  const [unitPrice, setUnitPrice] = useState<number>(25000)

  // Datos
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [tickets, setTickets] = useState<TicketRow[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [approvingOrderId, setApprovingOrderId] = useState<string | null>(null)
  const [actionFeedback, setActionFeedback] = useState<{ message: string; success: boolean } | null>(null)

  // ── Formulario de Venta Presencial en Puerta ──
  const [presencialBuyer, setPresencialBuyer] = useState({
    fullName: '',
    dni: '',
    email: '',
    phone: '',
  })
  const [presencialQty, setPresencialQty] = useState(1)
  const [presencialAttendees, setPresencialAttendees] = useState<AttendeeDetail[]>([
    { name: '', role: 'jugador', category: 'Primera' }
  ])
  const [presencialPaymentMethod, setPresencialPaymentMethod] = useState<'efectivo' | 'transferencia' | 'otro'>('efectivo')
  const [presencialCheckInImmediate, setPresencialCheckInImmediate] = useState(false)
  const [presencialSubmitting, setPresencialSubmitting] = useState(false)
  const [presencialError, setPresencialError] = useState('')
  const [presencialSuccessData, setPresencialSuccessData] = useState<{
    orderId: string
    buyer: { fullName: string; dni: string; email: string; phone: string }
    totalArs: number
    quantity: number
    paymentMethod: string
    checkedInImmediate: boolean
    tickets: IssuedTicket[]
    qrDataUrls: Record<string, string>
    emailMessage?: string
    emailSuccess?: boolean
  } | null>(null)

  // Sincronizar asistentes presenciales con la cantidad seleccionada
  useEffect(() => {
    setPresencialAttendees(prev => {
      return Array.from({ length: presencialQty }, (_, idx) => {
        if (prev[idx]) return prev[idx]
        return {
          name: idx === 0 ? presencialBuyer.fullName : '',
          role: idx === 0 ? 'jugador' : 'acompanante',
          category: prev[0]?.category || 'Primera'
        }
      })
    })
  }, [presencialQty])

  const updatePresencialAttendee = (index: number, updates: Partial<AttendeeDetail>) => {
    setPresencialAttendees(prev => {
      const list = [...prev]
      list[index] = { ...list[index], ...updates }
      return list
    })
  }

  // Cálculos de venta presencial
  const presencialPlayerCount = useMemo(() => {
    return presencialAttendees.filter(a => a.role === 'jugador').length
  }, [presencialAttendees])

  const presencialCompanionCount = useMemo(() => {
    return presencialAttendees.filter(a => a.role === 'acompanante').length
  }, [presencialAttendees])

  const presencialTotal = useMemo(() => {
    return presencialCompanionCount * unitPrice
  }, [presencialCompanionCount, unitPrice])

  // Escáner QR
  const [scannerActive, setScannerActive] = useState(false)
  const [scannerStarting, setScannerStarting] = useState(false)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [scanCooldown, setScanCooldown] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([])
  const [selectedCamera, setSelectedCamera] = useState<string>('')
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null)
  const isProcessingRef = useRef(false)
  const lastScannedTokenRef = useRef<string | null>(null)
  const lastScannedTimeRef = useRef<number>(0)
  const cooldownTimerRef = useRef<any>(null)

  // Función para determinar si una entrada es de jugador (no cuenta para el sorteo)
  function isPlayerTicket(ticket: { attendee_name?: string; ticket_number?: number | null }): boolean {
    return ticket.ticket_number == null || /jugador/i.test(ticket.attendee_name || '')
  }

  // Mapeo correlativo estable para sorteo (ÚNICAMENTE para acompañantes)
  const ticketNumberMap = useMemo(() => {
    const companionTickets = tickets.filter(t => !isPlayerTicket(t))
    const sorted = [...companionTickets].sort((a, b) => {
      if (a.ticket_number && b.ticket_number) {
        return a.ticket_number - b.ticket_number
      }
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    })

    const map = new Map<string, string>()
    sorted.forEach((t, index) => {
      const num = t.ticket_number ? t.ticket_number : (index + 1)
      map.set(t.id, String(num).padStart(3, '0'))
    })
    return map
  }, [tickets])

  function getTicketDisplayNumber(ticket: { id: string; attendee_name?: string; ticket_number?: number | null }, fallbackIndex?: number): string | null {
    if (isPlayerTicket(ticket)) {
      return null
    }
    if (ticket.ticket_number) {
      return String(ticket.ticket_number).padStart(3, '0')
    }
    const mapped = ticketNumberMap.get(ticket.id)
    if (mapped) return mapped
    if (fallbackIndex !== undefined) {
      return String(fallbackIndex + 1).padStart(3, '0')
    }
    return null
  }

  // ═════════════════════════════════════════════════════════════════
  // ESTADO Y LÓGICA DEL SORTEO DE ENTRADAS AL AZAR
  // ═════════════════════════════════════════════════════════════════
  const [raffleFilter, setRaffleFilter] = useState<'checked_in_only' | 'all'>('checked_in_only')
  const [excludePreviousWinners, setExcludePreviousWinners] = useState(true)
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [prizeInput, setPrizeInput] = useState('')
  const [isRolling, setIsRolling] = useState(false)
  const [rollingNumber, setRollingNumber] = useState('???')
  const [rollingAttendee, setRollingAttendee] = useState('')
  const [currentWinner, setCurrentWinner] = useState<RaffleParticipant | null>(null)
  const [copiedRecordId, setCopiedRecordId] = useState<string | null>(null)
  const [showTransparency, setShowTransparency] = useState(false)
  const [transparencySearch, setTransparencySearch] = useState('')
  const [winnersHistory, setWinnersHistory] = useState<WinnerRecord[]>(() => {
    try {
      const saved = localStorage.getItem('atsc_raffle_winners_v1')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })

  // Sincronizar historial con localStorage
  useEffect(() => {
    try {
      localStorage.setItem('atsc_raffle_winners_v1', JSON.stringify(winnersHistory))
    } catch {}
  }, [winnersHistory])

  // Participantes elegibles para sorteo (solo acompañantes con número de sorteo)
  const raffleParticipants = useMemo<RaffleParticipant[]>(() => {
    const companionTickets = tickets.filter(t => !isPlayerTicket(t) && t.status !== 'cancelled')
    return companionTickets.map(ticket => {
      const ticketNumber = getTicketDisplayNumber(ticket) || '---'
      const order = orders.find(o => o.id === ticket.order_id)
      const isCheckedIn = ticket.status === 'used' || !!ticket.checked_in_at
      return {
        ticket,
        ticketNumber,
        order,
        isCheckedIn
      }
    })
  }, [tickets, orders, ticketNumberMap])

  const eligibleParticipants = useMemo(() => {
    return raffleParticipants.filter(p => {
      if (raffleFilter === 'checked_in_only' && !p.isCheckedIn) return false
      if (excludePreviousWinners && winnersHistory.some(w => w.participant.ticket.id === p.ticket.id)) return false
      return true
    })
  }, [raffleParticipants, raffleFilter, excludePreviousWinners, winnersHistory])

  // Audio Web API para efectos de sonido
  function playTickSound() {
    if (!soundEnabled) return
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      if (!AudioCtx) return
      const ctx = new AudioCtx()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(750 + Math.random() * 250, ctx.currentTime)
      gain.gain.setValueAtTime(0.08, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.05)
    } catch {}
  }

  function playFanfareSound() {
    if (!soundEnabled) return
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      if (!AudioCtx) return
      const ctx = new AudioCtx()
      const now = ctx.currentTime
      const notes = [523.25, 659.25, 783.99, 1046.50]
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(freq, now + idx * 0.1)
        gain.gain.setValueAtTime(0, now + idx * 0.1)
        gain.gain.linearRampToValueAtTime(0.18, now + idx * 0.1 + 0.04)
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.8)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(now + idx * 0.1)
        osc.stop(now + idx * 0.1 + 0.85)
      })
    } catch {}
  }

  // Animación de confeti en canvas
  const confettiCanvasRef = useRef<HTMLCanvasElement | null>(null)
  function triggerConfetti() {
    const canvas = confettiCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    const particles: Array<{
      x: number
      y: number
      vx: number
      vy: number
      size: number
      color: string
      rotation: number
      vRot: number
    }> = []

    const colors = ['#d92736', '#fbbf24', '#ffffff', '#10b981', '#3b82f6']
    for (let i = 0; i < 90; i++) {
      particles.push({
        x: canvas.width * 0.5 + (Math.random() * 240 - 120),
        y: canvas.height * 0.35,
        vx: (Math.random() - 0.5) * 16,
        vy: (Math.random() - 0.9) * 16,
        size: Math.random() * 8 + 5,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        vRot: (Math.random() - 0.5) * 10,
      })
    }

    const startTime = Date.now()
    function render() {
      if (!ctx || !canvas) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const elapsed = Date.now() - startTime

      particles.forEach(p => {
        p.x += p.vx
        p.y += p.vy
        p.vy += 0.35
        p.rotation += p.vRot

        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate((p.rotation * Math.PI) / 180)
        ctx.fillStyle = p.color
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6)
        ctx.restore()
      })

      if (elapsed < 3500) {
        requestAnimationFrame(render)
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
      }
    }

    render()
  }

  // Ejecución del Sorteo al Azar
  function startDraw() {
    if (isRolling || eligibleParticipants.length === 0) return

    setIsRolling(true)
    setCurrentWinner(null)

    // Selección aleatoria
    const chosenIndex = Math.floor(Math.random() * eligibleParticipants.length)
    const winnerCandidate = eligibleParticipants[chosenIndex]

    let currentStep = 0
    const totalSteps = 28
    let intervalTime = 40

    function step() {
      const randIndex = Math.floor(Math.random() * eligibleParticipants.length)
      const p = eligibleParticipants[randIndex]
      setRollingNumber(p.ticketNumber)
      setRollingAttendee(p.ticket.attendee_name)
      playTickSound()

      currentStep++
      if (currentStep < totalSteps) {
        if (currentStep > totalSteps * 0.6) {
          intervalTime += 18
        } else if (currentStep > totalSteps * 0.35) {
          intervalTime += 6
        }
        setTimeout(step, intervalTime)
      } else {
        setRollingNumber(winnerCandidate.ticketNumber)
        setRollingAttendee(winnerCandidate.ticket.attendee_name)
        setCurrentWinner(winnerCandidate)
        setIsRolling(false)
        playFanfareSound()
        triggerConfetti()

        const defaultPrize = prizeInput.trim() || `Premio #${winnersHistory.length + 1}`
        const newRecord: WinnerRecord = {
          id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
          timestamp: Date.now(),
          prizeName: defaultPrize,
          participant: winnerCandidate
        }

        setWinnersHistory(prev => [newRecord, ...prev])
        setPrizeInput('')
      }
    }

    setTimeout(step, intervalTime)
  }

  // Verificar sesión activa de Supabase Auth al montar
  useEffect(() => {
    if (!supabase) return

    // Obtener sesión actual
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setSignedIn(true)
        setUserEmail(session.user.email || null)
      }
    })

    // Escuchar cambios de autenticación (login / logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session?.user)
      setUserEmail(session?.user?.email || null)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  // Cargar datos cuando está autenticado
  useEffect(() => {
    if (signedIn) {
      void loadAllData()
    }
  }, [signedIn])

  // Obtener cámaras disponibles
  useEffect(() => {
    if (signedIn && activeTab === 'scanner') {
      Html5Qrcode.getCameras()
        .then(devices => {
          if (devices && devices.length) {
            setCameras(devices)
            // Priorizar cámara trasera para celulares
            const backCam = devices.find(d => /back|rear|trasera|posterior/i.test(d.label))
            setSelectedCamera(backCam ? backCam.id : devices[0].id)
          }
        })
        .catch(err => {
          console.warn('Error al listar cámaras:', err)
        })
    }
  }, [signedIn, activeTab])

  // Detener escáner al cambiar de tab o desmontar
  useEffect(() => {
    return () => {
      stopScanner()
    }
  }, [activeTab])

  async function loadAllData() {
    setLoading(true)
    setAuthError('')

    // Cargar orders
    if (supabase) {
      try {
        const { data: ordersData, error: ordersErr } = await supabase
          .from('orders')
          .select('*')
          .order('created_at', { ascending: false })

        if (!ordersErr && ordersData) {
          setOrders(ordersData as OrderRow[])
        }

        const { data: ticketsData, error: ticketsErr } = await supabase
          .from('tickets')
          .select('*')
          .order('created_at', { ascending: false })

        if (!ticketsErr && ticketsData) {
          setTickets(ticketsData as TicketRow[])
        }

        const { data: configData } = await supabase
          .from('event_config')
          .select('ticket_price_ars')
          .single()

        if (configData?.ticket_price_ars) {
          setUnitPrice(Number(configData.ticket_price_ars))
        }
      } catch (e) {
        console.warn('Error al cargar datos de Supabase:', e)
      }
    }
    setLoading(false)
  }

  // Login exclusivo con Supabase Auth (Email y Contraseña)
  async function handleAuthLogin(e: React.FormEvent) {
    e.preventDefault()
    setAuthError('')
    if (!supabase) {
      setAuthError('Supabase no está conectado. Verificá las variables de entorno.')
      return
    }
    setLoading(true)
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    setLoading(false)

    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        setAuthError('Correo o contraseña incorrectos. Verificá haber creado el usuario en Supabase.')
      } else if (error.message.includes('Email not confirmed')) {
        setAuthError('El correo aún no fue confirmado en Supabase (tildá "Auto Confirm User" al crearlo).')
      } else {
        setAuthError(error.message)
      }
    } else if (data.session?.user) {
      setSignedIn(true)
      setUserEmail(data.session.user.email || null)
    }
  }

  async function handleSignOut() {
    stopScanner()
    if (supabase) {
      await supabase.auth.signOut()
    }
    setSignedIn(false)
    setUserEmail(null)
    setOrders([])
    setTickets([])
  }

  // ═════════════════════════════════════════════════════════════════
  // LÓGICA DEL ESCÁNER QR
  // ═════════════════════════════════════════════════════════════════
  async function startScanner() {
    if (scannerActive || scannerStarting) return
    setScannerStarting(true)
    setScanResult(null)
    setAuthError('')

    try {
      // Detener previo si existiera
      if (html5QrCodeRef.current) {
        try {
          if (html5QrCodeRef.current.isScanning) {
            await html5QrCodeRef.current.stop()
          }
          await html5QrCodeRef.current.clear()
        } catch {}
      }

      const qrScanner = new Html5Qrcode('qr-reader-viewport')
      html5QrCodeRef.current = qrScanner

      const cameraId = selectedCamera || { facingMode: 'environment' }

      await qrScanner.start(
        cameraId,
        {
          fps: 15,
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight)
            const qrboxSize = Math.max(200, Math.floor(minEdge * 0.72))
            return { width: qrboxSize, height: qrboxSize }
          },
          aspectRatio: 1.0,
        },
        async (decodedText) => {
          const raw = decodedText.trim()
          const now = Date.now()

          // 1. Si ya se está procesando una consulta en vuelo, ignorar frames
          if (isProcessingRef.current) return

          // 2. Si es exactamente el MISMO código escaneado hace menos de 5 segundos, ignorar por completo
          //    (evita que al sostener el celular frente a la cámara se re-escanee y marque "ya utilizada")
          if (lastScannedTokenRef.current === raw && (now - lastScannedTimeRef.current < 5000)) {
            return
          }

          // 3. Pausa mínima de 1.8 segundos entre lecturas de cualquier entrada para dar tiempo
          if (lastScannedTimeRef.current > 0 && (now - lastScannedTimeRef.current < 1800)) {
            return
          }

          await processQrCode(raw)
        },
        () => {
          // Error por frame no detectado (normal, ignorar)
        }
      )

      setScannerActive(true)
    } catch (err) {
      console.error('Error al iniciar cámara:', err)
      setAuthError('No se pudo acceder a la cámara. Verificá los permisos del navegador.')
      setScannerActive(false)
    } finally {
      setScannerStarting(false)
    }
  }

  async function stopScanner() {
    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current)
    }
    setScanCooldown(false)
    isProcessingRef.current = false

    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop()
        }
        await html5QrCodeRef.current.clear()
      } catch (e) {
        console.warn('Error al detener escáner:', e)
      } finally {
        html5QrCodeRef.current = null
        setScannerActive(false)
      }
    }
  }

  // Procesar y validar el código QR detectado
  async function processQrCode(rawText: string) {
    if (isProcessingRef.current) return
    isProcessingRef.current = true
    setScanCooldown(true)

    // Guardar timestamp y token del escaneo actual para evitar duplicados inmediatos
    lastScannedTokenRef.current = rawText.trim()
    lastScannedTimeRef.current = Date.now()

    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current)
    }

    try {
      let token = rawText.trim()
      let attendeeFromQr = ''
      let ticketNumFromQr = ''

      // Si el QR contiene un JSON estructurado
      try {
        const parsed = JSON.parse(rawText)
        if (parsed.token) token = parsed.token
        if (parsed.attendee) attendeeFromQr = parsed.attendee
        if (parsed.ticket) ticketNumFromQr = parsed.ticket
      } catch {
        // Es un token plano
      }

      // Buscar en la base de datos Supabase
      let matchedTicket: TicketRow | null = null

      if (supabase) {
        try {
          const { data, error } = await supabase
            .from('tickets')
            .select('*')
            .eq('qr_token', token)
            .maybeSingle()

          if (!error && data) {
            matchedTicket = data as TicketRow
          }
        } catch (err) {
          console.warn('Error al buscar ticket en DB:', err)
        }
      }

      // Si no está en Supabase, buscar en la lista local de tickets cargados
      if (!matchedTicket) {
        matchedTicket = tickets.find(t => t.qr_token === token || t.id === token) || null
      }

      // Si no se encontró el ticket
      if (!matchedTicket) {
        setScanResult({
          status: 'invalid',
          message: 'Código no reconocido o no pertenece a este evento.',
          attendeeName: attendeeFromQr || 'Desconocido',
          ticketNumber: ticketNumFromQr || undefined,
        })
        playBeep(false)
        return
      }

      const isPlayer = isPlayerTicket(matchedTicket)
      const displayTicketNum = isPlayer
        ? 'JUGADOR (Sin sorteo)'
        : (getTicketDisplayNumber(matchedTicket) ? `N° ${getTicketDisplayNumber(matchedTicket)}` : undefined)

      // Si ya fue utilizado
      if (matchedTicket.status === 'used') {
        const hora = matchedTicket.checked_in_at
          ? new Date(matchedTicket.checked_in_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
          : 'Previamente'

        setScanResult({
          status: 'used',
          message: `¡ATENCIÓN! Esta entrada ya ingresó al evento a las ${hora} hs.`,
          attendeeName: matchedTicket.attendee_name,
          ticketNumber: displayTicketNum,
          checkedInAt: hora,
        })
        playBeep(false)
        return
      }

      // ¡ENTRADA VÁLIDA! Realizar el check-in
      const checkInTime = new Date().toISOString()

      if (supabase) {
        try {
          await supabase
            .from('tickets')
            .update({ status: 'used', checked_in_at: checkInTime })
            .eq('id', matchedTicket.id)
        } catch (err) {
          console.warn('Error al actualizar check-in en DB:', err)
        }
      }

      // Actualizar estado local
      setTickets(prev =>
        prev.map(t => (t.id === matchedTicket!.id ? { ...t, status: 'used', checked_in_at: checkInTime } : t))
      )

      setScanResult({
        status: 'valid',
        message: '¡ACCESO PERMITIDO! Entrada verificada con éxito.',
        attendeeName: matchedTicket.attendee_name,
        ticketNumber: displayTicketNum,
      })
      playBeep(true)
    } finally {
      isProcessingRef.current = false
      // Quitar estado de cooldown visual tras 2.2 segundos
      cooldownTimerRef.current = setTimeout(() => {
        setScanCooldown(false)
      }, 2200)
    }
  }

  // Sonido de confirmación con Web Audio API (no requiere archivos externos)
  function playBeep(success: boolean) {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.connect(gain)
      gain.connect(audioCtx.destination)

      if (success) {
        osc.frequency.setValueAtTime(800, audioCtx.currentTime)
        osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.15)
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25)
        osc.start(audioCtx.currentTime)
        osc.stop(audioCtx.currentTime + 0.25)
      } else {
        osc.frequency.setValueAtTime(300, audioCtx.currentTime)
        osc.frequency.setValueAtTime(200, audioCtx.currentTime + 0.15)
        gain.gain.setValueAtTime(0.4, audioCtx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35)
        osc.start(audioCtx.currentTime)
        osc.stop(audioCtx.currentTime + 0.35)
      }
    } catch {
      // Audio no soportado o bloqueado
    }
  }

  // Check-in manual por búsqueda
  async function handleManualCheckIn(ticket: TicketRow) {
    const checkInTime = new Date().toISOString()
    if (supabase) {
      await supabase
        .from('tickets')
        .update({ status: 'used', checked_in_at: checkInTime })
        .eq('id', ticket.id)
    }
    setTickets(prev =>
      prev.map(t => (t.id === ticket.id ? { ...t, status: 'used', checked_in_at: checkInTime } : t))
    )
  }

  // Revertir check-in
  async function handleRevertCheckIn(ticket: TicketRow) {
    if (supabase) {
      await supabase
        .from('tickets')
        .update({ status: 'valid', checked_in_at: null })
        .eq('id', ticket.id)
    }
    setTickets(prev =>
      prev.map(t => (t.id === ticket.id ? { ...t, status: 'valid', checked_in_at: undefined } : t))
    )
  }

  // Confirmar pago y enviar entradas con códigos QR por Resend
  async function handleConfirmAndSendQr(order: OrderRow) {
    setApprovingOrderId(order.id)
    setActionFeedback(null)

    try {
      // 1. Obtener los tickets asociados a este pedido o generarlos si faltan
      let orderTickets: TicketRow[] = []
      if (supabase) {
        const { data: existing } = await supabase
          .from('tickets')
          .select('*')
          .eq('order_id', order.id)
        if (existing && existing.length > 0) {
          orderTickets = existing as TicketRow[]
        }
      }

      // Si no estaban creados los tickets para este pedido, generarlos ahora
      if (orderTickets.length === 0) {
        const newTicketRows = Array.from({ length: order.quantity }, (_, i) => ({
          order_id: order.id,
          attendee_name: i === 0 ? order.buyer_full_name : `${order.buyer_full_name} (Acompañante ${i + 1})`,
          qr_token: crypto.randomUUID ? crypto.randomUUID() : `atsc-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 6)}`,
          status: 'valid'
        }))

        if (supabase) {
          const { data: inserted } = await supabase
            .from('tickets')
            .insert(newTicketRows)
            .select('*')
          if (inserted) {
            orderTickets = inserted as TicketRow[]
          }
        } else {
          orderTickets = newTicketRows.map((t, idx) => ({ ...t, id: `tick_${idx}`, created_at: new Date().toISOString() }))
        }
      }

      // 2. Mapear a IssuedTicket y generar códigos QR con QRCode
      const issuedTickets: IssuedTicket[] = orderTickets.map((t, i) => {
        const isPl = isPlayerTicket(t)
        const displayNum = isPl ? 'JUGADOR' : (getTicketDisplayNumber(t, i) || '001')
        return {
          ticketNumber: displayNum,
          attendeeName: t.attendee_name,
          qrToken: t.qr_token,
          orderId: order.id,
          eventName: 'Cena de Fin de Año 2026 - Andes Talleres',
          date: 'Sábado 19 de Diciembre de 2026 · 21:30 hs',
          venue: 'Microestadio Andes Talleres Sport Club · Godoy Cruz, Mendoza',
          isPlayer: isPl,
        }
      })

      const generatedQrs: Record<string, string> = {}
      for (const t of issuedTickets) {
        const qrContent = JSON.stringify({
          app: 'ATSC-CENA-2026',
          ticket: t.isPlayer ? 'JUGADOR' : `N° ${t.ticketNumber}`,
          attendee: t.attendeeName,
          token: t.qrToken,
          order: t.orderId
        })
        const dataUrl = await QRCode.toDataURL(qrContent, {
          width: 320,
          margin: 2,
          color: {
            dark: '#070e1a',
            light: '#ffffff',
          },
        })
        generatedQrs[t.qrToken] = dataUrl
      }

      // 3. Enviar email a través de Nodemailer SMTP (si falla el correo, no rompe la compra)
      const conf: OrderConfirmation = {
        orderId: order.id,
        buyer: {
          fullName: order.buyer_full_name,
          dni: order.buyer_dni,
          email: order.buyer_email,
          phone: order.buyer_phone,
        },
        quantity: order.quantity,
        totalArs: order.total_ars,
        paymentMethod: 'transferencia',
        tickets: issuedTickets,
        emailSent: false,
      }

      let emailResult = { success: false, message: '' }
      try {
        emailResult = await sendTicketsEmail(conf, generatedQrs)
      } catch (emailErr: any) {
        // Loguear error sin credenciales
        const safeError = emailErr?.message || 'Error de comunicación con el servicio de correo'
        console.error('[SMTP Approval Error]:', safeError)
        emailResult = { success: false, message: safeError }
      }

      // 4. Actualizar pedido a 'pagado' en Supabase independientemente del resultado del mail
      if (supabase) {
        await supabase
          .from('orders')
          .update({ status: 'pagado', paid_at: new Date().toISOString() })
          .eq('id', order.id)
      }

      // 5. Actualizar estados locales
      setOrders(prev =>
        prev.map(o => (o.id === order.id ? { ...o, status: 'pagado' } : o))
      )
      setTickets(prev => {
        const otherTickets = prev.filter(t => t.order_id !== order.id)
        return [...otherTickets, ...orderTickets]
      })

      if (emailResult.success) {
        setActionFeedback({
          message: `¡Pago confirmado con éxito! Se despachó el email con ${issuedTickets.length} código(s) QR a ${order.buyer_email}.`,
          success: true,
        })
      } else {
        setActionFeedback({
          message: `¡Pago confirmado en el sistema! Nota sobre el correo: ${emailResult.message || 'No se pudo despachar el email. Verificá las credenciales SMTP en Vercel.'}`,
          success: true,
        })
      }

    } catch (err) {
      console.error('Error al confirmar pedido:', err)
      setActionFeedback({
        message: err instanceof Error ? err.message : 'Error al procesar la confirmación.',
        success: false,
      })
    } finally {
      setApprovingOrderId(null)
    }
  }

  // Reenviar email con entradas QR para un pedido ya pagado
  async function handleResendQrEmail(order: OrderRow) {
    setApprovingOrderId(order.id)
    setActionFeedback(null)

    try {
      let orderTickets: TicketRow[] = []
      if (supabase) {
        const { data: existing } = await supabase
          .from('tickets')
          .select('*')
          .eq('order_id', order.id)
        if (existing && existing.length > 0) {
          orderTickets = existing as TicketRow[]
        }
      }

      if (orderTickets.length === 0) {
        throw new Error('No se encontraron entradas en la base de datos para este pedido.')
      }

      const issuedTickets: IssuedTicket[] = orderTickets.map((t, i) => {
        const isPl = isPlayerTicket(t)
        const displayNum = isPl ? 'JUGADOR' : (getTicketDisplayNumber(t, i) || '001')
        return {
          ticketNumber: displayNum,
          attendeeName: t.attendee_name,
          qrToken: t.qr_token,
          orderId: order.id,
          eventName: 'Cena de Fin de Año 2026 - Andes Talleres',
          date: 'Sábado 19 de Diciembre de 2026 · 21:30 hs',
          venue: 'Microestadio Andes Talleres Sport Club · Godoy Cruz, Mendoza',
          isPlayer: isPl,
        }
      })

      const generatedQrs: Record<string, string> = {}
      for (const t of issuedTickets) {
        const qrContent = JSON.stringify({
          app: 'ATSC-CENA-2026',
          ticket: t.isPlayer ? 'JUGADOR' : `N° ${t.ticketNumber}`,
          attendee: t.attendeeName,
          token: t.qrToken,
          order: t.orderId,
        })
        const dataUrl = await QRCode.toDataURL(qrContent, {
          width: 320,
          margin: 2,
          color: {
            dark: '#070e1a',
            light: '#ffffff',
          },
        })
        generatedQrs[t.qrToken] = dataUrl
      }

      const conf: OrderConfirmation = {
        orderId: order.id,
        buyer: {
          fullName: order.buyer_full_name,
          dni: order.buyer_dni,
          email: order.buyer_email,
          phone: order.buyer_phone,
        },
        quantity: order.quantity,
        totalArs: order.total_ars,
        paymentMethod: 'transferencia',
        tickets: issuedTickets,
        emailSent: false,
      }

      const emailResult = await sendTicketsEmail(conf, generatedQrs)

      if (emailResult.success) {
        setActionFeedback({
          message: `¡Email reenviado exitosamente con ${issuedTickets.length} código(s) QR a ${order.buyer_email}!`,
          success: true,
        })
      } else {
        setActionFeedback({
          message: `Nota sobre el correo: ${emailResult.message}`,
          success: false,
        })
      }
    } catch (err: any) {
      console.error('Error al reenviar entradas:', err)
      setActionFeedback({
        message: err instanceof Error ? err.message : 'Error al reenviar el correo.',
        success: false,
      })
    } finally {
      setApprovingOrderId(null)
    }
  }

  // ── Realizar venta presencial de entradas en puerta ──
  async function handleRegisterPresencialSale(e: React.FormEvent) {
    e.preventDefault()
    setPresencialError('')

    if (!presencialBuyer.fullName.trim() || !presencialBuyer.dni.trim() || !presencialBuyer.email.trim()) {
      setPresencialError('Por favor completá los campos obligatorios del comprador (Nombre, DNI y Correo).')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(presencialBuyer.email)) {
      setPresencialError('Por favor ingresá un correo electrónico válido para despachar los códigos QR.')
      return
    }

    // Validar nombres y categorías de cada asistente
    for (let i = 0; i < presencialQty; i++) {
      const att = presencialAttendees[i]
      const effName = att?.name?.trim() || (i === 0 ? presencialBuyer.fullName.trim() : '')
      if (!effName) {
        setPresencialError(`Por favor completá el nombre del asistente para la Entrada #${i + 1}.`)
        return
      }
      if (!att?.category) {
        setPresencialError(`Por favor seleccioná la categoría para la Entrada #${i + 1}.`)
        return
      }
    }

    setPresencialSubmitting(true)

    try {
      let savedOrderId = ''

      // 1. Guardar orden en Supabase como PAGADO
      if (supabase) {
        const { data: orderData, error: orderErr } = await supabase.from('orders').insert({
          buyer_full_name: presencialBuyer.fullName.trim(),
          buyer_dni: presencialBuyer.dni.trim(),
          buyer_email: presencialBuyer.email.trim(),
          buyer_phone: presencialBuyer.phone.trim() || 'Presencial',
          quantity: presencialQty,
          unit_price_ars: presencialQty > 0 ? Math.round(presencialTotal / presencialQty) : 0,
          total_ars: presencialTotal,
          payment_method: 'transferencia',
          status: 'pagado',
          transfer_reference: `Venta Presencial (${presencialPaymentMethod === 'efectivo' ? 'Efectivo en Puerta' : 'Transferencia en Puerta'})`,
          paid_at: new Date().toISOString(),
        }).select('id').single()

        if (orderErr) {
          console.error('Error al insertar orden presencial:', orderErr)
          throw new Error(`Error en la base de datos (${orderErr.code}): ${orderErr.message}`)
        }

        if (orderData?.id) {
          savedOrderId = orderData.id
        }
      }

      const displayOrderId = savedOrderId
        ? `ATSC-${savedOrderId.slice(0, 6).toUpperCase()}`
        : `ATSC-${Math.floor(100000 + Math.random() * 900000)}`

      // 2. Determinar número correlativo de sorteo (ÚNICAMENTE para acompañantes)
      let nextTicketNumber = 1
      if (supabase) {
        try {
          const { data: highestTicket } = await supabase
            .from('tickets')
            .select('ticket_number')
            .not('ticket_number', 'is', null)
            .order('ticket_number', { ascending: false })
            .limit(1)

          if (highestTicket && highestTicket.length > 0 && typeof highestTicket[0].ticket_number === 'number') {
            nextTicketNumber = highestTicket[0].ticket_number + 1
          } else {
            const { count } = await supabase.from('tickets').select('*', { count: 'exact', head: true })
            if (typeof count === 'number' && !isNaN(count)) {
              nextTicketNumber = count + 1
            }
          }
        } catch { }
      }

      // 3. Generar tickets presenciales
      let companionRaffleCount = 0
      const checkInTimestamp = presencialCheckInImmediate ? new Date().toISOString() : null

      const issuedTickets: IssuedTicket[] = Array.from({ length: presencialQty }, (_, i) => {
        const att = presencialAttendees[i] || {
          name: i === 0 ? presencialBuyer.fullName : `Asistente ${i + 1}`,
          role: (i === 0 ? 'jugador' : 'acompanante') as AttendeeRole,
          category: 'Primera' as Category,
        }

        const isPlayer = att.role === 'jugador'
        let formattedNum = 'JUGADOR'
        if (!isPlayer) {
          const currentNum = nextTicketNumber + companionRaffleCount
          formattedNum = String(currentNum).padStart(3, '0')
          companionRaffleCount++
        }

        const rawName = (att.name && att.name.trim())
          ? att.name.trim()
          : (i === 0 ? presencialBuyer.fullName.trim() : `Asistente ${i + 1}`)

        const formattedAttendeeName = `${rawName} (${isPlayer ? 'Jugador' : 'Acompañante'} · ${att.category})`
        const uuidToken = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : `atsc-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 6)}`

        return {
          ticketNumber: formattedNum,
          attendeeName: formattedAttendeeName,
          qrToken: uuidToken,
          orderId: displayOrderId,
          eventName: 'Cena de Fin de Año 2026 - Andes Talleres',
          date: 'Sábado 19 de Diciembre de 2026 · 21:30 hs',
          venue: 'Microestadio Andes Talleres Sport Club · Godoy Cruz, Mendoza',
          isPlayer,
          role: att.role,
          category: att.category,
        }
      })

      // 4. Guardar tickets en Supabase
      if (supabase && savedOrderId) {
        const ticketRows = issuedTickets.map((t) => ({
          order_id: savedOrderId,
          attendee_name: t.attendeeName,
          qr_token: t.qrToken,
          status: presencialCheckInImmediate ? 'used' : 'valid',
          checked_in_at: checkInTimestamp,
          ticket_number: t.isPlayer ? null : parseInt(t.ticketNumber, 10),
        }))
        const { error: ticketErr } = await supabase.from('tickets').insert(ticketRows)
        if (ticketErr) {
          const fallbackRows = ticketRows.map(({ ticket_number, ...rest }) => rest)
          await supabase.from('tickets').insert(fallbackRows)
        }
      }

      // 5. Generar códigos QR con QRCode
      const generatedQrs: Record<string, string> = {}
      for (const t of issuedTickets) {
        const qrContent = JSON.stringify({
          app: 'ATSC-CENA-2026',
          ticket: t.isPlayer ? 'JUGADOR' : `N° ${t.ticketNumber}`,
          attendee: t.attendeeName,
          token: t.qrToken,
          order: t.orderId
        })
        const dataUrl = await QRCode.toDataURL(qrContent, {
          width: 320,
          margin: 2,
          color: {
            dark: '#070e1a',
            light: '#ffffff',
          },
        })
        generatedQrs[t.qrToken] = dataUrl
      }

      // 6. Despachar email inmediatamente con Nodemailer SMTP
      const conf: OrderConfirmation = {
        orderId: displayOrderId,
        buyer: {
          fullName: presencialBuyer.fullName,
          dni: presencialBuyer.dni,
          email: presencialBuyer.email,
          phone: presencialBuyer.phone,
        },
        quantity: presencialQty,
        totalArs: presencialTotal,
        paymentMethod: 'transferencia',
        tickets: issuedTickets,
        emailSent: false,
      }

      let emailResult = { success: false, message: '' }
      try {
        emailResult = await sendTicketsEmail(conf, generatedQrs)
      } catch (err: any) {
        console.error('Error al despachar correo en venta presencial:', err)
        emailResult = { success: false, message: err?.message || 'Error de envío' }
      }

      // 7. Actualizar listas del panel
      void loadAllData()

      // 8. Mostrar pantalla de éxito con los QR generados
      setPresencialSuccessData({
        orderId: displayOrderId,
        buyer: { ...presencialBuyer },
        totalArs: presencialTotal,
        quantity: presencialQty,
        paymentMethod: presencialPaymentMethod,
        checkedInImmediate: presencialCheckInImmediate,
        tickets: issuedTickets,
        qrDataUrls: generatedQrs,
        emailMessage: emailResult.message,
        emailSuccess: emailResult.success,
      })

    } catch (err: any) {
      console.error('Error en venta presencial:', err)
      setPresencialError(err?.message || 'Ocurrió un error al procesar la venta presencial.')
    } finally {
      setPresencialSubmitting(false)
    }
  }

  // Reset para nueva venta presencial
  function handleResetPresencialForm() {
    setPresencialSuccessData(null)
    setPresencialBuyer({ fullName: '', dni: '', email: '', phone: '' })
    setPresencialQty(1)
    setPresencialAttendees([{ name: '', role: 'jugador', category: 'Primera' }])
    setPresencialPaymentMethod('efectivo')
    setPresencialCheckInImmediate(false)
    setPresencialError('')
  }

  const money = (n: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

  // ═════════════════════════════════════════════════════════════════
  // PANTALLA DE LOGIN AL PANEL
  // ═════════════════════════════════════════════════════════════════
  if (!signedIn) {
    return (
      <main className="admin-wrap">
        <div className="admin-login">
          <div className="admin-header-logo">
            <ClubLogo url={clubLogo} size="md" />
            <div>
              <p className="admin-kicker">CONTROL DE ACCESO & ADMINISTRACIÓN</p>
              <h1>Panel de Control ATSC</h1>
            </div>
          </div>

          <form onSubmit={handleAuthLogin} className="login-form">
            <label>
              Correo Electrónico de Administrador
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                placeholder="tu-correo@gmail.com"
              />
            </label>

            <label>
              Contraseña
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder="••••••••"
              />
            </label>

            {authError && <p className="admin-error">{authError}</p>}

            <button className="admin-primary" disabled={loading} type="submit">
              {loading ? (
                <>
                  <RefreshCw size={16} className="spinner" /> Verificando...
                </>
              ) : (
                <>
                  <LockKeyhole size={16} /> Iniciar Sesión como Administrador
                </>
              )}
            </button>
          </form>

          {onBack && (
            <button type="button" className="admin-back-btn" onClick={onBack}>
              <ArrowLeft size={14} /> Volver al sitio principal
            </button>
          )}
        </div>
      </main>
    )
  }

  // ═════════════════════════════════════════════════════════════════
  // PANEL AUTENTICADO
  // ═════════════════════════════════════════════════════════════════
  const totalTicketsIssued = tickets.length || orders.reduce((sum, o) => sum + o.quantity, 0)
  const totalCheckedIn = tickets.filter(t => t.status === 'used').length
  const totalRevenue = orders.filter(o => o.status === 'pagado').reduce((sum, o) => sum + o.total_ars, 0)
  const pendingOrders = orders.filter(o => o.status === 'pendiente').length

  // Filtrado de tickets (ordenados de forma correlativa para sorteo)
  const filteredTickets = [...tickets]
    .sort((a, b) => {
      const isPlA = isPlayerTicket(a)
      const isPlB = isPlayerTicket(b)
      if (isPlA && !isPlB) return 1
      if (!isPlA && isPlB) return -1
      const numA = parseInt(getTicketDisplayNumber(a) || '0', 10) || 0
      const numB = parseInt(getTicketDisplayNumber(b) || '0', 10) || 0
      return numA - numB
    })
    .filter(t => {
      const q = searchQuery.toLowerCase().trim()
      const ticketNum = getTicketDisplayNumber(t) || ''
      const isPl = isPlayerTicket(t)
      const matchesSearch =
        !q ||
        t.attendee_name?.toLowerCase().includes(q) ||
        t.qr_token?.toLowerCase().includes(q) ||
        t.id?.toLowerCase().includes(q) ||
        (isPl && (q.includes('jugador') || q.includes('sorteo'))) ||
        (ticketNum && (
          ticketNum.includes(q) ||
          `n° ${ticketNum}`.toLowerCase().includes(q) ||
          `#${ticketNum}`.toLowerCase().includes(q)
        ))

      if (!matchesSearch) return false
      if (filterStatus === 'used') return t.status === 'used'
      if (filterStatus === 'valid') return t.status === 'valid'
      return true
    })

  // Filtrado de pedidos
  const filteredOrders = orders.filter(o => {
    const q = searchQuery.toLowerCase()
    const orderNum = `atsc-${o.id.slice(0, 6)}`.toLowerCase()
    const matchesSearch =
      !q ||
      o.buyer_full_name.toLowerCase().includes(q) ||
      o.buyer_email.toLowerCase().includes(q) ||
      o.buyer_dni.includes(q) ||
      o.id.toLowerCase().includes(q) ||
      orderNum.includes(q)

    if (!matchesSearch) return false
    if (filterStatus === 'pagado') return o.status === 'pagado'
    if (filterStatus === 'pendiente') return o.status === 'pendiente'
    return true
  })

  return (
    <main className="admin-dashboard">
      {/* Canvas flotante para confeti festivo en sorteos */}
      <canvas ref={confettiCanvasRef} className="sorteo-confetti-canvas" />

      {/* Header del Dashboard */}
      <header className="dashboard-header">
        <div className="dash-title-wrap">
          <ClubLogo url={clubLogo} size="sm" />
          <div>
            <div className="admin-kicker">ANDES TALLERES · CONTROL DE EVENTO</div>
            <h1>Cena de Fin de Año 2026</h1>
          </div>
        </div>

        <div className="dash-top-actions">
          {userEmail && (
            <span style={{ fontSize: '12px', color: '#8a9ab5', padding: '6px 10px', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)' }}>
              👤 {userEmail}
            </span>
          )}
          <button
            className="btn-dash-primary"
            onClick={() => setActiveTab('presencial')}
            title="Anotar y emitir entrada en el instante a quien compre presencialmente"
          >
            <UserPlus size={15} /> + Venta Presencial
          </button>
          {onBack && (
            <button className="btn-dash-outline" onClick={onBack}>
              <ArrowLeft size={14} /> Ir a la Web
            </button>
          )}
          <button className="btn-dash-outline" onClick={() => void loadAllData()}>
            <RefreshCw size={14} className={loading ? 'spinner' : ''} /> Actualizar
          </button>
          <button className="btn-dash-outline" onClick={handleSignOut}>
            <LogOut size={14} /> Salir
          </button>
        </div>
      </header>

      {/* Tarjetas de Estadísticas Principales */}
      <section className="admin-stats-grid">
        <article className="stat-card">
          <span>ENTRADAS EMITIDAS</span>
          <strong>{totalTicketsIssued}</strong>
          <small>{orders.length} pedidos registrados</small>
        </article>
        <article className="stat-card checkin-card">
          <span>INGRESOS CONFIRMADOS</span>
          <strong>{totalCheckedIn} / {totalTicketsIssued}</strong>
          <small>{totalTicketsIssued > 0 ? Math.round((totalCheckedIn / totalTicketsIssued) * 100) : 0}% de asistencia</small>
        </article>
        <article className="stat-card">
          <span>RECAUDACIÓN PAGADA</span>
          <strong className="text-green">{money(totalRevenue)}</strong>
          <small>{pendingOrders} transferencias pendientes</small>
        </article>
        <article className="stat-card">
          <span>FALTANTES POR INGRESAR</span>
          <strong>{Math.max(0, totalTicketsIssued - totalCheckedIn)}</strong>
          <small>Asistentes restantes</small>
        </article>
      </section>

      {/* Tabs Principales */}
      <div className="dash-tabs">
        <button
          className={activeTab === 'scanner' ? 'active tab-scanner-highlight' : ''}
          onClick={() => setActiveTab('scanner')}
        >
          <Camera size={18} /> Escáner de Cámara QR
        </button>
        <button
          className={activeTab === 'presencial' ? 'active tab-presencial-highlight' : ''}
          onClick={() => setActiveTab('presencial')}
        >
          <UserPlus size={18} /> Venta Presencial (Puerta)
        </button>
        <button
          className={activeTab === 'sorteo' ? 'active tab-sorteo-highlight' : ''}
          onClick={() => setActiveTab('sorteo')}
        >
          <Gift size={18} /> Sorteo de Entradas
        </button>
        <button
          className={activeTab === 'tickets' ? 'active' : ''}
          onClick={() => setActiveTab('tickets')}
        >
          <Ticket size={18} /> Listado de Entradas ({tickets.length})
        </button>
        <button
          className={activeTab === 'orders' ? 'active' : ''}
          onClick={() => setActiveTab('orders')}
        >
          <Users size={18} /> Pedidos y Compradores ({orders.length})
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          TAB 1: ESCÁNER QR CON CÁMARA DEL TELÉFONO
         ══════════════════════════════════════════════════════════════ */}
      {activeTab === 'scanner' && (
        <section className="scanner-section animate-fade">
          <div className="scanner-container">
            <div className="scanner-card">
              <div className="scanner-header">
                <h2>Lector de Entradas en Puerta</h2>
                <p>Apuntá la cámara al código QR de la entrada para registrar el ingreso al instante.</p>
              </div>

              {/* Selector de cámara si hay más de una */}
              {cameras.length > 1 && (
                <div className="camera-select-row">
                  <label>Cámara:</label>
                  <select
                    value={selectedCamera}
                    onChange={e => {
                      setSelectedCamera(e.target.value)
                      if (scannerActive) {
                        stopScanner()
                        setTimeout(startScanner, 200)
                      }
                    }}
                  >
                    {cameras.map(c => (
                      <option key={c.id} value={c.id}>{c.label || `Cámara ${c.id.slice(0, 5)}`}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Visor de la cámara */}
              <div className={`camera-viewport-wrap ${scannerActive ? 'scanner-is-active' : ''}`}>
                <div
                  id="qr-reader-viewport"
                  className="qr-viewport"
                  style={{ display: scannerActive ? 'block' : 'none' }}
                ></div>

                {scannerActive && (
                  <div className="scanner-overlay">
                    {scanCooldown ? (
                      <div className="scanner-badge-cooldown">
                        <span className="cooldown-dot"></span>
                        PROCESANDO / PAUSA BREVE
                      </div>
                    ) : (
                      <div className="scanner-badge-live">
                        <span className="pulse-dot"></span>
                        EN VIVO · ESCANEANDO
                      </div>
                    )}
                    <div className={`scanner-reticle ${scanCooldown ? 'reticle-paused' : ''}`}>
                      <span className="scanner-corner corner-tl"></span>
                      <span className="scanner-corner corner-tr"></span>
                      <span className="scanner-corner corner-bl"></span>
                      <span className="scanner-corner corner-br"></span>
                      {!scanCooldown && <span className="scanner-laser"></span>}
                    </div>
                    <p className="scanner-guide-text">
                      {scanCooldown ? 'Entrada procesada · Listo en instantes...' : 'Centrá el código QR dentro del marco'}
                    </p>
                  </div>
                )}

                {!scannerActive && (
                  <div className="camera-placeholder">
                    <div className="cam-icon-circle">
                      <Camera size={38} className="cam-icon" />
                    </div>
                    <p className="cam-status-title">La cámara está apagada</p>
                    <p className="cam-status-sub">Activá el lector para validar entradas en puerta</p>
                    <button
                      type="button"
                      className="btn-start-camera"
                      onClick={startScanner}
                      disabled={scannerStarting}
                    >
                      <Camera size={18} /> {scannerStarting ? 'Iniciando cámara...' : 'ACTIVAR CÁMARA'}
                    </button>
                  </div>
                )}
              </div>

              {/* Controles de cámara */}
              {scannerActive && (
                <div className="camera-controls">
                  <button type="button" className="btn-stop-camera" onClick={stopScanner}>
                    ⏹ Detener Cámara
                  </button>
                </div>
              )}

              {/* RESULTADO DEL ESCANEO */}
              {scanResult && (
                <div className={`scan-result-card result-${scanResult.status} animate-fade`}>
                  <div className="result-icon-col">
                    {scanResult.status === 'valid' && <CheckCircle2 size={44} />}
                    {scanResult.status === 'used' && <AlertTriangle size={44} />}
                    {scanResult.status === 'invalid' && <XCircle size={44} />}
                  </div>
                  <div className="result-info-col">
                    <span className="result-tag">
                      {scanResult.status === 'valid' && '✅ ACCESO PERMITIDO'}
                      {scanResult.status === 'used' && '⛔ ENTRADA YA UTILIZADA'}
                      {scanResult.status === 'invalid' && '❌ CÓDIGO NO VÁLIDO'}
                    </span>
                    <h3>{scanResult.attendeeName || 'Asistente'}</h3>
                    <p>{scanResult.message}</p>
                    {scanResult.ticketNumber && (
                      <div className="result-ticket-badge">
                        🎟️ Entrada N° {scanResult.ticketNumber.replace(/^N°\s*/i, '')}
                      </div>
                    )}
                    <div className="result-actions-row">
                      <button
                        type="button"
                        className="btn-next-scan"
                        onClick={() => {
                          setScanResult(null)
                          lastScannedTokenRef.current = null
                          lastScannedTimeRef.current = 0
                          setScanCooldown(false)
                        }}
                      >
                        Siguiente escaneo
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Check-in manual por texto / DNI */}
              <div className="manual-checkin-box">
                <h4>Validación Manual (si la cámara no lee el QR):</h4>
                <div className="manual-input-row">
                  <input
                    type="text"
                    placeholder="Ingresá nombre, DNI o token del QR..."
                    value={manualCode}
                    onChange={e => setManualCode(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (manualCode.trim()) {
                        void processQrCode(manualCode.trim())
                      }
                    }}
                  >
                    Verificar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ══════════════════════════════════════════════════════════════
          TAB: VENTA PRESENCIAL DE ENTRADAS EN PUERTA
         ══════════════════════════════════════════════════════════════ */}
      {activeTab === 'presencial' && (
        <section className="presencial-section animate-fade">
          <div className="presencial-container">
            {presencialSuccessData ? (
              /* Tarjeta de Confirmación de Venta Presencial */
              <div className="presencial-success-card animate-fade">
                <div className="pres-success-header">
                  <div className="pres-success-icon-wrap">
                    <CheckCircle2 size={44} color="#00d2b4" />
                  </div>
                  <div>
                    <span className="pres-success-pill">VENTA REGISTRADA CON ÉXITO</span>
                    <h2>¡Entradas Emitidas #{presencialSuccessData.orderId}!</h2>
                    <p>Comprador: <b>{presencialSuccessData.buyer.fullName}</b> (DNI: {presencialSuccessData.buyer.dni})</p>
                  </div>
                </div>

                <div className="pres-email-status-banner">
                  {presencialSuccessData.emailSuccess ? (
                    <div className="status-email-ok">
                      <Check size={18} />
                      <span>Se despachó el correo electrónico con los códigos QR a <b>{presencialSuccessData.buyer.email}</b>.</span>
                    </div>
                  ) : (
                    <div className="status-email-warn">
                      <AlertTriangle size={18} />
                      <span>Nota de correo: {presencialSuccessData.emailMessage || 'No se pudo enviar el correo vía SMTP. Verificá credenciales.'} (Podés mostrar los códigos QR abajo para que ingresen ya mismo).</span>
                    </div>
                  )}
                  {presencialSuccessData.checkedInImmediate && (
                    <div className="status-checkin-ok">
                      <Check size={18} />
                      <span><b>Ingreso registrado en puerta:</b> Las {presencialSuccessData.quantity} entrada(s) ya fueron marcadas como INGRESADAS.</span>
                    </div>
                  )}
                </div>

                {/* Grilla con los QR emitidos */}
                <div className="pres-issued-qr-grid">
                  {presencialSuccessData.tickets.map((t, idx) => (
                    <div key={idx} className="pres-qr-card">
                      <div className="pres-qr-top">
                        {t.isPlayer ? (
                          <span className="badge-player-pill">⚽ JUGADOR (Sin sorteo)</span>
                        ) : (
                          <span className="badge-raffle-pill">🎟️ SORTEO N° {t.ticketNumber}</span>
                        )}
                        <span className="pres-club-tag">ATSC 2026</span>
                      </div>
                      <strong className="pres-qr-name">{t.attendeeName}</strong>
                      {presencialSuccessData.qrDataUrls[t.qrToken] && (
                        <div className="pres-qr-img-wrap">
                          <img
                            src={presencialSuccessData.qrDataUrls[t.qrToken]}
                            alt={`QR Entrada ${t.ticketNumber}`}
                            width={190}
                            height={190}
                          />
                        </div>
                      )}
                      <small className="pres-qr-token">{t.qrToken.slice(0, 18)}...</small>
                    </div>
                  ))}
                </div>

                <div className="pres-actions-row">
                  <button
                    type="button"
                    className="btn-dash-primary btn-big"
                    onClick={handleResetPresencialForm}
                  >
                    <Plus size={18} /> Nueva Venta Presencial
                  </button>
                  <button
                    type="button"
                    className="btn-dash-outline btn-big"
                    onClick={() => setActiveTab('tickets')}
                  >
                    <Ticket size={18} /> Ver en Listado de Entradas
                  </button>
                </div>
              </div>
            ) : (
              /* Formulario de Venta Presencial */
              <div className="presencial-form-card">
                <div className="pres-card-header">
                  <div className="pres-card-icon"><UserPlus size={24} /></div>
                  <div>
                    <h2>Venta y Emisión Presencial de Entradas</h2>
                    <p>Anotá en el momento a los asistentes en puerta y enviales automáticamente sus códigos QR por correo electrónico.</p>
                  </div>
                </div>

                <form onSubmit={handleRegisterPresencialSale} className="pres-form">
                  {/* Datos del Comprador */}
                  <div className="pres-section-block">
                    <h3>1. Datos de Contacto del Comprador</h3>
                    <div className="form-grid-modern">
                      <div className="form-field full">
                        <label>Nombre y Apellido Completo *</label>
                        <input
                          type="text"
                          required
                          placeholder="Ej: Laura Martínez"
                          value={presencialBuyer.fullName}
                          onChange={e => {
                            const val = e.target.value
                            setPresencialBuyer(b => ({ ...b, fullName: val }))
                            if (presencialAttendees[0] && (!presencialAttendees[0].name || presencialAttendees[0].name === presencialBuyer.fullName)) {
                              updatePresencialAttendee(0, { name: val })
                            }
                          }}
                        />
                      </div>

                      <div className="form-field">
                        <label>DNI del Comprador *</label>
                        <input
                          type="text"
                          required
                          inputMode="numeric"
                          placeholder="Sin puntos ni espacios"
                          value={presencialBuyer.dni}
                          onChange={e => setPresencialBuyer(b => ({ ...b, dni: e.target.value.replace(/\D/g, '').slice(0, 8) }))}
                        />
                      </div>

                      <div className="form-field">
                        <label>Teléfono Celular / WhatsApp</label>
                        <input
                          type="tel"
                          placeholder="+54 9 261 ..."
                          value={presencialBuyer.phone}
                          onChange={e => setPresencialBuyer(b => ({ ...b, phone: e.target.value }))}
                        />
                      </div>

                      <div className="form-field full">
                        <label>
                          Correo Electrónico para enviar los códigos QR *
                          <span className="highlight-tag">Se le despachará el mail con los QR al instante</span>
                        </label>
                        <input
                          type="email"
                          required
                          placeholder="comprador@gmail.com"
                          value={presencialBuyer.email}
                          onChange={e => setPresencialBuyer(b => ({ ...b, email: e.target.value }))}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Cantidad de entradas */}
                  <div className="pres-section-block">
                    <div className="pres-qty-header-row">
                      <div>
                        <h3>2. Cantidad de Entradas</h3>
                        <p style={{ color: '#8a9ab5', fontSize: '13px', margin: 0 }}>Indicá cuántas personas ingresan con esta compra</p>
                      </div>
                      <div className="stepper-modern">
                        <button
                          type="button"
                          onClick={() => setPresencialQty(q => Math.max(1, q - 1))}
                          disabled={presencialQty <= 1}
                        >
                          <Minus size={18} />
                        </button>
                        <span className="stepper-val">{presencialQty}</span>
                        <button
                          type="button"
                          onClick={() => setPresencialQty(q => Math.min(10, q + 1))}
                          disabled={presencialQty >= 10}
                        >
                          <Plus size={18} />
                        </button>
                      </div>
                    </div>

                    {/* Lista de selección de roles y categorías para cada entrada */}
                    <div className="pres-attendees-list">
                      {Array.from({ length: presencialQty }).map((_, idx) => {
                        const att = presencialAttendees[idx] || {
                          name: '',
                          role: 'jugador' as AttendeeRole,
                          category: 'Primera' as Category,
                        }

                        return (
                          <div key={idx} className="pres-attendee-item-card">
                            <div className="pres-item-header">
                              <span className="attendee-tag-badge">Entrada #{idx + 1}</span>
                              <span className={`attendee-type-indicator ${att.role === 'jugador' ? 'indicator-jugador' : 'indicator-acompanante'}`}>
                                {att.role === 'jugador' ? '⚽ Jugador · $0 (Sin sorteo)' : `🎟️ Acompañante · ${money(unitPrice)} (Con sorteo)`}
                              </span>
                            </div>

                            <div className="pres-item-fields-grid">
                              {/* 1. Rol */}
                              <div className="pres-field-col">
                                <label><b>1. Tipo de Asistente *</b></label>
                                <div className="role-selector-grid">
                                  <button
                                    type="button"
                                    className={`role-option-btn ${att.role === 'jugador' ? 'selected role-jugador' : ''}`}
                                    onClick={() => updatePresencialAttendee(idx, { role: 'jugador' })}
                                  >
                                    <span className="role-opt-emoji">⚽</span>
                                    <div className="role-opt-text">
                                      <strong>Jugador</strong>
                                      <small>Sin costo · Sin sorteo</small>
                                    </div>
                                    {att.role === 'jugador' && <Check size={14} className="role-check" />}
                                  </button>

                                  <button
                                    type="button"
                                    className={`role-option-btn ${att.role === 'acompanante' ? 'selected role-acompanante' : ''}`}
                                    onClick={() => updatePresencialAttendee(idx, { role: 'acompanante' })}
                                  >
                                    <span className="role-opt-emoji">🎟️</span>
                                    <div className="role-opt-text">
                                      <strong>Acompañante</strong>
                                      <small>{money(unitPrice)} · Con sorteo</small>
                                    </div>
                                    {att.role === 'acompanante' && <Check size={14} className="role-check" />}
                                  </button>
                                </div>
                              </div>

                              {/* 2. Categoría */}
                              <div className="pres-field-col">
                                <label><b>2. Categoría *</b></label>
                                <select
                                  className="category-select-input"
                                  value={att.category}
                                  onChange={e => updatePresencialAttendee(idx, { category: e.target.value as Category })}
                                  required
                                >
                                  {CATEGORIES.map(cat => (
                                    <option key={cat} value={cat}>
                                      Categoría {cat}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              {/* 3. Nombre */}
                              <div className="pres-field-col">
                                <label><b>3. Nombre del Asistente *</b></label>
                                <input
                                  type="text"
                                  className="attendee-text-input"
                                  required
                                  placeholder={idx === 0 ? (presencialBuyer.fullName || 'Nombre y Apellido') : `Nombre Asistente Entrada #${idx + 1}`}
                                  value={att.name}
                                  onChange={e => updatePresencialAttendee(idx, { name: e.target.value })}
                                />
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Método de Cobro y Check-in */}
                  <div className="pres-section-block">
                    <h3>3. Forma de Pago y Acceso</h3>
                    <div className="pres-payment-method-row">
                      <label className="pres-label">Medio de cobro recibido:</label>
                      <div className="payment-method-pills">
                        <button
                          type="button"
                          className={`method-pill ${presencialPaymentMethod === 'efectivo' ? 'selected' : ''}`}
                          onClick={() => setPresencialPaymentMethod('efectivo')}
                        >
                          💵 Efectivo en Puerta
                        </button>
                        <button
                          type="button"
                          className={`method-pill ${presencialPaymentMethod === 'transferencia' ? 'selected' : ''}`}
                          onClick={() => setPresencialPaymentMethod('transferencia')}
                        >
                          📲 Transferencia Bancaria
                        </button>
                        <button
                          type="button"
                          className={`method-pill ${presencialPaymentMethod === 'otro' ? 'selected' : ''}`}
                          onClick={() => setPresencialPaymentMethod('otro')}
                        >
                          🎁 Especial / Bonificado
                        </button>
                      </div>
                    </div>

                    <div className="pres-checkin-option">
                      <label className="checkbox-custom-label">
                        <input
                          type="checkbox"
                          checked={presencialCheckInImmediate}
                          onChange={e => setPresencialCheckInImmediate(e.target.checked)}
                        />
                        <span>
                          <b>Check-in automático en puerta:</b> Marcar inmediatamente como ingresado (el asistente entra al evento ahora mismo sin tener que escanearlo después).
                        </span>
                      </label>
                    </div>
                  </div>

                  {/* Resumen de cobro */}
                  <div className="pres-summary-box">
                    <div className="summary-breakdown-row">
                      <span>⚽ Entradas Jugadores ({presencialPlayerCount}):</span>
                      <strong className="text-green">¡GRATIS! ($0)</strong>
                    </div>
                    <div className="summary-breakdown-row">
                      <span>🎟️ Entradas Acompañantes ({presencialCompanionCount}):</span>
                      <strong>{money(presencialCompanionCount * unitPrice)}</strong>
                    </div>
                    <div className="summary-divider-line" />
                    <div className="summary-total-calc-row">
                      <span>TOTAL COBRADO EN PUERTA:</span>
                      <strong className="total-amount-highlight">{money(presencialTotal)}</strong>
                    </div>
                  </div>

                  {presencialError && (
                    <div className="error-banner" style={{ marginTop: '16px' }}>
                      <AlertTriangle size={18} />
                      <span>{presencialError}</span>
                    </div>
                  )}

                  <div className="pres-form-actions">
                    <button
                      type="submit"
                      className="btn-huge-red full-width"
                      disabled={presencialSubmitting}
                    >
                      {presencialSubmitting ? (
                        <>
                          <RefreshCw size={18} className="spinner" />
                          <span>REGISTRANDO VENTA Y ENVIANDO MAIL CON QR...</span>
                        </>
                      ) : (
                        <>
                          <Send size={18} />
                          <span>REGISTRAR VENTA Y ENVIAR QR AL CORREO</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ══════════════════════════════════════════════════════════════
          TAB 2: LISTADO DE ENTRADAS & CHECK-IN MANUAL
         ══════════════════════════════════════════════════════════════ */}
      {activeTab === 'tickets' && (
        <section className="table-section animate-fade">
          <div className="table-controls-bar">
            <div className="search-box">
              <Search size={16} />
              <input
                type="text"
                placeholder="Buscar por asistente, token o ID..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="filter-chips">
              <button
                className={filterStatus === 'all' ? 'active' : ''}
                onClick={() => setFilterStatus('all')}
              >
                Todas ({tickets.length})
              </button>
              <button
                className={filterStatus === 'used' ? 'active' : ''}
                onClick={() => setFilterStatus('used')}
              >
                🟢 Ingresadas ({totalCheckedIn})
              </button>
              <button
                className={filterStatus === 'valid' ? 'active' : ''}
                onClick={() => setFilterStatus('valid')}
              >
                ⚪ Sin Ingresar ({Math.max(0, totalTicketsIssued - totalCheckedIn)})
              </button>
              <button
                type="button"
                className="btn-dash-outline"
                style={{ borderColor: 'rgba(251, 191, 36, 0.4)', color: '#fbbf24', marginLeft: 'auto' }}
                onClick={() => setActiveTab('sorteo')}
                title="Abrir la ruleta / sorteador de números de entradas"
              >
                <Gift size={15} /> Ir al Sorteo
              </button>
            </div>
          </div>

          <div className="table-scroll-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>N° Entrada (Sorteo)</th>
                  <th>Nombre del Asistente</th>
                  <th>Token QR</th>
                  <th>Estado</th>
                  <th>Hora de Ingreso</th>
                  <th>Acción en Puerta</th>
                </tr>
              </thead>
              <tbody>
                {filteredTickets.map(ticket => (
                  <tr key={ticket.id}>
                    <td>
                      {isPlayerTicket(ticket) ? (
                        <span className="ticket-badge-player">
                          ⚽ Jugador (Sin sorteo)
                        </span>
                      ) : (
                        <span className="ticket-badge-number">
                          🎟️ N° {getTicketDisplayNumber(ticket)}
                        </span>
                      )}
                    </td>
                    <td><strong>{ticket.attendee_name}</strong></td>
                    <td><small className="token-cell">{ticket.qr_token.slice(0, 16)}...</small></td>
                    <td>
                      {ticket.status === 'used' ? (
                        <span className="badge-status badge-used">INGRESÓ</span>
                      ) : (
                        <span className="badge-status badge-valid">SIN INGRESAR</span>
                      )}
                    </td>
                    <td>
                      {ticket.checked_in_at
                        ? new Date(ticket.checked_in_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) + ' hs'
                        : '—'}
                    </td>
                    <td>
                      {ticket.status === 'valid' ? (
                        <button
                          className="btn-action-checkin"
                          onClick={() => void handleManualCheckIn(ticket)}
                        >
                          <Check size={14} /> Marcar Ingreso
                        </button>
                      ) : (
                        <button
                          className="btn-action-revert"
                          onClick={() => void handleRevertCheckIn(ticket)}
                        >
                          Revertir
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!filteredTickets.length && (
                  <tr>
                    <td colSpan={6} className="text-center py-4">
                      No se encontraron entradas con ese criterio de búsqueda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ══════════════════════════════════════════════════════════════
          TAB 3: GESTIÓN DE PEDIDOS Y PAGOS
         ══════════════════════════════════════════════════════════════ */}
      {activeTab === 'orders' && (
        <section className="table-section animate-fade">
          <div className="table-controls-bar">
            <div className="search-box">
              <Search size={16} />
              <input
                type="text"
                placeholder="Buscar por comprador, DNI o email..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="filter-chips">
              <button
                className={filterStatus === 'all' ? 'active' : ''}
                onClick={() => setFilterStatus('all')}
              >
                Todos ({orders.length})
              </button>
              <button
                className={filterStatus === 'pagado' ? 'active' : ''}
                onClick={() => setFilterStatus('pagado')}
              >
                Pagados
              </button>
              <button
                className={filterStatus === 'pendiente' ? 'active' : ''}
                onClick={() => setFilterStatus('pendiente')}
              >
                Pendientes
              </button>
            </div>
          </div>

          {actionFeedback && (
            <div className={`admin-action-feedback ${actionFeedback.success ? 'feedback-success' : 'feedback-error'} animate-fade`}>
              {actionFeedback.success ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
              <span>{actionFeedback.message}</span>
              <button type="button" onClick={() => setActionFeedback(null)}>×</button>
            </div>
          )}

          <div className="table-scroll-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>N° Pedido</th>
                  <th>Fecha</th>
                  <th>Comprador</th>
                  <th>DNI</th>
                  <th>Contacto</th>
                  <th>Entradas</th>
                  <th>Total</th>
                  <th>Referencia</th>
                  <th>Estado</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map(order => (
                  <tr key={order.id} className={order.status === 'pendiente' ? 'row-pending' : ''}>
                    <td>
                      <span className="order-num-pill">
                        #ATSC-{order.id.slice(0, 6).toUpperCase()}
                      </span>
                    </td>
                    <td>{new Date(order.created_at).toLocaleDateString('es-AR')}</td>
                    <td><strong>{order.buyer_full_name}</strong></td>
                    <td>{order.buyer_dni}</td>
                    <td>
                      <div>{order.buyer_phone}</div>
                      <small className="text-muted">{order.buyer_email}</small>
                    </td>
                    <td><b>{order.quantity}</b></td>
                    <td><strong>{money(order.total_ars)}</strong></td>
                    <td>
                      <small className="ref-cell">{order.transfer_reference || 'Por WhatsApp'}</small>
                    </td>
                    <td>
                      <span className={`badge-status badge-${order.status}`}>
                        {order.status === 'pagado' ? 'PAGADO' : 'PENDIENTE'}
                      </span>
                    </td>
                    <td>
                      {order.status === 'pendiente' ? (
                        <button
                          className="btn-action-approve"
                          onClick={() => void handleConfirmAndSendQr(order)}
                          disabled={approvingOrderId === order.id}
                        >
                          {approvingOrderId === order.id ? (
                            <>
                              <RefreshCw size={13} className="spinner" /> Enviando QR...
                            </>
                          ) : (
                            <>
                              <Send size={13} /> Aprobar y Enviar QR
                            </>
                          )}
                        </button>
                      ) : (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                          <span className="badge-confirmed">
                            <Check size={13} /> Pagado
                          </span>
                          <button
                            type="button"
                            className="btn-action-resend"
                            title="Reenviar códigos QR al correo del comprador"
                            onClick={() => void handleResendQrEmail(order)}
                            disabled={approvingOrderId === order.id}
                          >
                            {approvingOrderId === order.id ? (
                              <>
                                <RefreshCw size={12} className="spinner" /> Reenviando...
                              </>
                            ) : (
                              <>
                                <Send size={12} /> Reenviar QR
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {!filteredOrders.length && (
                  <tr>
                    <td colSpan={9} className="text-center py-4">
                      No hay pedidos registrados con ese filtro.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ══════════════════════════════════════════════════════════════
          TAB 5: SORTEO DE ENTRADAS (NÚMERO AL AZAR)
         ══════════════════════════════════════════════════════════════ */}
      {activeTab === 'sorteo' && (
        <section className="sorteo-section animate-fade">
          <div className="sorteo-hero-card">
            <div className="sorteo-badge-pill">
              <Sparkles size={14} /> Sorteo Oficial · Andes Talleres Sport Club
            </div>
            <h2>Sorteo de Entradas de la Cena</h2>
            <p>
              Elegí un número al azar de manera transparente y en vivo entre las entradas de acompañantes emitidas.
            </p>

            {/* Barra de Ajustes y Filtro de Participantes */}
            <div className="sorteo-settings-bar">
              <div className="sorteo-filter-toggle">
                <button
                  type="button"
                  className={`sorteo-filter-btn ${raffleFilter === 'checked_in_only' ? 'active' : ''}`}
                  onClick={() => setRaffleFilter('checked_in_only')}
                  disabled={isRolling}
                >
                  <CheckCircle2 size={14} /> Solo Presentes ({raffleParticipants.filter(p => p.isCheckedIn).length})
                </button>
                <button
                  type="button"
                  className={`sorteo-filter-btn ${raffleFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setRaffleFilter('all')}
                  disabled={isRolling}
                >
                  <Ticket size={14} /> Todas las Entradas ({raffleParticipants.length})
                </button>
              </div>

              <label className="sorteo-checkbox-label">
                <input
                  type="checkbox"
                  checked={excludePreviousWinners}
                  onChange={e => setExcludePreviousWinners(e.target.checked)}
                  disabled={isRolling}
                />
                Excluir ganadores previos ({winnersHistory.length})
              </label>

              <button
                type="button"
                className={`sorteo-sound-btn ${soundEnabled ? 'sound-on' : ''}`}
                onClick={() => setSoundEnabled(s => !s)}
                title="Activar / desactivar efectos de sonido del sorteo"
              >
                {soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
                {soundEnabled ? 'Sonido ON' : 'Silencio'}
              </button>
            </div>

            {/* Escenario Digital / Pantalla del Sorteo */}
            <div className={`sorteo-stage-box ${isRolling ? 'is-spinning' : ''}`}>
              <div className="sorteo-stage-tag">
                {isRolling ? '⚡ SORTEANDO NÚMERO AL AZAR...' : (currentWinner ? '🏆 ¡ENTRADA GANADORA!' : 'NÚMERO DE ENTRADA')}
              </div>

              <div className={`sorteo-digital-number ${currentWinner && !isRolling ? 'winner-glory' : ''}`}>
                {isRolling ? `#${rollingNumber}` : (currentWinner ? `#${currentWinner.ticketNumber}` : (rollingNumber !== '???' ? `#${rollingNumber}` : '#???'))}
              </div>

              <div className="sorteo-preview-name">
                {isRolling ? (
                  <span>{rollingAttendee}</span>
                ) : currentWinner ? (
                  <strong style={{ color: '#ffffff', fontSize: '18px' }}>{currentWinner.ticket.attendee_name}</strong>
                ) : (
                  <span>Presioná el botón para sortear una entrada al azar</span>
                )}
              </div>
            </div>

            {/* Input Opcional de Nombre de Premio */}
            <div className="sorteo-prize-input-row">
              <label><Award size={14} /> Premio en juego:</label>
              <input
                type="text"
                placeholder={`Ej: Camiseta Oficial, Vino Reserva, Premio #${winnersHistory.length + 1}...`}
                value={prizeInput}
                onChange={e => setPrizeInput(e.target.value)}
                disabled={isRolling}
              />
            </div>

            {/* Botón de Acción Principal */}
            <div className="sorteo-action-buttons">
              <button
                type="button"
                className="btn-sorteo-main"
                onClick={startDraw}
                disabled={isRolling || eligibleParticipants.length === 0}
              >
                {isRolling ? (
                  <>
                    <RefreshCw size={22} className="spinner" /> Sorteando en Vivo...
                  </>
                ) : (
                  <>
                    <Dices size={22} /> ¡Sortear Número Ganador!
                  </>
                )}
              </button>

              {currentWinner && !isRolling && (
                <button
                  type="button"
                  className="btn-dash-outline"
                  onClick={startDraw}
                  title="Volver a sortear otro ganador"
                  disabled={eligibleParticipants.length === 0}
                >
                  <RotateCcw size={15} /> Sortear Otro
                </button>
              )}
            </div>

            <div className="sorteo-pool-count">
              {eligibleParticipants.length > 0 ? (
                <>
                  Participan <strong>{eligibleParticipants.length}</strong> entradas de acompañantes en este sorteo
                  {raffleFilter === 'checked_in_only' ? ' (solo quienes ya ingresaron al evento)' : ' (todas las vendidas)'}.
                </>
              ) : (
                <span style={{ color: '#ff6874' }}>
                  ⚠️ No hay entradas participantes disponibles con los filtros seleccionados.
                </span>
              )}
            </div>
          </div>

          {/* Tarjeta de Ganador Revelado */}
          {currentWinner && (
            <div className="winner-card-container">
              <div className="winner-card-header">
                <div className="winner-trophy-badge">
                  <Trophy size={22} /> ¡NÚMERO GANADOR REVELADO!
                </div>
                <span className="winner-number-pill">
                  N° {currentWinner.ticketNumber}
                </span>
              </div>

              {winnersHistory[0] && (
                <div className="winner-prize-title">
                  <Gift size={16} color="#fbbf24" />
                  <span>{winnersHistory[0].prizeName}</span>
                </div>
              )}

              <div className="winner-details-grid">
                <div className="winner-detail-col">
                  <label>Asistente Ganador</label>
                  <strong>{currentWinner.ticket.attendee_name}</strong>
                  <span>Entrada N° {currentWinner.ticketNumber} (Acompañante)</span>
                </div>

                <div className="winner-detail-col">
                  <label>Presencia en Puerta</label>
                  {currentWinner.isCheckedIn ? (
                    <div className="winner-attendance-status winner-att-present">
                      <CheckCircle2 size={14} /> PRESENTE EN EL SALÓN
                      {currentWinner.ticket.checked_in_at && (
                        <span> · Ingreso {new Date(currentWinner.ticket.checked_in_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} hs</span>
                      )}
                    </div>
                  ) : (
                    <div className="winner-attendance-status winner-att-absent">
                      <AlertTriangle size={14} /> NO REGISTRÓ INGRESO AÚN
                    </div>
                  )}
                </div>

                <div className="winner-detail-col">
                  <label>Comprador / Titular</label>
                  <strong>{currentWinner.order?.buyer_full_name || 'Venta directa'}</strong>
                  <span>DNI: {currentWinner.order?.buyer_dni || '—'} · Pedido #{currentWinner.ticket.order_id?.slice(0, 6).toUpperCase()}</span>
                </div>

                <div className="winner-detail-col">
                  <label>Teléfono de Contacto</label>
                  <strong>{currentWinner.order?.buyer_phone || 'Sin teléfono'}</strong>
                  <span>{currentWinner.order?.buyer_email || '—'}</span>
                </div>
              </div>

              <div className="winner-actions-bar">
                {currentWinner.order?.buyer_phone && (
                  <a
                    href={`https://wa.me/${currentWinner.order.buyer_phone.replace(/\D/g, '')}?text=${encodeURIComponent(`¡Hola ${currentWinner.order.buyer_full_name}! Te avisamos que tu entrada N° ${currentWinner.ticketNumber} (${currentWinner.ticket.attendee_name}) acaba de salir ganadora en el sorteo de la Cena Andes Talleres 2026! 🏆🎉`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-winner-wa"
                  >
                    <Send size={14} /> Contactar por WhatsApp
                  </a>
                )}

                <button
                  type="button"
                  className="btn-winner-copy"
                  onClick={() => {
                    const text = `🏆 GANADOR DEL SORTEO ATSC\nN°: ${currentWinner.ticketNumber}\nAsistente: ${currentWinner.ticket.attendee_name}\nComprador: ${currentWinner.order?.buyer_full_name || '—'} (DNI: ${currentWinner.order?.buyer_dni || '—'})\nTeléfono: ${currentWinner.order?.buyer_phone || '—'}\nEstado: ${currentWinner.isCheckedIn ? 'Presente en el salón' : 'Sin ingreso registrado'}`
                    navigator.clipboard.writeText(text)
                    setCopiedRecordId('current')
                    setTimeout(() => setCopiedRecordId(null), 2500)
                  }}
                >
                  <Copy size={14} /> {copiedRecordId === 'current' ? '¡Copiado!' : 'Copiar Ganador'}
                </button>

                <button
                  type="button"
                  className="btn-winner-discard"
                  onClick={() => {
                    if (confirm('¿Descartar este ganador y volver a sortear? (Se eliminará del historial de ganadores)')) {
                      if (winnersHistory.length > 0) {
                        setWinnersHistory(prev => prev.filter(w => w.participant.ticket.id !== currentWinner.ticket.id))
                      }
                      setCurrentWinner(null)
                      setRollingNumber('???')
                    }
                  }}
                  title="Descartar este resultado (ej: si no estaba presente)"
                >
                  <RotateCcw size={14} /> Descartar y Re-sortear
                </button>
              </div>
            </div>
          )}

          {/* Historial de Ganadores de la Sesión */}
          <div className="sorteo-history-card">
            <div className="sorteo-history-header">
              <h3>
                <Trophy size={18} color="#fbbf24" /> Historial de Ganadores ({winnersHistory.length})
              </h3>
              {winnersHistory.length > 0 && (
                <div className="sorteo-history-actions">
                  <button
                    type="button"
                    className="btn-dash-outline"
                    onClick={() => {
                      const listText = winnersHistory.map((w, idx) =>
                        `${idx + 1}. [N° ${w.participant.ticketNumber}] ${w.prizeName}: ${w.participant.ticket.attendee_name} (Comprador: ${w.participant.order?.buyer_full_name || '—'} - Tel: ${w.participant.order?.buyer_phone || '—'})`
                      ).join('\n')
                      navigator.clipboard.writeText(`🏆 GANADORES SORTEO CENA ANDES TALLERES:\n\n${listText}`)
                      setCopiedRecordId('all')
                      setTimeout(() => setCopiedRecordId(null), 2500)
                    }}
                  >
                    <Copy size={13} /> {copiedRecordId === 'all' ? '¡Lista Copiada!' : 'Copiar Todos'}
                  </button>
                  <button
                    type="button"
                    className="btn-history-clear"
                    onClick={() => {
                      if (confirm('¿Seguro que deseás reiniciar el historial de ganadores?')) {
                        setWinnersHistory([])
                        setCurrentWinner(null)
                        setRollingNumber('???')
                      }
                    }}
                  >
                    <Trash2 size={13} /> Reiniciar Historial
                  </button>
                </div>
              )}
            </div>

            {winnersHistory.length === 0 ? (
              <div className="sorteo-history-empty">
                Aún no se sortearon premios en esta sesión. Presioná el botón de sortear para comenzar.
              </div>
            ) : (
              <div className="table-scroll-wrap">
                <table className="sorteo-history-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Premio</th>
                      <th>N° Entrada</th>
                      <th>Asistente Ganador</th>
                      <th>Comprador & Contacto</th>
                      <th>Asistencia</th>
                      <th>Hora</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {winnersHistory.map((rec, idx) => (
                      <tr key={rec.id}>
                        <td className="history-rank">#{winnersHistory.length - idx}</td>
                        <td>
                          <strong>{rec.prizeName}</strong>
                        </td>
                        <td>
                          <span className="order-num-pill" style={{ color: '#fbbf24', borderColor: 'rgba(251,191,36,0.3)', background: 'rgba(251,191,36,0.1)' }}>
                            🎟️ N° {rec.participant.ticketNumber}
                          </span>
                        </td>
                        <td>
                          <strong>{rec.participant.ticket.attendee_name}</strong>
                        </td>
                        <td>
                          <div>{rec.participant.order?.buyer_full_name || '—'}</div>
                          <small style={{ color: '#8496ad' }}>{rec.participant.order?.buyer_phone || ''}</small>
                        </td>
                        <td>
                          {rec.participant.isCheckedIn ? (
                            <span className="badge-status badge-used">Presente</span>
                          ) : (
                            <span className="badge-status badge-valid">Sin ingreso</span>
                          )}
                        </td>
                        <td>
                          <small style={{ color: '#8496ad' }}>
                            {new Date(rec.timestamp).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} hs
                          </small>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn-action-revert"
                            style={{ padding: '4px 8px', fontSize: '11px' }}
                            title="Eliminar este registro del historial"
                            onClick={() => {
                              setWinnersHistory(prev => prev.filter(w => w.id !== rec.id))
                              if (currentWinner?.ticket.id === rec.participant.ticket.id) {
                                setCurrentWinner(null)
                              }
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Transparencia: Acordeón para inspeccionar entradas habilitadas */}
          <div className="sorteo-transparency-card">
            <div
              className="transparency-toggle-row"
              onClick={() => setShowTransparency(prev => !prev)}
            >
              <h4>
                <Ticket size={16} color="#fbbf24" />
                Verificación de Participantes ({eligibleParticipants.length} habilitados para sortear)
              </h4>
              <button type="button" className="btn-dash-outline" style={{ padding: '4px 10px' }}>
                {showTransparency ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            </div>

            {showTransparency && (
              <div className="transparency-body">
                <div className="transparency-search">
                  <div className="search-box">
                    <Search size={14} />
                    <input
                      type="text"
                      placeholder="Buscar por número o nombre de asistente..."
                      value={transparencySearch}
                      onChange={e => setTransparencySearch(e.target.value)}
                    />
                  </div>
                </div>

                <div className="transparency-grid">
                  {raffleParticipants
                    .filter(p => {
                      if (!transparencySearch.trim()) return true
                      const q = transparencySearch.toLowerCase()
                      return (
                        p.ticketNumber.includes(q) ||
                        p.ticket.attendee_name?.toLowerCase().includes(q) ||
                        p.order?.buyer_full_name?.toLowerCase().includes(q)
                      )
                    })
                    .map(p => {
                      const hasWon = winnersHistory.some(w => w.participant.ticket.id === p.ticket.id)
                      const isEligibleNow = eligibleParticipants.some(e => e.ticket.id === p.ticket.id)

                      return (
                        <div
                          key={p.ticket.id}
                          className={`transparency-item ${hasWon ? 'item-won' : ''}`}
                          title={`${p.ticket.attendee_name} - ${p.isCheckedIn ? 'Ingresó' : 'Sin ingreso'}`}
                        >
                          <div>
                            <span className="transparency-num">N° {p.ticketNumber}</span>
                            <div style={{ color: '#cfd8e3', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '130px' }}>
                              {p.ticket.attendee_name}
                            </div>
                          </div>
                          <div>
                            {hasWon ? (
                              <span style={{ fontSize: '10px', color: '#fbbf24', fontWeight: 700 }}>🏆 Ganó</span>
                            ) : p.isCheckedIn ? (
                              <span style={{ fontSize: '10px', color: '#10b981', fontWeight: 700 }}>🟢 Presente</span>
                            ) : (
                              <span style={{ fontSize: '10px', color: '#8496ad' }}>⚪ {isEligibleNow ? 'Participa' : 'Pendiente'}</span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  )
}
