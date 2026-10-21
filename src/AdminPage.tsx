import { useEffect, useState, useRef, useMemo } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import QRCode from 'qrcode'
import {
  LockKeyhole, LogOut, RefreshCw,
  Camera, CheckCircle2, XCircle, AlertTriangle, Users,
  Ticket, ArrowLeft, Search, Check, Send,
  Gift, Trophy, Sparkles, Dices, RotateCcw, Volume2, VolumeX,
  Copy, Trash2, Award, ChevronDown, ChevronUp,
  Printer, FileText, Share2, Download, Filter, X
} from 'lucide-react'
import { supabase } from './lib/supabase'
import { sendTicketsEmail } from './lib/email'
import {
  type OrderConfirmation,
  type IssuedTicket,
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
  isPhysical?: boolean
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
  // Roles de usuario del panel: 'superuser' (acceso total) o 'staff' (solo control en puerta)
  const [userRole, setUserRole] = useState<'superuser' | 'staff' | null>(() => {
    try {
      const saved = localStorage.getItem('atsc_admin_session_v2')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed.role === 'superuser' || parsed.role === 'staff') {
          return parsed.role
        }
      }
    } catch {}
    return null
  })
  const [signedIn, setSignedIn] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('atsc_admin_session_v2')
      return !!saved
    } catch {
      return false
    }
  })
  const [userEmail, setUserEmail] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem('atsc_admin_session_v2')
      if (saved) return JSON.parse(saved).username || null
    } catch {}
    return null
  })
  const [usernameInput, setUsernameInput] = useState('')
  const [passwordInput, setPasswordInput] = useState('')
  const [authError, setAuthError] = useState('')
  const [loading, setLoading] = useState(false)

  // Tabs del panel: 'scanner' | 'presencial' | 'sorteo' | 'padron' | 'tickets' | 'orders'
  const [activeTab, setActiveTab] = useState<'scanner' | 'presencial' | 'sorteo' | 'padron' | 'tickets' | 'orders'>('scanner')
  const [unitPrice, setUnitPrice] = useState<number>(25000)

  // Datos
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [tickets, setTickets] = useState<TicketRow[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [approvingOrderId, setApprovingOrderId] = useState<string | null>(null)
  const [actionFeedback, setActionFeedback] = useState<{ message: string; success: boolean } | null>(null)

  // Mapa de órdenes para búsqueda rápida y visualización de DNI del comprador (hook incondicional)
  const orderMap = useMemo(() => new Map(orders.map(o => [o.id, o])), [orders])

  // Búsqueda de entradas por DNI en el escáner
  const [dniSearch, setDniSearch] = useState('')

  // ── Configuración del Talonario Físico para el Sorteo ──
  const [physicalConfig, setPhysicalConfig] = useState<{
    startNumber: number
    endNumber: number
    soldCount: number
  }>(() => {
    try {
      const saved = localStorage.getItem('atsc_physical_raffle_v1')
      if (saved) return JSON.parse(saved)
    } catch {}
    return {
      startNumber: 1000,
      endNumber: 1100,
      soldCount: 0
    }
  })

  // Sincronizar en localStorage
  useEffect(() => {
    try {
      localStorage.setItem('atsc_physical_raffle_v1', JSON.stringify(physicalConfig))
    } catch {}
  }, [physicalConfig])

  const physicalTotalLot = Math.max(0, physicalConfig.endNumber - physicalConfig.startNumber + 1)

  const handleUpdateStartNumber = (val: number) => {
    setPhysicalConfig(prev => {
      const start = Math.max(1, isNaN(val) ? 1 : val)
      const end = Math.max(start, prev.endNumber)
      const maxLot = end - start + 1
      return {
        startNumber: start,
        endNumber: end,
        soldCount: Math.min(prev.soldCount, maxLot)
      }
    })
  }

  const handleUpdateEndNumber = (val: number) => {
    setPhysicalConfig(prev => {
      const end = Math.max(prev.startNumber, isNaN(val) ? prev.startNumber : val)
      const maxLot = end - prev.startNumber + 1
      return {
        ...prev,
        endNumber: end,
        soldCount: Math.min(prev.soldCount, maxLot)
      }
    })
  }

  const handleUpdateSoldCount = (count: number) => {
    setPhysicalConfig(prev => ({
      ...prev,
      soldCount: Math.min(Math.max(0, isNaN(count) ? 0 : count), physicalTotalLot)
    }))
  }

  const handleAdjustSoldCount = (delta: number) => {
    setPhysicalConfig(prev => ({
      ...prev,
      soldCount: Math.min(Math.max(0, prev.soldCount + delta), physicalTotalLot)
    }))
  }

  const handleSetAllSold = () => {
    setPhysicalConfig(prev => ({
      ...prev,
      soldCount: physicalTotalLot
    }))
  }

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

  // Función para determinar si una entrada es de jugador o menor (no cuenta para el sorteo)
  function isPlayerTicket(ticket: { attendee_name?: string; ticket_number?: number | null }): boolean {
    return ticket.ticket_number == null || ticket.ticket_number <= 0 || /jugador/i.test(ticket.attendee_name || '') || /menor/i.test(ticket.attendee_name || '')
  }

  // Mapeo correlativo estable para sorteo (ÚNICAMENTE para acompañantes)
  const ticketNumberMap = useMemo(() => {
    const companionTickets = tickets.filter(t => !isPlayerTicket(t))
    const sorted = [...companionTickets].sort((a, b) => {
      if (a.ticket_number && b.ticket_number && a.ticket_number !== b.ticket_number) {
        return a.ticket_number - b.ticket_number
      }
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    })

    const map = new Map<string, string>()
    sorted.forEach((t, index) => {
      const num = (t.ticket_number && t.ticket_number > 0) ? t.ticket_number : (index + 1)
      map.set(t.id, String(num).padStart(3, '0'))
    })
    return map
  }, [tickets])

  // Búsqueda en tiempo real de entradas por DNI para el escáner
  const dniSearchClean = dniSearch.replace(/[\.\s-]/g, '').trim().toLowerCase()

  const dniSearchResults = useMemo(() => {
    if (!dniSearchClean || dniSearchClean.length < 2) {
      return []
    }

    // 1. Pedidos cuyo DNI del comprador o nombre coincida
    const matchingOrders = orders.filter(o => {
      const buyerDniClean = (o.buyer_dni || '').replace(/[\.\s-]/g, '').toLowerCase()
      const buyerName = (o.buyer_full_name || '').toLowerCase()
      return buyerDniClean.includes(dniSearchClean) || buyerName.includes(dniSearchClean)
    })

    const matchingOrderIds = new Set(matchingOrders.map(o => o.id))

    // 2. Entradas cuyo asistente o token coincida directamente
    const extraTickets = tickets.filter(t => {
      if (matchingOrderIds.has(t.order_id)) return false
      const attNameClean = (t.attendee_name || '').replace(/[\.\s-]/g, '').toLowerCase()
      const tokenClean = (t.qr_token || '').toLowerCase()
      return attNameClean.includes(dniSearchClean) || tokenClean.includes(dniSearchClean)
    })

    const groups: Array<{
      order?: OrderRow
      orderId: string
      buyerName: string
      buyerDni: string
      buyerPhone?: string
      orderStatus: string
      tickets: TicketRow[]
    }> = []

    matchingOrders.forEach(order => {
      const orderTickets = tickets.filter(t => t.order_id === order.id)
      groups.push({
        order,
        orderId: order.id,
        buyerName: order.buyer_full_name,
        buyerDni: order.buyer_dni,
        buyerPhone: order.buyer_phone,
        orderStatus: order.status,
        tickets: orderTickets
      })
    })

    if (extraTickets.length > 0) {
      const extraByOrder = new Map<string, TicketRow[]>()
      extraTickets.forEach(t => {
        const list = extraByOrder.get(t.order_id) || []
        list.push(t)
        extraByOrder.set(t.order_id, list)
      })
      extraByOrder.forEach((tList, ordId) => {
        const ord = orderMap.get(ordId)
        groups.push({
          order: ord,
          orderId: ordId,
          buyerName: ord?.buyer_full_name || 'Sin nombre registrado',
          buyerDni: ord?.buyer_dni || '---',
          buyerPhone: ord?.buyer_phone,
          orderStatus: ord?.status || 'desconocido',
          tickets: tList
        })
      })
    }

    return groups
  }, [dniSearchClean, orders, tickets, orderMap])

  function getTicketDisplayNumber(ticket: { id: string; attendee_name?: string; ticket_number?: number | null }, fallbackIndex?: number): string | null {
    if (isPlayerTicket(ticket)) {
      return null
    }
    if (ticket.ticket_number && ticket.ticket_number > 0) {
      return String(ticket.ticket_number).padStart(3, '0')
    }
    const mapped = ticketNumberMap.get(ticket.id)
    if (mapped) return mapped
    if (fallbackIndex !== undefined) {
      return String(fallbackIndex + 1).padStart(3, '0')
    }
    return null
  }

  // Extraer rol, categoría y nombre limpio de un ticket
  function parseTicketInfo(ticket: { attendee_name?: string; ticket_number?: number | null }) {
    const raw = (ticket.attendee_name || '').trim()

    let role: 'jugador' | 'acompanante' | 'menor' = 'acompanante'
    if (/menor/i.test(raw)) {
      role = 'menor'
    } else if (/jugador/i.test(raw) || ticket.ticket_number === 0 || ticket.ticket_number == null) {
      role = 'jugador'
    }

    let category = 'Sin Categoría'
    for (const cat of CATEGORIES) {
      const reg = new RegExp(`(^|\\(|·|\\s)${cat}(\\)|\\s|$)`, 'i')
      if (reg.test(raw)) {
        category = cat
        break
      }
    }

    let cleanName = raw.replace(/\s*\([^)]*\)\s*$/, '').trim()
    if (!cleanName) cleanName = raw

    return {
      raw,
      cleanName,
      role,
      category
    }
  }

  // ═════════════════════════════════════════════════════════════════
  // ESTADO Y LÓGICA DEL PADRÓN Y CONTEO POR CATEGORÍAS
  // ═════════════════════════════════════════════════════════════════
  const [padronCategoryFilter, setPadronCategoryFilter] = useState<string>('all')
  const [padronRoleFilter, setPadronRoleFilter] = useState<'all' | 'jugador' | 'acompanante' | 'menor'>('all')
  const [padronStatusFilter, setPadronStatusFilter] = useState<'all' | 'used' | 'valid'>('all')
  const [padronSearch, setPadronSearch] = useState<string>('')
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({})

  // Estadísticas agrupadas por categoría
  const categoryStats = useMemo(() => {
    const map = new Map<string, { players: TicketRow[]; companions: TicketRow[]; minors: TicketRow[] }>()

    for (const cat of CATEGORIES) {
      map.set(cat, { players: [], companions: [], minors: [] })
    }
    map.set('Sin Categoría', { players: [], companions: [], minors: [] })

    tickets.forEach(ticket => {
      if (ticket.status === 'cancelled') return
      const { role, category } = parseTicketInfo(ticket)
      const targetCat = map.has(category) ? category : 'Sin Categoría'
      const entry = map.get(targetCat)!
      if (role === 'jugador') entry.players.push(ticket)
      else if (role === 'menor') entry.minors.push(ticket)
      else entry.companions.push(ticket)
    })

    const list: Array<{
      category: string
      players: TicketRow[]
      companions: TicketRow[]
      minors: TicketRow[]
      totalAttendees: number
      checkedIn: number
      pending: number
    }> = []

    map.forEach((entry, cat) => {
      const totalAttendees = entry.players.length + entry.companions.length + entry.minors.length
      if (totalAttendees > 0 || cat !== 'Sin Categoría') {
        const allCategoryTickets = [...entry.players, ...entry.companions, ...entry.minors]
        const checkedIn = allCategoryTickets.filter(t => t.status === 'used' || !!t.checked_in_at).length
        list.push({
          category: cat,
          players: entry.players,
          companions: entry.companions,
          minors: entry.minors,
          totalAttendees,
          checkedIn,
          pending: totalAttendees - checkedIn
        })
      }
    })

    return list
  }, [tickets])

  // Totales generales para el conteo
  const padronTotals = useMemo(() => {
    let totalPlayers = 0
    let totalCompanions = 0
    let totalMinors = 0
    let totalAttendees = 0
    let totalCheckedIn = 0

    categoryStats.forEach(cs => {
      totalPlayers += cs.players.length
      totalCompanions += cs.companions.length
      totalMinors += cs.minors.length
      totalAttendees += cs.totalAttendees
      totalCheckedIn += cs.checkedIn
    })

    return {
      totalPlayers,
      totalCompanions,
      totalMinors,
      totalAttendees,
      totalCheckedIn,
      totalPending: totalAttendees - totalCheckedIn
    }
  }, [categoryStats])

  const toggleCategoryExpand = (cat: string) => {
    setExpandedCategories(prev => ({
      ...prev,
      [cat]: prev[cat] === undefined ? false : !prev[cat]
    }))
  }

  // Descarga en formato CSV / Excel
  const handleDownloadCsv = () => {
    const headers = [
      'Categoría',
      'Rol',
      'Nombre Asistente',
      'Nro Entrada / Sorteo',
      'Titular Pedido',
      'DNI Titular',
      'Teléfono Titular',
      'Email Titular',
      'Estado Ingreso',
      'Hora Ingreso'
    ]

    const rows = [headers]

    categoryStats.forEach(cs => {
      const allCat = [...cs.players, ...cs.companions, ...cs.minors]
      allCat.forEach(ticket => {
        const { cleanName, role, category } = parseTicketInfo(ticket)
        const order = orders.find(o => o.id === ticket.order_id)
        const isPlayer = isPlayerTicket(ticket)
        const ticketNum = role === 'menor' ? 'MENOR' : isPlayer ? 'JUGADOR' : (getTicketDisplayNumber(ticket) || '')
        const checkinStatus = (ticket.status === 'used' || !!ticket.checked_in_at) ? 'INGRESÓ' : 'SIN INGRESAR'
        const checkinTime = ticket.checked_in_at ? new Date(ticket.checked_in_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : ''

        rows.push([
          category,
          role.toUpperCase(),
          cleanName,
          ticketNum,
          order?.buyer_full_name || '',
          order?.buyer_dni || '',
          order?.buyer_phone || '',
          order?.buyer_email || '',
          checkinStatus,
          checkinTime
        ])
      })
    })

    const csvContent = '\uFEFF' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `padron_conteo_atsc_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setActionFeedback({ message: '¡Planilla CSV descargada exitosamente!', success: true })
  }

  // Copiar resumen al portapapeles para WhatsApp
  const handleCopyPadronWhatsApp = () => {
    let msg = `📊 *REPORTE DE CONTEO - CENA ANDES TALLERES 2026*\n`
    msg += `📅 *Fecha:* ${new Date().toLocaleDateString('es-AR')} ${new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} hs\n\n`
    msg += `*TOTAL ASISTENTES:* ${padronTotals.totalAttendees}\n`
    msg += `⚽ Jugadores: ${padronTotals.totalPlayers}\n`
    msg += `🎟️ Acompañantes: ${padronTotals.totalCompanions}\n`
    msg += `👶 Menores <3 años: ${padronTotals.totalMinors}\n`
    msg += `🟢 Ingresados en puerta: ${padronTotals.totalCheckedIn} / ${padronTotals.totalAttendees}\n\n`
    msg += `📋 *DESGLOSE POR CATEGORÍA:*\n`
    categoryStats.forEach(cs => {
      if (cs.totalAttendees > 0) {
        msg += `▪️ *${cs.category}:* ${cs.totalAttendees} total (⚽ ${cs.players.length} jug · 🎟️ ${cs.companions.length} acomp${cs.minors.length > 0 ? ` · 👶 ${cs.minors.length} men` : ''}) - Presentes: ${cs.checkedIn}\n`
      }
    })
    navigator.clipboard.writeText(msg)
    setActionFeedback({ message: '¡Resumen de conteo copiado para WhatsApp!', success: true })
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

  // Participantes elegibles para sorteo (acompañantes online + entradas físicas del talonario)
  const raffleParticipants = useMemo<RaffleParticipant[]>(() => {
    // 1. Entradas online (acompañantes con número de sorteo)
    const companionTickets = tickets.filter(t => !isPlayerTicket(t) && t.status !== 'cancelled')
    const onlineList: RaffleParticipant[] = companionTickets.map(ticket => {
      const ticketNumber = getTicketDisplayNumber(ticket) || '---'
      const order = orders.find(o => o.id === ticket.order_id)
      const isCheckedIn = ticket.status === 'used' || !!ticket.checked_in_at
      return {
        ticket,
        ticketNumber,
        order,
        isCheckedIn,
        isPhysical: false
      }
    })

    // 2. Entradas físicas vendidas en mano (talonario ej: 1000..1024)
    const physicalList: RaffleParticipant[] = []
    const totalPhysicalToInclude = Math.min(
      Math.max(0, physicalConfig.soldCount),
      Math.max(0, physicalConfig.endNumber - physicalConfig.startNumber + 1)
    )

    for (let i = 0; i < totalPhysicalToInclude; i++) {
      const num = physicalConfig.startNumber + i
      const numStr = String(num)
      physicalList.push({
        ticket: {
          id: `physical-${num}`,
          ticket_number: num,
          attendee_name: `Talonario Físico N° ${numStr}`,
          qr_token: `physical-${num}`,
          status: 'used',
          created_at: new Date().toISOString(),
          order_id: 'fisica',
        },
        ticketNumber: numStr,
        order: undefined,
        isCheckedIn: true,
        isPhysical: true
      })
    }

    return [...onlineList, ...physicalList]
  }, [tickets, orders, ticketNumberMap, physicalConfig])

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

  // Verificar sesión al montar
  useEffect(() => {
    try {
      const saved = localStorage.getItem('atsc_admin_session_v2')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed.role === 'superuser' || parsed.role === 'staff') {
          setUserRole(parsed.role)
          setUserEmail(parsed.username || (parsed.role === 'superuser' ? 'admin' : 'puerta'))
          setSignedIn(true)
          return
        }
      }
    } catch {}

    // Fallback Supabase session y listener reactivo
    if (supabase) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) {
          setUserRole('superuser')
          setSignedIn(true)
          setUserEmail(session.user.email || null)
        }
      })
      const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session?.user) {
          setUserRole('superuser')
          setSignedIn(true)
          setUserEmail(session.user.email || null)
        }
      })
      return () => {
        authListener?.subscription?.unsubscribe()
      }
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

  // Login simplificado con Usuario y Contraseña para Super Usuario y Control de Puerta
  async function handleAuthLogin(e: React.FormEvent) {
    e.preventDefault()
    setAuthError('')
    setLoading(true)

    const u = usernameInput.trim().toLowerCase()
    const p = passwordInput.trim()

    // 1. Super Usuario (acceso total: escáner, talonario físico, sorteos, padrón y conteo con PDF, tickets y pedidos)
    const isSuperUser =
      (u === 'admin' || u === 'superadmin' || u === 'admin@atsc.com' || u === 'atsc') &&
      (p === 'atsc2026' || p === 'admin' || p === 'admin2026')

    // 2. Control en Puerta / Staff (solo puede escanear entradas o validar presencial en puerta)
    const isStaffUser =
      (u === 'puerta' || u === 'control' || u === 'staff' || u === 'entrada' || u === 'puerta@atsc.com') &&
      (p === 'puerta2026' || p === 'puerta' || p === 'control' || p === 'staff' || p === 'atsc2026')

    if (isSuperUser) {
      setUserRole('superuser')
      setUserEmail('Super Administrador')
      setSignedIn(true)
      setActiveTab('scanner')
      try {
        localStorage.setItem(
          'atsc_admin_session_v2',
          JSON.stringify({ role: 'superuser', username: 'Super Administrador', timestamp: Date.now() })
        )
      } catch {}
      setLoading(false)
      return
    }

    if (isStaffUser) {
      setUserRole('staff')
      setUserEmail('Control de Puerta')
      setSignedIn(true)
      setActiveTab('scanner')
      try {
        localStorage.setItem(
          'atsc_admin_session_v2',
          JSON.stringify({ role: 'staff', username: 'Control de Puerta', timestamp: Date.now() })
        )
      } catch {}
      setLoading(false)
      return
    }

    // 3. Fallback opcional Supabase Auth si se ingresó un correo real
    if (supabase && u.includes('@')) {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: usernameInput.trim(),
          password: passwordInput,
        })
        const authUser = data?.session?.user || data?.user
        if (!error && authUser) {
          const email = authUser.email || usernameInput.trim()
          setUserRole('superuser')
          setUserEmail(email)
          setSignedIn(true)
          setActiveTab('scanner')
          try {
            localStorage.setItem(
              'atsc_admin_session_v2',
              JSON.stringify({ role: 'superuser', username: email, timestamp: Date.now() })
            )
          } catch {}
          setLoading(false)
          return
        }
        if (error) {
          setLoading(false)
          setAuthError(error.message || 'Error al autenticar en Supabase.')
          return
        }
      } catch (err: any) {
        setLoading(false)
        setAuthError(err?.message || 'Error de conexión con el servidor de autenticación.')
        return
      }
    }

    setLoading(false)
    setAuthError('Usuario o contraseña incorrectos. Verificá los datos ingresados.')
  }

  async function handleSignOut() {
    stopScanner()
    try {
      localStorage.removeItem('atsc_admin_session_v2')
    } catch {}
    if (supabase) {
      try {
        await supabase.auth.signOut()
      } catch {}
    }
    setUserRole(null)
    setSignedIn(false)
    setUserEmail(null)
    setOrders([])
    setTickets([])
    setUsernameInput('')
    setPasswordInput('')
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
      try {
        await supabase
          .from('tickets')
          .update({ status: 'used', checked_in_at: checkInTime })
          .eq('id', ticket.id)
      } catch (err) {
        console.warn('Error al actualizar check-in en DB:', err)
      }
    }
    setTickets(prev =>
      prev.map(t => (t.id === ticket.id ? { ...t, status: 'used', checked_in_at: checkInTime } : t))
    )
    playBeep(true)
  }

  // Check-in masivo para todas las entradas pendientes de un pedido/DNI
  async function handleCheckInAllForOrder(orderTickets: TicketRow[]) {
    const validTickets = orderTickets.filter(t => t.status !== 'used')
    if (validTickets.length === 0) return
    const checkInTime = new Date().toISOString()
    const validIds = validTickets.map(t => t.id)

    if (supabase) {
      try {
        await supabase
          .from('tickets')
          .update({ status: 'used', checked_in_at: checkInTime })
          .in('id', validIds)
      } catch (err) {
        console.warn('Error al actualizar check-in múltiple:', err)
      }
    }

    setTickets(prev =>
      prev.map(t => (validIds.includes(t.id) ? { ...t, status: 'used', checked_in_at: checkInTime } : t))
    )
    playBeep(true)
  }

  // Revertir check-in
  async function handleRevertCheckIn(ticket: TicketRow) {
    if (supabase) {
      try {
        await supabase
          .from('tickets')
          .update({ status: 'valid', checked_in_at: null })
          .eq('id', ticket.id)
      } catch (err) {
        console.warn('Error al revertir check-in en DB:', err)
      }
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



  const money = (n: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

  // ═════════════════════════════════════════════════════════════════
  // PANTALLA DE LOGIN AL PANEL (SUPER USUARIO O CONTROL EN PUERTA)
  // ═════════════════════════════════════════════════════════════════
  if (!signedIn) {
    return (
      <main className="admin-wrap">
        <div className="admin-login" style={{ maxWidth: '440px' }}>
          <div className="admin-header-logo">
            <ClubLogo url={clubLogo} size="md" />
            <div>
              <p className="admin-kicker">CONTROL DE ACCESO & ADMINISTRACIÓN</p>
              <h1>Panel de Control ATSC</h1>
            </div>
          </div>

          <form onSubmit={handleAuthLogin} className="login-form" noValidate>
            <label>
              Usuario
              <input
                type="text"
                value={usernameInput}
                onChange={e => setUsernameInput(e.target.value)}
                required
                autoFocus
                placeholder="Ingresá tu usuario"
                autoCapitalize="none"
                autoCorrect="off"
              />
            </label>

            <label>
              Contraseña
              <input
                type="password"
                value={passwordInput}
                onChange={e => setPasswordInput(e.target.value)}
                required
                placeholder="••••••••"
              />
            </label>

            {authError && <p className="admin-error">{authError}</p>}

            <button className="admin-primary" disabled={loading} type="submit">
              {loading ? (
                <>
                  <RefreshCw size={16} className="spinner" /> Accediendo...
                </>
              ) : (
                <>
                  <LockKeyhole size={16} /> Iniciar Sesión
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
      const order = orderMap.get(t.order_id)
      const buyerDni = (order?.buyer_dni || '').toLowerCase().trim()
      const buyerName = (order?.buyer_full_name || '').toLowerCase()

      const matchesSearch =
        !q ||
        t.attendee_name?.toLowerCase().includes(q) ||
        buyerDni.includes(q) ||
        buyerName.includes(q) ||
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
          {userRole === 'superuser' ? (
            <span style={{ fontSize: '12px', color: '#fbbf24', padding: '6px 12px', background: 'rgba(251, 191, 36, 0.1)', borderRadius: '6px', border: '1px solid rgba(251, 191, 36, 0.3)', fontWeight: 700 }}>
              👑 Super Usuario {userEmail ? `(${userEmail})` : '(Acceso Total)'}
            </span>
          ) : (
            <span style={{ fontSize: '12px', color: '#38bdf8', padding: '6px 12px', background: 'rgba(56, 189, 248, 0.1)', borderRadius: '6px', border: '1px solid rgba(56, 189, 248, 0.3)', fontWeight: 700 }}>
              🚪 Control en Puerta {userEmail ? `(${userEmail})` : ''}
            </span>
          )}
          {userRole === 'superuser' && (
            <button
              className="btn-dash-primary"
              onClick={() => setActiveTab('presencial')}
              title="Configurar entradas vendidas del talonario físico para el sorteo"
              style={{ background: 'linear-gradient(135deg, #fbbf24 0%, #d97706 100%)', color: '#070e1a', fontWeight: 700 }}
            >
              <Ticket size={15} /> Talonario Físico ({physicalConfig.soldCount})
            </button>
          )}
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
        {userRole === 'superuser' && (
          <article className="stat-card">
            <span>RECAUDACIÓN PAGADA</span>
            <strong className="text-green">{money(totalRevenue)}</strong>
            <small>{pendingOrders} transferencias pendientes</small>
          </article>
        )}
        <article className="stat-card">
          <span>FALTANTES POR INGRESAR</span>
          <strong>{Math.max(0, totalTicketsIssued - totalCheckedIn)}</strong>
          <small>Asistentes restantes</small>
        </article>
      </section>

      {/* Tabs Principales */}
      <div className="dash-tabs no-print">
        <button
          className={activeTab === 'scanner' ? 'active tab-scanner-highlight' : ''}
          onClick={() => setActiveTab('scanner')}
        >
          <Camera size={18} /> Escáner de Cámara QR
        </button>
        <button
          className={activeTab === 'tickets' ? 'active' : ''}
          onClick={() => setActiveTab('tickets')}
        >
          <Ticket size={18} /> Listado de Entradas ({tickets.length})
        </button>
        {userRole === 'superuser' && (
          <>
            <button
              className={activeTab === 'presencial' ? 'active tab-presencial-highlight' : ''}
              onClick={() => setActiveTab('presencial')}
            >
              <Ticket size={18} /> 🎟️ Talonario Físico ({physicalConfig.soldCount})
            </button>
            <button
              className={activeTab === 'sorteo' ? 'active tab-sorteo-highlight' : ''}
              onClick={() => setActiveTab('sorteo')}
            >
              <Gift size={18} /> Sorteo de Entradas
            </button>
            <button
              className={activeTab === 'padron' ? 'active tab-padron-highlight' : ''}
              onClick={() => setActiveTab('padron')}
            >
              <FileText size={18} /> 📋 Padrón y Conteo
            </button>
            <button
              className={activeTab === 'orders' ? 'active' : ''}
              onClick={() => setActiveTab('orders')}
            >
              <Users size={18} /> Pedidos y Compradores ({orders.length})
            </button>
          </>
        )}
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

              {/* ── Búsqueda de Entradas por DNI (Validación en Puerta) ── */}
              <div className="dni-search-card">
                <div className="dni-search-header">
                  <div className="dni-search-title-wrap">
                    <div className="dni-search-icon-badge">
                      <Search size={18} />
                    </div>
                    <div>
                      <h3>Búsqueda de Entradas por DNI</h3>
                      <p>Consultá el DNI del comprador para ver todas sus entradas y registrar su ingreso</p>
                    </div>
                  </div>
                </div>

                <div className="dni-search-bar">
                  <div className="dni-input-wrapper">
                    <Search size={16} className="dni-input-icon" />
                    <input
                      type="text"
                      className="dni-search-input"
                      placeholder="Ingresá número de DNI o apellido (ej: 38123456)..."
                      value={dniSearch}
                      onChange={e => setDniSearch(e.target.value)}
                      autoComplete="off"
                    />
                    {dniSearch && (
                      <button
                        type="button"
                        className="btn-clear-dni"
                        onClick={() => setDniSearch('')}
                        title="Limpiar búsqueda"
                      >
                        <X size={15} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Resultados de la búsqueda */}
                {dniSearchClean.length >= 2 ? (
                  <div className="dni-results-wrap animate-fade">
                    {dniSearchResults.length > 0 ? (
                      <div className="dni-groups-list">
                        {dniSearchResults.map(group => {
                          const usedCount = group.tickets.filter(t => t.status === 'used' || !!t.checked_in_at).length
                          const pendingTickets = group.tickets.filter(t => t.status !== 'used' && !t.checked_in_at)
                          const isPaid = group.orderStatus === 'pagado'

                          return (
                            <div key={group.orderId} className="dni-order-group">
                              <div className="dni-order-header">
                                <div className="dni-order-buyer-info">
                                  <div className="dni-buyer-name-row">
                                    <span className="dni-buyer-name">{group.buyerName}</span>
                                    <span className={`dni-payment-badge ${isPaid ? 'badge-paid' : 'badge-pending'}`}>
                                      {isPaid ? '✅ Pagado' : '⚠️ Pendiente'}
                                    </span>
                                  </div>
                                  <div className="dni-buyer-details">
                                    <span>🪪 <b>DNI:</b> {group.buyerDni}</span>
                                    {group.buyerPhone && <span>📱 {group.buyerPhone}</span>}
                                    <span className="dni-count-badge">
                                      🎟️ {group.tickets.length} {group.tickets.length === 1 ? 'entrada' : 'entradas'} ({usedCount} ingresadas)
                                    </span>
                                  </div>
                                </div>

                                {pendingTickets.length > 1 && (
                                  <button
                                    type="button"
                                    className="btn-checkin-all"
                                    onClick={() => void handleCheckInAllForOrder(group.tickets)}
                                    title="Marcar ingreso para todas las entradas pendientes de este grupo"
                                  >
                                    <Check size={14} /> Ingresar todas ({pendingTickets.length})
                                  </button>
                                )}
                              </div>

                              <div className="dni-tickets-list">
                                {group.tickets.map((t, idx) => {
                                  const isCheckedIn = t.status === 'used' || !!t.checked_in_at
                                  const isPlayer = isPlayerTicket(t)
                                  const displayNum = isPlayer ? 'JUGADOR' : (getTicketDisplayNumber(t) || `#${idx + 1}`)
                                  const checkInTime = t.checked_in_at
                                    ? new Date(t.checked_in_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
                                    : ''

                                  return (
                                    <div
                                      key={t.id}
                                      className={`dni-ticket-card ${isCheckedIn ? 'ticket-is-used' : 'ticket-is-valid'}`}
                                    >
                                      <div className="dni-ticket-left">
                                        <div className="dni-ticket-attendee">
                                          <span className="attendee-name">{t.attendee_name || 'Asistente'}</span>
                                          <span className={`ticket-type-pill ${isPlayer ? 'pill-player' : 'pill-companion'}`}>
                                            🎟️ {displayNum}
                                          </span>
                                        </div>
                                        <div className="dni-ticket-meta">
                                          <span className="ticket-token">Token: {t.qr_token.slice(0, 8)}...</span>
                                        </div>
                                      </div>

                                      <div className="dni-ticket-right">
                                        {isCheckedIn ? (
                                          <div className="dni-status-used-wrap">
                                            <span className="status-badge-used">
                                              🟢 INGRESÓ {checkInTime ? `(${checkInTime} hs)` : ''}
                                            </span>
                                            <button
                                              type="button"
                                              className="btn-dni-revert"
                                              onClick={() => void handleRevertCheckIn(t)}
                                              title="Deshacer ingreso"
                                            >
                                              <RotateCcw size={12} /> Deshacer
                                            </button>
                                          </div>
                                        ) : (
                                          <div className="dni-status-valid-wrap">
                                            <span className="status-badge-pending">⏳ SIN INGRESAR</span>
                                            <button
                                              type="button"
                                              className="btn-dni-checkin"
                                              onClick={() => void handleManualCheckIn(t)}
                                            >
                                              <Check size={14} /> Marcar Ingreso
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="dni-no-results">
                        <AlertTriangle size={22} className="no-res-icon" />
                        <div>
                          <p className="no-res-title">No se encontraron entradas con "{dniSearch}"</p>
                          <p className="no-res-sub">
                            Verificá que el número de DNI esté bien escrito o revisá en las pestañas <b>Padrón</b> o <b>Tickets</b>.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="dni-search-hint">
                    <p>
                      💡 <b>Tip de control en puerta:</b> Si un asistente no tiene el QR o no le funciona la pantalla del celular, ingresá su número de DNI acá arriba para validar su entrada y la de sus acompañantes.
                    </p>
                  </div>
                )}

                {/* Verificación por Token plano (código de barra / manual) */}
                <div className="manual-checkin-fallback">
                  <details>
                    <summary>¿Querés ingresar manualmente un código alfanumérico o token QR?</summary>
                    <div className="manual-input-row" style={{ marginTop: '10px' }}>
                      <input
                        type="text"
                        placeholder="Pegar token de QR o UUID..."
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
                        Validar Token
                      </button>
                    </div>
                  </details>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ══════════════════════════════════════════════════════════════
          TAB: VENTA PRESENCIAL DE ENTRADAS EN PUERTA
         ══════════════════════════════════════════════════════════════ */}
      {userRole === 'superuser' && activeTab === 'presencial' && (
        <section className="presencial-section animate-fade">
          <div className="presencial-container" style={{ maxWidth: '960px', margin: '0 auto', padding: '0 16px' }}>
            <div style={{ background: '#0b1626', border: '1px solid #1c3252', borderRadius: '14px', padding: '28px', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
              {/* Encabezado */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #1c3252', paddingBottom: '18px', marginBottom: '22px', flexWrap: 'wrap', gap: '14px' }}>
                <div>
                  <span style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '1px', color: '#fbbf24', textTransform: 'uppercase', background: 'rgba(251, 191, 36, 0.12)', padding: '3px 10px', borderRadius: '20px', border: '1px solid rgba(251, 191, 36, 0.3)' }}>
                    SORTEO ATSC · TALONARIO FÍSICO
                  </span>
                  <h2 style={{ fontFamily: 'Oswald, sans-serif', fontSize: '26px', color: '#fff', margin: '8px 0 4px', letterSpacing: '0.5px' }}>
                    🎟️ Rango de Entradas Físicas (Venta Presencial)
                  </h2>
                  <p style={{ color: '#8a9ab5', fontSize: '13px', margin: 0, lineHeight: 1.4 }}>
                    Definí el rango del talonario impreso (ej: 1000 al 1100) y marcá cuántas vendiste. Esos números entran automáticamente al bombo de la ruleta.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-dash-primary"
                  style={{ background: 'linear-gradient(135deg, #fbbf24 0%, #d97706 100%)', color: '#070e1a', fontWeight: 800, padding: '10px 18px' }}
                  onClick={() => setActiveTab('sorteo')}
                >
                  <Gift size={16} /> Ir a la Ruleta del Sorteo
                </button>
              </div>

              {/* Tarjetas de Rango y Cantidad Vendida */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '20px' }}>
                <div style={{ background: '#070f1a', border: '1px solid #182d49', borderRadius: '10px', padding: '16px' }}>
                  <label style={{ fontSize: '12px', color: '#8a9ab5', fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>
                    1. Número Inicial del Talonario
                  </label>
                  <input
                    type="number"
                    min="1"
                    className="attendee-text-input"
                    style={{ width: '100%', fontSize: '18px', fontWeight: 700, fontFamily: 'monospace' }}
                    value={physicalConfig.startNumber}
                    onChange={e => handleUpdateStartNumber(parseInt(e.target.value, 10))}
                  />
                  <small style={{ color: '#627d98', fontSize: '11px', display: 'block', marginTop: '6px' }}>
                    Primer número de tu talonario físico (ej: 1000)
                  </small>
                </div>

                <div style={{ background: '#070f1a', border: '1px solid #182d49', borderRadius: '10px', padding: '16px' }}>
                  <label style={{ fontSize: '12px', color: '#8a9ab5', fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>
                    2. Número Final del Talonario
                  </label>
                  <input
                    type="number"
                    min={physicalConfig.startNumber}
                    className="attendee-text-input"
                    style={{ width: '100%', fontSize: '18px', fontWeight: 700, fontFamily: 'monospace' }}
                    value={physicalConfig.endNumber}
                    onChange={e => handleUpdateEndNumber(parseInt(e.target.value, 10))}
                  />
                  <small style={{ color: '#627d98', fontSize: '11px', display: 'block', marginTop: '6px' }}>
                    Lote total: {physicalTotalLot} entradas impresas
                  </small>
                </div>

                <div style={{ background: '#070f1a', border: '1px solid rgba(251, 191, 36, 0.45)', borderRadius: '10px', padding: '16px', boxShadow: '0 0 16px rgba(251, 191, 36, 0.1)' }}>
                  <label style={{ fontSize: '12px', color: '#fbbf24', fontWeight: 800, textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>
                    3. Cantidad Vendida (Participan)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max={physicalTotalLot}
                    className="attendee-text-input"
                    style={{ width: '100%', fontSize: '22px', fontWeight: 800, color: '#fbbf24', fontFamily: 'monospace' }}
                    value={physicalConfig.soldCount}
                    onChange={e => handleUpdateSoldCount(parseInt(e.target.value, 10))}
                  />
                  <small style={{ color: '#8a9ab5', fontSize: '11px', display: 'block', marginTop: '6px' }}>
                    {physicalConfig.soldCount > 0
                      ? `🎯 Participan del #${physicalConfig.startNumber} al #${physicalConfig.startNumber + physicalConfig.soldCount - 1}`
                      : '0 vendidas (ninguna participa aún)'}
                  </small>
                </div>
              </div>

              {/* Botones de Ajuste Rápido */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '22px', background: '#070e19', padding: '12px 16px', borderRadius: '8px', border: '1px solid #142742' }}>
                <span style={{ fontSize: '12px', color: '#8a9ab5', fontWeight: 600, marginRight: '4px' }}>Ajuste rápido:</span>
                <button type="button" className="btn-dash-outline" style={{ padding: '5px 10px', fontSize: '12px' }} onClick={() => handleAdjustSoldCount(-10)}>-10</button>
                <button type="button" className="btn-dash-outline" style={{ padding: '5px 10px', fontSize: '12px' }} onClick={() => handleAdjustSoldCount(-5)}>-5</button>
                <button type="button" className="btn-dash-outline" style={{ padding: '5px 10px', fontSize: '12px' }} onClick={() => handleAdjustSoldCount(-1)}>-1</button>
                <button type="button" className="btn-dash-outline" style={{ padding: '5px 12px', fontSize: '12px', color: '#00d2b4', borderColor: '#00d2b4' }} onClick={() => handleAdjustSoldCount(1)}>+1</button>
                <button type="button" className="btn-dash-outline" style={{ padding: '5px 12px', fontSize: '12px', color: '#00d2b4', borderColor: '#00d2b4' }} onClick={() => handleAdjustSoldCount(5)}>+5</button>
                <button type="button" className="btn-dash-outline" style={{ padding: '5px 12px', fontSize: '12px', color: '#00d2b4', borderColor: '#00d2b4' }} onClick={() => handleAdjustSoldCount(10)}>+10</button>
                <button type="button" className="btn-dash-outline" style={{ padding: '5px 14px', fontSize: '12px', color: '#fbbf24', borderColor: '#fbbf24' }} onClick={handleSetAllSold}>Marcar todo el talonario</button>
                <button type="button" className="btn-dash-outline" style={{ padding: '5px 10px', fontSize: '12px', color: '#ef4444', borderColor: '#ef4444', marginLeft: 'auto' }} onClick={() => handleUpdateSoldCount(0)}>Poner en 0</button>
              </div>

              {/* Estadísticas de Composición del Sorteo */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '22px' }}>
                <div style={{ background: 'rgba(251, 191, 36, 0.08)', border: '1px solid rgba(251, 191, 36, 0.25)', borderRadius: '8px', padding: '14px 16px' }}>
                  <span style={{ fontSize: '11px', color: '#fbbf24', fontWeight: 700, display: 'block' }}>FÍSICAS EN EL SORTEO</span>
                  <strong style={{ fontSize: '26px', color: '#fff', fontFamily: 'Oswald, sans-serif' }}>{physicalConfig.soldCount}</strong>
                  <span style={{ fontSize: '11px', color: '#8a9ab5', display: 'block', marginTop: '2px' }}>
                    {physicalConfig.soldCount > 0 ? `#${physicalConfig.startNumber} al #${physicalConfig.startNumber + physicalConfig.soldCount - 1}` : 'Sin ventas'}
                  </span>
                </div>
                <div style={{ background: 'rgba(0, 210, 180, 0.08)', border: '1px solid rgba(0, 210, 180, 0.25)', borderRadius: '8px', padding: '14px 16px' }}>
                  <span style={{ fontSize: '11px', color: '#00d2b4', fontWeight: 700, display: 'block' }}>ONLINE EN EL SORTEO</span>
                  <strong style={{ fontSize: '26px', color: '#fff', fontFamily: 'Oswald, sans-serif' }}>{tickets.filter(t => !isPlayerTicket(t) && t.status !== 'cancelled').length}</strong>
                  <span style={{ fontSize: '11px', color: '#8a9ab5', display: 'block', marginTop: '2px' }}>Acompañantes web</span>
                </div>
                <div style={{ background: 'rgba(217, 39, 54, 0.12)', border: '1px solid rgba(217, 39, 54, 0.35)', borderRadius: '8px', padding: '14px 16px' }}>
                  <span style={{ fontSize: '11px', color: '#ff6b77', fontWeight: 700, display: 'block' }}>TOTAL EN EL BOMBO</span>
                  <strong style={{ fontSize: '26px', color: '#fff', fontFamily: 'Oswald, sans-serif' }}>{raffleParticipants.length}</strong>
                  <span style={{ fontSize: '11px', color: '#8a9ab5', display: 'block', marginTop: '2px' }}>Números listos para girar</span>
                </div>
                <div style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.25)', borderRadius: '8px', padding: '14px 16px' }}>
                  <span style={{ fontSize: '11px', color: '#10b981', fontWeight: 700, display: 'block' }}>RECAUDACIÓN EN MANO</span>
                  <strong style={{ fontSize: '26px', color: '#fff', fontFamily: 'Oswald, sans-serif' }}>{money(physicalConfig.soldCount * unitPrice)}</strong>
                  <span style={{ fontSize: '11px', color: '#8a9ab5', display: 'block', marginTop: '2px' }}>{money(unitPrice)} por entrada</span>
                </div>
              </div>

              {/* Visualizador de Números del Talonario */}
              <div style={{ background: '#070e19', border: '1px solid #142742', borderRadius: '10px', padding: '18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>
                    Visualizador de Boletos ({physicalTotalLot} números en el rango):
                  </span>
                  <div style={{ display: 'flex', gap: '14px', fontSize: '11px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#fbbf24' }}>
                      <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#fbbf24', display: 'inline-block' }}></span>
                      Vendido (En el sorteo)
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#627d98' }}>
                      <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#1c3252', display: 'inline-block' }}></span>
                      Sin vender
                    </span>
                  </div>
                </div>

                <p style={{ fontSize: '11px', color: '#8a9ab5', margin: '0 0 14px' }}>
                  💡 <em>Podés hacer clic sobre cualquier número para marcar como vendidos todos los números hasta ese boleto inclusive.</em>
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(68px, 1fr))', gap: '6px', maxHeight: '280px', overflowY: 'auto', paddingRight: '6px' }}>
                  {Array.from({ length: Math.min(300, physicalTotalLot) }, (_, idx) => {
                    const num = physicalConfig.startNumber + idx;
                    const isSold = idx < physicalConfig.soldCount;
                    return (
                      <button
                        key={num}
                        type="button"
                        onClick={() => handleUpdateSoldCount(idx + 1)}
                        title={isSold ? `N° ${num} Vendido (Participa del sorteo). Clic para ajustar hasta aquí.` : `N° ${num} No vendido. Clic para marcar hasta aquí.`}
                        style={{
                          background: isSold ? 'rgba(251, 191, 36, 0.15)' : '#070f1a',
                          border: isSold ? '1px solid #fbbf24' : '1px solid #182d49',
                          color: isSold ? '#fbbf24' : '#627d98',
                          borderRadius: '5px',
                          padding: '6px 2px',
                          fontSize: '12px',
                          fontFamily: 'monospace',
                          fontWeight: isSold ? 'bold' : 'normal',
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                        }}
                      >
                        {num}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
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
                placeholder="Buscar por DNI, asistente, titular, token o N°..."
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
              {userRole === 'superuser' && (
                <button
                  type="button"
                  className="btn-dash-outline"
                  style={{ borderColor: 'rgba(251, 191, 36, 0.4)', color: '#fbbf24', marginLeft: 'auto' }}
                  onClick={() => setActiveTab('sorteo')}
                  title="Abrir la ruleta / sorteador de números de entradas"
                >
                  <Gift size={15} /> Ir al Sorteo
                </button>
              )}
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
                      {/menor/i.test(ticket.attendee_name || '') ? (
                        <span className="ticket-badge-player" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.3)' }}>
                          👶 Menor &lt;3 años ($0)
                        </span>
                      ) : isPlayerTicket(ticket) ? (
                        <span className="ticket-badge-player">
                          ⚽ Jugador (Sin sorteo)
                        </span>
                      ) : (
                        <span className="ticket-badge-number">
                          🎟️ N° {getTicketDisplayNumber(ticket)}
                        </span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <strong>{ticket.attendee_name}</strong>
                        {(() => {
                          const order = orderMap.get(ticket.order_id)
                          if (!order) return null
                          return (
                            <span style={{ fontSize: '11px', color: '#8496ad', marginTop: '3px' }}>
                              DNI: <strong style={{ color: '#cbd5e1' }}>{order.buyer_dni || '—'}</strong>
                              {order.buyer_full_name && order.buyer_full_name.trim().toLowerCase() !== ticket.attendee_name.trim().toLowerCase() && (
                                <span style={{ color: '#627d98' }}> · Titular: {order.buyer_full_name}</span>
                              )}
                            </span>
                          )
                        })()}
                      </div>
                    </td>
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
      {userRole === 'superuser' && activeTab === 'orders' && (
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
      {userRole === 'superuser' && activeTab === 'sorteo' && (
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

            {/* Resumen rápido de origen de entradas en sorteo */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(6, 13, 23, 0.75)', border: '1px solid #142742', borderRadius: '8px', padding: '10px 16px', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '13px', flexWrap: 'wrap' }}>
                <span style={{ color: '#8a9ab5' }}>
                  🌐 Web Online: <strong style={{ color: '#00d2b4' }}>{tickets.filter(t => !isPlayerTicket(t) && t.status !== 'cancelled').length}</strong>
                </span>
                <span style={{ color: '#8a9ab5' }}>
                  🎟️ Talonario Físico: <strong style={{ color: '#fbbf24' }}>{physicalConfig.soldCount}</strong> {physicalConfig.soldCount > 0 && <small style={{ color: '#627d98' }}>(#{physicalConfig.startNumber}-#{physicalConfig.startNumber + physicalConfig.soldCount - 1})</small>}
                </span>
                <span style={{ color: '#ffffff' }}>
                  🎰 Total Habilitadas: <strong style={{ color: '#ff6b77', fontSize: '15px' }}>{eligibleParticipants.length}</strong>
                </span>
              </div>
              <button
                type="button"
                className="btn-dash-outline"
                style={{ padding: '4px 10px', fontSize: '11px', color: '#fbbf24', borderColor: 'rgba(251, 191, 36, 0.4)' }}
                onClick={() => setActiveTab('presencial')}
              >
                ⚙️ Ajustar Talonario Físico
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
                  Participan <strong>{eligibleParticipants.length}</strong> entradas en este sorteo
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
                {currentWinner.isPhysical ? (
                  <>
                    <div className="winner-detail-col">
                      <label>Tipo de Entrada</label>
                      <strong style={{ color: '#fbbf24', fontSize: '16px' }}>🎟️ Boleto Físico (Talonario)</strong>
                      <span>Número en mano: <b>N° {currentWinner.ticketNumber}</b></span>
                    </div>

                    <div className="winner-detail-col">
                      <label>Presencia en el Salón</label>
                      <div className="winner-attendance-status winner-att-present">
                        <CheckCircle2 size={14} /> VENTA EN MANO (PRESENTE)
                      </div>
                    </div>

                    <div className="winner-detail-col" style={{ gridColumn: 'span 2' }}>
                      <label>Instrucciones de Entrega</label>
                      <div style={{ background: 'rgba(251, 191, 36, 0.1)', border: '1px solid rgba(251, 191, 36, 0.35)', borderRadius: '6px', padding: '10px 14px', color: '#fef3c7', fontSize: '13px' }}>
                        🎫 <strong>¡Atención en el salón!</strong> El ganador debe exhibir su entrada física con el <strong>N° {currentWinner.ticketNumber}</strong> para reclamar el premio.
                      </div>
                    </div>
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </div>

              <div className="winner-actions-bar">
                {!currentWinner.isPhysical && currentWinner.order?.buyer_phone && (
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
                    const text = currentWinner.isPhysical
                      ? `🏆 GANADOR DEL SORTEO ATSC\nN°: ${currentWinner.ticketNumber}\nTipo: Entrada Física / Talonario en mano\nEstado: Presentar talón físico N° ${currentWinner.ticketNumber} para retirar premio`
                      : `🏆 GANADOR DEL SORTEO ATSC\nN°: ${currentWinner.ticketNumber}\nAsistente: ${currentWinner.ticket.attendee_name}\nComprador: ${currentWinner.order?.buyer_full_name || '—'} (DNI: ${currentWinner.order?.buyer_dni || '—'})\nTeléfono: ${currentWinner.order?.buyer_phone || '—'}\nEstado: ${currentWinner.isCheckedIn ? 'Presente en el salón' : 'Sin ingreso registrado'}`
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
                        w.participant.isPhysical
                          ? `${idx + 1}. [N° ${w.participant.ticketNumber}] ${w.prizeName}: Boleto Físico (Talonario en mano)`
                          : `${idx + 1}. [N° ${w.participant.ticketNumber}] ${w.prizeName}: ${w.participant.ticket.attendee_name} (Comprador: ${w.participant.order?.buyer_full_name || '—'} - Tel: ${w.participant.order?.buyer_phone || '—'})`
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
                          {rec.participant.isPhysical && (
                            <div style={{ color: '#fbbf24', fontSize: '11px', fontWeight: 600 }}>Talonario Físico</div>
                          )}
                        </td>
                        <td>
                          {rec.participant.isPhysical ? (
                            <span style={{ color: '#8a9ab5', fontSize: '12px' }}>Venta en mano</span>
                          ) : (
                            <>
                              <div>{rec.participant.order?.buyer_full_name || '—'}</div>
                              <small style={{ color: '#8496ad' }}>{rec.participant.order?.buyer_phone || ''}</small>
                            </>
                          )}
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
                            <div style={{ color: p.isPhysical ? '#fbbf24' : '#cfd8e3', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '130px' }}>
                              {p.isPhysical ? '🎟️ Talonario Físico' : p.ticket.attendee_name}
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

      {/* ══════════════════════════════════════════════════════════════
          TAB: PADRÓN Y CONTEO POR CATEGORÍAS
         ══════════════════════════════════════════════════════════════ */}
      {userRole === 'superuser' && activeTab === 'padron' && (
        <section className="padron-section animate-fade">
          {/* Encabezado formal solo para impresión en PDF */}
          <div className="padron-print-only">
            <div className="padron-print-header">
              <div>
                <h1>ANDES TALLERES SPORT CLUB</h1>
                <p><b>CENA DE FIN DE AÑO 2026</b> · MICROESTADIO ANDES TALLERES</p>
                <p style={{ fontSize: '9pt', color: '#666' }}>Planilla Oficial de Conteo y Padrón de Asistentes clasificado por Categoría</p>
              </div>
              <div style={{ textAlign: 'right', fontSize: '9pt', color: '#555' }}>
                <div>Fecha emisión: <b>{new Date().toLocaleDateString('es-AR')}</b></div>
                <div>Hora: <b>{new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} hs</b></div>
              </div>
            </div>
          </div>

          {/* Barra de título y botones de acción (en pantalla) */}
          <div className="padron-header-bar no-print">
            <div className="padron-header-titles">
              <h2>📋 Padrón Oficial y Conteo por Categorías</h2>
              <p>Desglose ordenado de Jugadores, Acompañantes y Menores &lt;3 años por división deportiva con opción de exportación a PDF para conteo.</p>
            </div>

            <div className="padron-actions-group">
              <button
                type="button"
                className="btn-print-padron"
                onClick={() => window.print()}
                title="Generar o imprimir reporte en PDF listo para imprimir"
              >
                <Printer size={16} /> Imprimir / Guardar como PDF
              </button>

              <button
                type="button"
                className="btn-export-csv"
                onClick={handleDownloadCsv}
                title="Descargar lista completa en Excel / CSV"
              >
                <Download size={16} /> Descargar Excel / CSV
              </button>

              <button
                type="button"
                className="btn-copy-wa"
                onClick={handleCopyPadronWhatsApp}
                title="Copiar resumen para WhatsApp"
              >
                <Share2 size={16} /> Copiar para WhatsApp
              </button>
            </div>
          </div>

          {/* Kpis / Estadísticas Rápidas de Conteo */}
          <div className="padron-stat-grid">
            <div className="padron-stat-box" style={{ borderLeft: '4px solid #d92736' }}>
              <span style={{ color: '#ff6874' }}>TOTAL ASISTENTES</span>
              <strong>{padronTotals.totalAttendees}</strong>
              <small>Convocatoria global del evento</small>
            </div>

            <div className="padron-stat-box" style={{ borderLeft: '4px solid #00d2b4' }}>
              <span style={{ color: '#00d2b4' }}>⚽ JUGADORES DEL CLUB</span>
              <strong>{padronTotals.totalPlayers}</strong>
              <small>Entradas bonificadas ($0)</small>
            </div>

            <div className="padron-stat-box" style={{ borderLeft: '4px solid #fbbf24' }}>
              <span style={{ color: '#fbbf24' }}>🎟️ ACOMPAÑANTES</span>
              <strong>{padronTotals.totalCompanions}</strong>
              <small>Entradas con sorteo ({money(padronTotals.totalCompanions * unitPrice)})</small>
            </div>

            <div className="padron-stat-box" style={{ borderLeft: '4px solid #38bdf8' }}>
              <span style={{ color: '#38bdf8' }}>👶 MENORES &lt;3 AÑOS</span>
              <strong>{padronTotals.totalMinors}</strong>
              <small>Ingreso bonificado sin sorteo</small>
            </div>

            <div className="padron-stat-box" style={{ borderLeft: '4px solid #10b981' }}>
              <span style={{ color: '#10b981' }}>🟢 INGRESADOS AL SALÓN</span>
              <strong style={{ color: '#10b981' }}>{padronTotals.totalCheckedIn}</strong>
              <small>Faltan: {padronTotals.totalPending}</small>
            </div>
          </div>

          {/* Tabla Resumen de Conteo por Categoría */}
          <div className="padron-summary-table-wrap">
            <div style={{ padding: '14px 18px', background: '#070e19', borderBottom: '1px solid #182d49', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
              <h3 style={{ margin: 0, fontSize: '15px', color: '#ffffff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Trophy size={16} color="#fbbf24" /> Planilla Resumen de Conteo por Categoría
              </h3>
              <span style={{ fontSize: '12px', color: '#8496ad' }}>
                {categoryStats.filter(c => c.totalAttendees > 0).length} categorías con personas inscriptas
              </span>
            </div>

            <table className="padron-summary-table">
              <thead>
                <tr>
                  <th>Categoría</th>
                  <th style={{ textAlign: 'center' }}>⚽ Jugadores</th>
                  <th style={{ textAlign: 'center' }}>🎟️ Acompañantes</th>
                  <th style={{ textAlign: 'center' }}>👶 Menores &lt;3</th>
                  <th style={{ textAlign: 'center' }}>Total Asistentes</th>
                  <th style={{ textAlign: 'center' }}>🟢 Ingresaron</th>
                  <th style={{ textAlign: 'center' }}>⚪ Faltan</th>
                  <th className="no-print" style={{ textAlign: 'center' }}>Acción</th>
                </tr>
              </thead>
              <tbody>
                {categoryStats.map(cs => {
                  if (cs.totalAttendees === 0 && padronCategoryFilter !== 'all' && padronCategoryFilter !== cs.category) return null
                  return (
                    <tr key={cs.category}>
                      <td>
                        <strong style={{ color: '#ffffff' }}>{cs.category}</strong>
                      </td>
                      <td style={{ textAlign: 'center', color: cs.players.length > 0 ? '#00d2b4' : '#64748b', fontWeight: cs.players.length > 0 ? 700 : 'normal' }}>
                        {cs.players.length}
                      </td>
                      <td style={{ textAlign: 'center', color: cs.companions.length > 0 ? '#fbbf24' : '#64748b', fontWeight: cs.companions.length > 0 ? 700 : 'normal' }}>
                        {cs.companions.length}
                      </td>
                      <td style={{ textAlign: 'center', color: cs.minors.length > 0 ? '#38bdf8' : '#64748b', fontWeight: cs.minors.length > 0 ? 700 : 'normal' }}>
                        {cs.minors.length}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 800, color: '#ffffff', fontSize: '14px' }}>
                        {cs.totalAttendees}
                      </td>
                      <td style={{ textAlign: 'center', color: '#10b981', fontWeight: 700 }}>
                        {cs.checkedIn}
                      </td>
                      <td style={{ textAlign: 'center', color: cs.pending > 0 ? '#8496ad' : '#10b981' }}>
                        {cs.pending}
                      </td>
                      <td className="no-print" style={{ textAlign: 'center' }}>
                        <button
                          type="button"
                          className="btn-dash-outline"
                          style={{ padding: '4px 10px', fontSize: '11px' }}
                          onClick={() => {
                            setPadronCategoryFilter(cs.category)
                            setExpandedCategories(prev => ({ ...prev, [cs.category]: true }))
                          }}
                        >
                          Ver Lista
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>TOTAL GENERAL</td>
                  <td style={{ textAlign: 'center', color: '#00d2b4' }}>{padronTotals.totalPlayers}</td>
                  <td style={{ textAlign: 'center', color: '#fbbf24' }}>{padronTotals.totalCompanions}</td>
                  <td style={{ textAlign: 'center', color: '#38bdf8' }}>{padronTotals.totalMinors}</td>
                  <td style={{ textAlign: 'center', fontSize: '16px', color: '#ffffff' }}>{padronTotals.totalAttendees}</td>
                  <td style={{ textAlign: 'center', color: '#10b981' }}>{padronTotals.totalCheckedIn}</td>
                  <td style={{ textAlign: 'center', color: '#ff6874' }}>{padronTotals.totalPending}</td>
                  <td className="no-print" style={{ textAlign: 'center' }}>—</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Filtros de la lista detallada (en pantalla) */}
          <div className="padron-filters-bar no-print">
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#8496ad', fontSize: '12px' }}>
              <Filter size={15} /> <b>Filtrar lista:</b>
            </div>

            <select
              className="padron-filter-select"
              value={padronCategoryFilter}
              onChange={e => setPadronCategoryFilter(e.target.value)}
            >
              <option value="all">Todas las categorías ({categoryStats.reduce((acc, c) => acc + c.totalAttendees, 0)})</option>
              {categoryStats.map(c => (
                <option key={c.category} value={c.category}>
                  {c.category} ({c.totalAttendees})
                </option>
              ))}
            </select>

            <select
              className="padron-filter-select"
              value={padronRoleFilter}
              onChange={e => setPadronRoleFilter(e.target.value as any)}
            >
              <option value="all">Todos los roles</option>
              <option value="jugador">⚽ Solo Jugadores</option>
              <option value="acompanante">🎟️ Solo Acompañantes</option>
              <option value="menor">👶 Solo Menores &lt;3 años</option>
            </select>

            <select
              className="padron-filter-select"
              value={padronStatusFilter}
              onChange={e => setPadronStatusFilter(e.target.value as any)}
            >
              <option value="all">Todos los estados</option>
              <option value="used">🟢 Ingresados en puerta</option>
              <option value="valid">⚪ Faltantes / Sin ingresar</option>
            </select>

            <div className="search-box" style={{ marginLeft: 'auto', maxWidth: '280px' }}>
              <Search size={15} />
              <input
                type="text"
                placeholder="Buscar por nombre..."
                value={padronSearch}
                onChange={e => setPadronSearch(e.target.value)}
              />
            </div>

            {(padronCategoryFilter !== 'all' || padronRoleFilter !== 'all' || padronStatusFilter !== 'all' || padronSearch.trim()) && (
              <button
                type="button"
                className="btn-dash-outline"
                style={{ padding: '6px 10px', fontSize: '11px', color: '#ef4444', borderColor: '#ef4444' }}
                onClick={() => {
                  setPadronCategoryFilter('all')
                  setPadronRoleFilter('all')
                  setPadronStatusFilter('all')
                  setPadronSearch('')
                }}
              >
                Limpiar filtros
              </button>
            )}
          </div>

          {/* Listado detallado dividido por categoría */}
          <div className="padron-categories-list">
            {categoryStats.map(cs => {
              if (padronCategoryFilter !== 'all' && cs.category !== padronCategoryFilter) return null
              if (cs.totalAttendees === 0) return null

              const allCategoryTickets = [...cs.players, ...cs.companions, ...cs.minors]
              const filteredTickets = allCategoryTickets.filter(ticket => {
                const { cleanName, role } = parseTicketInfo(ticket)
                if (padronRoleFilter !== 'all' && role !== padronRoleFilter) return false
                const isCheckedIn = ticket.status === 'used' || !!ticket.checked_in_at
                if (padronStatusFilter === 'used' && !isCheckedIn) return false
                if (padronStatusFilter === 'valid' && isCheckedIn) return false
                if (padronSearch.trim()) {
                  const q = padronSearch.toLowerCase()
                  const order = orders.find(o => o.id === ticket.order_id)
                  const matchAttendee = cleanName.toLowerCase().includes(q)
                  const matchBuyer = order?.buyer_full_name?.toLowerCase().includes(q)
                  const matchDni = order?.buyer_dni?.toLowerCase().includes(q)
                  if (!matchAttendee && !matchBuyer && !matchDni) return false
                }
                return true
              })

              if (filteredTickets.length === 0 && (padronSearch.trim() || padronRoleFilter !== 'all' || padronStatusFilter !== 'all')) return null

              const isOpen = expandedCategories[cs.category] !== false // Default open

              return (
                <div key={cs.category} className="padron-category-section print-category-card">
                  <div
                    className={`padron-category-header ${isOpen ? 'open' : ''}`}
                    onClick={() => toggleCategoryExpand(cs.category)}
                  >
                    <div className="padron-cat-title">
                      <span>🏆 {cs.category}</span>
                      <span style={{ fontSize: '12px', color: '#8496ad', fontFamily: 'sans-serif' }}>
                        ({filteredTickets.length} de {cs.totalAttendees} personas)
                      </span>
                    </div>

                    <div className="padron-cat-badges">
                      {cs.players.length > 0 && (
                        <span className="role-badge-jugador">⚽ {cs.players.length} jugadores</span>
                      )}
                      {cs.companions.length > 0 && (
                        <span className="role-badge-acompanante">🎟️ {cs.companions.length} acompañantes</span>
                      )}
                      {cs.minors.length > 0 && (
                        <span className="role-badge-menor">👶 {cs.minors.length} menores &lt;3</span>
                      )}
                      <span className="no-print" style={{ color: '#8496ad', marginLeft: '6px' }}>
                        {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                      </span>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="table-scroll-wrap" style={{ margin: 0, borderRadius: 0, border: 'none' }}>
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th style={{ width: '40px' }}>#</th>
                            <th>Nombre del Asistente</th>
                            <th>Tipo / Rol</th>
                            <th>N° Entrada (Sorteo)</th>
                            <th>Titular / Contacto</th>
                            <th>Estado Puerta</th>
                            <th className="no-print">Check-in</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredTickets.map((ticket, index) => {
                            const { cleanName, role } = parseTicketInfo(ticket)
                            const order = orders.find(o => o.id === ticket.order_id)
                            const isCheckedIn = ticket.status === 'used' || !!ticket.checked_in_at
                            const isPlayer = isPlayerTicket(ticket)
                            const ticketNum = role === 'menor' ? 'MENOR' : isPlayer ? 'JUGADOR' : (getTicketDisplayNumber(ticket) || '')

                            return (
                              <tr key={ticket.id}>
                                <td style={{ color: '#64748b', fontSize: '11px' }}>{index + 1}</td>
                                <td>
                                  <strong style={{ color: '#ffffff', fontSize: '13px' }}>{cleanName}</strong>
                                </td>
                                <td>
                                  {role === 'menor' ? (
                                    <span className="role-badge-menor">👶 Menor &lt;3 años ($0)</span>
                                  ) : role === 'jugador' ? (
                                    <span className="role-badge-jugador">⚽ Jugador ($0)</span>
                                  ) : (
                                    <span className="role-badge-acompanante">🎟️ Acompañante</span>
                                  )}
                                </td>
                                <td>
                                  {role === 'menor' ? (
                                    <span style={{ fontSize: '11px', color: '#38bdf8' }}>Sin sorteo</span>
                                  ) : isPlayer ? (
                                    <span style={{ fontSize: '11px', color: '#00d2b4' }}>Sin sorteo</span>
                                  ) : (
                                    <span className="ticket-badge-number">🎟️ N° {ticketNum}</span>
                                  )}
                                </td>
                                <td>
                                  <div style={{ fontSize: '12px', color: '#cfd8e3' }}>
                                    {order ? (
                                      <>
                                        <b>{order.buyer_full_name}</b>
                                        <div style={{ fontSize: '11px', color: '#8496ad' }}>
                                          DNI: {order.buyer_dni} · Tel: {order.buyer_phone}
                                        </div>
                                      </>
                                    ) : (
                                      '—'
                                    )}
                                  </div>
                                </td>
                                <td>
                                  {isCheckedIn ? (
                                    <span className="badge-status badge-used">
                                      🟢 INGRESÓ {ticket.checked_in_at ? `(${new Date(ticket.checked_in_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} hs)` : ''}
                                    </span>
                                  ) : (
                                    <span className="badge-status badge-valid">⚪ SIN INGRESAR</span>
                                  )}
                                </td>
                                <td className="no-print">
                                  {!isCheckedIn ? (
                                    <button
                                      type="button"
                                      className="btn-action-checkin"
                                      onClick={() => void handleManualCheckIn(ticket)}
                                    >
                                      <Check size={13} /> Ingresar
                                    </button>
                                  ) : (
                                    <span style={{ color: '#10b981', fontSize: '11px', fontWeight: 700 }}>✅ Presente</span>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Bloque de firmas para el informe impreso / PDF */}
          <div className="padron-print-only padron-print-signatures">
            <div className="signature-box">
              <p><b>Planilla y Conteo Confeccionado por:</b></p>
              <br />
              <p>Firma y Aclaración</p>
            </div>
            <div className="signature-box">
              <p><b>Revisión Administración Andes Talleres:</b></p>
              <br />
            </div>
          </div>
        </section>
      )}
    </main>
  )
}
