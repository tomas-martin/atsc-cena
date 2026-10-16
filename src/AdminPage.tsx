import { useEffect, useState, useRef, useMemo } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import QRCode from 'qrcode'
import {
  LockKeyhole, LogOut, RefreshCw,
  Camera, CheckCircle2, XCircle, AlertTriangle, Users,
  Ticket, ArrowLeft, Search, Check, Send
} from 'lucide-react'
import { supabase } from './lib/supabase'
import { sendTicketsEmail } from './lib/email'
import type { OrderConfirmation, IssuedTicket } from './types'
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

  // Tabs del panel: 'scanner' | 'tickets' | 'orders'
  const [activeTab, setActiveTab] = useState<'scanner' | 'tickets' | 'orders'>('scanner')

  // Datos
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [tickets, setTickets] = useState<TicketRow[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [approvingOrderId, setApprovingOrderId] = useState<string | null>(null)
  const [actionFeedback, setActionFeedback] = useState<{ message: string; success: boolean } | null>(null)

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

  // Mapeo correlativo estable para sorteo (ej: 001, 002, 003...)
  const ticketNumberMap = useMemo(() => {
    const sorted = [...tickets].sort((a, b) => {
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

  function getTicketDisplayNumber(ticket: { id: string; ticket_number?: number | null }, fallbackIndex?: number): string {
    if (ticket.ticket_number) {
      return String(ticket.ticket_number).padStart(3, '0')
    }
    const mapped = ticketNumberMap.get(ticket.id)
    if (mapped) return mapped
    if (fallbackIndex !== undefined) {
      return String(fallbackIndex + 1).padStart(3, '0')
    }
    return '001'
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

      const displayTicketNum = getTicketDisplayNumber(matchedTicket)

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
      const issuedTickets: IssuedTicket[] = orderTickets.map((t, i) => ({
        ticketNumber: getTicketDisplayNumber(t, i),
        attendeeName: t.attendee_name,
        qrToken: t.qr_token,
        orderId: order.id,
        eventName: 'Cena de Fin de Año 2026 - Andes Talleres',
        date: 'Sábado 19 de Diciembre de 2026 · 21:30 hs',
        venue: 'Microestadio Andes Talleres Sport Club · Godoy Cruz, Mendoza',
      }))

      const generatedQrs: Record<string, string> = {}
      for (const t of issuedTickets) {
        const qrContent = JSON.stringify({
          app: 'ATSC-CENA-2026',
          ticket: `N° ${t.ticketNumber}`,
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

      const issuedTickets: IssuedTicket[] = orderTickets.map((t, i) => ({
        ticketNumber: getTicketDisplayNumber(t, i),
        attendeeName: t.attendee_name,
        qrToken: t.qr_token,
        orderId: order.id,
        eventName: 'Cena de Fin de Año 2026 - Andes Talleres',
        date: 'Sábado 19 de Diciembre de 2026 · 21:30 hs',
        venue: 'Microestadio Andes Talleres Sport Club · Godoy Cruz, Mendoza',
      }))

      const generatedQrs: Record<string, string> = {}
      for (const t of issuedTickets) {
        const qrContent = JSON.stringify({
          app: 'ATSC-CENA-2026',
          ticket: `N° ${t.ticketNumber}`,
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
      const numA = parseInt(getTicketDisplayNumber(a), 10) || 0
      const numB = parseInt(getTicketDisplayNumber(b), 10) || 0
      return numA - numB
    })
    .filter(t => {
      const q = searchQuery.toLowerCase().trim()
      const ticketNum = getTicketDisplayNumber(t)
      const matchesSearch =
        !q ||
        t.attendee_name?.toLowerCase().includes(q) ||
        t.qr_token?.toLowerCase().includes(q) ||
        t.id?.toLowerCase().includes(q) ||
        ticketNum.includes(q) ||
        `n° ${ticketNum}`.toLowerCase().includes(q) ||
        `#${ticketNum}`.toLowerCase().includes(q)

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
                      <span className="ticket-badge-number">
                        N° {getTicketDisplayNumber(ticket)}
                      </span>
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
    </main>
  )
}
