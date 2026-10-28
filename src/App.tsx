import { useMemo, useState, useEffect } from 'react'
import {
  ArrowRight, ArrowLeft, CircleHelp,
  Minus, Plus, ShieldCheck, Ticket,
  WalletCards, Calendar, MapPin, Users,
  RefreshCw, Check, Copy, MessageCircle, AlertCircle,
  CheckCircle2, Sparkles
} from 'lucide-react'
import QRCode from 'qrcode'
import { supabase } from './lib/supabase'
import { sendTicketsEmail } from './lib/email'
import AdminPage from './AdminPage'
import ClubLogo from './ClubLogo'
import {
  type BuyerDetails,
  type Step,
  type IssuedTicket,
  type OrderConfirmation,
  type Category,
  CATEGORIES
} from './types'

// Precio base de referencia por entrada en ARS (si Supabase no define otro)
const DEFAULT_PRICE_ARS = 25000

// Datos bancarios y de contacto oficiales
const CLUB_ALIAS = (import.meta.env.VITE_CLUB_ALIAS as string) || 'futsal.atsc'
const CLUB_TITULAR = (import.meta.env.VITE_CLUB_TITULAR as string) || 'Jimena Patricia Calivar'
const CLUB_BANCO = (import.meta.env.VITE_CLUB_BANCO as string) || 'Naranja X'
const CLUB_CBU = (import.meta.env.VITE_CLUB_CBU as string) || ''
const WHATSAPP_PHONE = (import.meta.env.VITE_WHATSAPP_PHONE as string) || '5492615751033'

// Datos oficiales del evento
const EVENT_NAME = 'Cena de Fin de Año 2026 - Andes Talleres'
const EVENT_DATE = 'Sábado 19 de Diciembre de 2026 · 21:30 hs'
const EVENT_VENUE = 'Estadio Salvador Bonanno · Andes Talleres'

const money = (amount: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(amount)

function App() {
  const [showAdmin, setShowAdmin] = useState(
    typeof window !== 'undefined' && window.location.pathname === '/admin'
  )

  useEffect(() => {
    const handlePopState = () => {
      setShowAdmin(window.location.pathname === '/admin')
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const handleOpenAdmin = () => {
    setShowAdmin(true)
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/admin')
      window.scrollTo({ top: 0, behavior: 'instant' })
    }
  }

  const handleCloseAdmin = () => {
    setShowAdmin(false)
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/')
      window.scrollTo({ top: 0, behavior: 'instant' })
    }
  }

  // ── Estados de la navegación por secciones ──
  const [currentStep, setCurrentStep] = useState<Step>('fiesta')

  // ── Función robusta para resetear el scroll a la parte superior ──
  const scrollToTop = () => {
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    } catch {
      window.scrollTo(0, 0)
    }
    if (document.documentElement) document.documentElement.scrollTop = 0
    if (document.body) document.body.scrollTop = 0
  }

  // ── Garantizar que la pantalla suba al inicio automáticamente cada vez que cambia el paso ──
  useEffect(() => {
    scrollToTop()
    const rId = requestAnimationFrame(scrollToTop)
    const tId = setTimeout(scrollToTop, 50)
    return () => {
      cancelAnimationFrame(rId)
      clearTimeout(tId)
    }
  }, [currentStep])

  // ── Logo y configuración del evento desde Supabase ──
  const [logoUrl, setLogoUrl] = useState<string | null>(
    (import.meta.env.VITE_CLUB_LOGO_URL as string) || null
  )
  const [unitPrice, setUnitPrice] = useState<number>(DEFAULT_PRICE_ARS)

  // ── Selección clara y estructurada de entradas del grupo ──
  interface PlayerAttendeeItem {
    name: string
    category: Category | ''
  }

  // Jugadores del club ($0 - entrada bonificada, sin número de sorteo)
  const [players, setPlayers] = useState<PlayerAttendeeItem[]>([])

  // Acompañantes / Familiares que abonan entrada ($unitPrice) y participan del sorteo
  const [companionCount, setCompanionCount] = useState<number>(0)

  // Categoría por defecto si no hay jugadores en el grupo (inicia sin seleccionar)
  const [groupCategory, setGroupCategory] = useState<Category | ''>('')

  // Menores de 3 años (GRATIS, $0, no participan del sorteo)
  const [childrenCount, setChildrenCount] = useState<number>(0)

  // Personalización opcional de nombres para acompañantes y menores
  const [showCustomNames, setShowCustomNames] = useState(false)
  const [customCompanionNames, setCustomCompanionNames] = useState<string[]>([])
  const [customChildNames, setCustomChildNames] = useState<string[]>([])

  // Datos de contacto del comprador / responsable del grupo
  const [buyer, setBuyer] = useState<BuyerDetails>({
    fullName: '',
    dni: '',
    email: '',
    phone: '',
    attendees: [''],
    attendeeDetails: []
  })

  // Pago: Exclusivo Transferencia por Alias
  const [copiedAlias, setCopiedAlias] = useState(false)

  // ── Procesamiento y Confirmación ──
  const [busy, setBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [orderConfirmation, setOrderConfirmation] = useState<OrderConfirmation | null>(null)
  const [confirmationQrUrls, setConfirmationQrUrls] = useState<Record<string, string>>({})

  // Total de entradas emitidas (jugadores + acompañantes + menores < 3)
  const quantity = useMemo(() => {
    return players.length + companionCount + childrenCount
  }, [players.length, companionCount, childrenCount])

  // Solo pagan los acompañantes; jugadores y menores de 3 años tienen costo $0
  const total = useMemo(() => {
    return companionCount * unitPrice
  }, [companionCount, unitPrice])

  // Categoría principal asociada al grupo
  const primaryCategory = useMemo<string>(() => {
    return players[0]?.category || groupCategory || '(Ninguno)'
  }, [players, groupCategory])

  // Cargar precio y logo desde Supabase si existen
  useEffect(() => {
    async function loadConfig() {
      if (!supabase) return
      try {
        const { data } = await supabase
          .from('event_config')
          .select('ticket_price_ars, logo_url')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (data?.ticket_price_ars) {
          setUnitPrice(Number(data.ticket_price_ars))
        }
        if (data?.logo_url) {
          setLogoUrl(data.logo_url)
        }
      } catch (e) {
        console.warn('No se pudo cargar configuración de Supabase, usando valores por defecto', e)
      }
    }
    loadConfig()
  }, [])

  const updateBuyer = (field: keyof BuyerDetails, value: string) => {
    setBuyer(current => ({ ...current, [field]: value }))
    if (fieldErrors[field]) {
      setFieldErrors(prev => {
        const next = { ...prev }
        delete next[field]
        return next
      })
    }
  }

  // Copiar alias al portapapeles
  const handleCopyAlias = () => {
    navigator.clipboard.writeText(CLUB_ALIAS)
    setCopiedAlias(true)
    setTimeout(() => setCopiedAlias(false), 2500)
  }

  // ── Validación paso 1: Selección de Entradas ──
  const handleProceedToBuyerData = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setErrorMessage('')
    const errors: Record<string, string> = {}

    if (quantity < 1) {
      setErrorMessage('Debés seleccionar al menos una entrada para continuar.')
      return
    }

    // Validar que cada jugador cargado tenga su nombre, apellido y categoría seleccionada
    for (let i = 0; i < players.length; i++) {
      if (!players[i].name.trim()) {
        errors[`player_${i}`] =
          players.length === 1
            ? 'Completá el nombre y apellido del jugador'
            : `Completá el nombre del Jugador #${i + 1}`
      }
      if (!players[i].category) {
        errors[`player_cat_${i}`] =
          players.length === 1
            ? 'Seleccioná la categoría del jugador'
            : `Seleccioná la categoría del Jugador #${i + 1}`
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      const hasNameError = Object.keys(errors).some(k => k.startsWith('player_') && !k.startsWith('player_cat_'))
      const hasCatError = Object.keys(errors).some(k => k.startsWith('player_cat_'))
      if (hasNameError && hasCatError) {
        setErrorMessage('Por favor completá los nombres y seleccioná las categorías de los jugadores / profesores.')
      } else if (hasCatError) {
        setErrorMessage('Por favor seleccioná la categoría de cada jugador o profesor ingresado.')
      } else {
        setErrorMessage('Por favor completá los nombres de los jugadores o profesores ingresados.')
      }
      const firstKey = Object.keys(errors)[0]
      setTimeout(() => {
        const el = document.getElementById(`field-${firstKey}`)
        if (el) {
          el.focus()
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }, 50)
      return
    }

    if (players.length > 0 && players[0]?.category && !groupCategory) {
      setGroupCategory(players[0].category)
    }

    setFieldErrors({})
    setCurrentStep('datos')
    scrollToTop()
  }

  // ── Validación paso 2: Datos de Contacto del Responsable ──
  const handleProceedToPayment = (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage('')
    const errors: Record<string, string> = {}

    if (!buyer.fullName.trim()) {
      errors.fullName = 'Completá este campo con tu nombre y apellido'
    }

    if (!buyer.dni.trim()) {
      errors.dni = 'Completá este campo con tu número de DNI'
    } else if (buyer.dni.length < 7) {
      errors.dni = 'Ingresá un número de DNI válido (mínimo 7 dígitos)'
    }

    if (!buyer.email.trim()) {
      errors.email = 'Completá este campo con tu correo electrónico'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.email)) {
      errors.email = 'Ingresá un correo electrónico válido'
    }

    if (!groupCategory) {
      errors.groupCategory = 'Seleccioná la categoría deportiva'
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      setErrorMessage('Por favor completá los datos requeridos marcados abajo.')
      const firstKey = Object.keys(errors)[0]
      setTimeout(() => {
        const el = document.getElementById(`field-${firstKey}`)
        if (el) {
          el.focus()
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }, 50)
      return
    }

    setFieldErrors({})

    if (quantity < 1) {
      setErrorMessage('Debés seleccionar al menos una entrada para continuar.')
      return
    }

    setCurrentStep('pago')
    scrollToTop()
  }

  // ── Registro del pedido (pendiente si hay acompañantes, pagado directo si son solo jugadores) ──
  const handleRegisterOrder = async () => {
    setErrorMessage('')
    setBusy(true)

    try {
      let savedOrderId = ''
      const isZeroCostOrder = total === 0

      // 1. Guardar pedido en Supabase
      if (supabase) {
        const { data: orderData, error: orderErr } = await supabase.from('orders').insert({
          buyer_full_name: buyer.fullName,
          buyer_dni: buyer.dni,
          buyer_email: buyer.email,
          buyer_phone: buyer.phone || '-',
          quantity,
          unit_price_ars: unitPrice || (quantity > 0 ? Math.round(total / quantity) : 0),
          total_ars: total,
          payment_method: 'transferencia',
          status: isZeroCostOrder ? 'pagado' : 'pendiente',
          transfer_reference: isZeroCostOrder ? 'Entrada Jugador Bonificada ($0)' : null,
          paid_at: isZeroCostOrder ? new Date().toISOString() : null,
        }).select('id').single()

        if (orderErr) {
          console.error('Error al insertar orden en Supabase:', orderErr)
          throw new Error(`Error en la base de datos (${orderErr.code}): ${orderErr.message}`)
        }

        if (orderData?.id) {
          savedOrderId = orderData.id
        }
      }

      // Código de orden limpio y legible (ej: #ATSC-A8F12B)
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
            .gt('ticket_number', 0)
            .order('ticket_number', { ascending: false })
            .limit(1)

          if (highestTicket && highestTicket.length > 0 && typeof highestTicket[0].ticket_number === 'number') {
            nextTicketNumber = highestTicket[0].ticket_number + 1
          } else {
            const { count } = await supabase
              .from('tickets')
              .select('*', { count: 'exact', head: true })
              .gt('ticket_number', 0)
            if (typeof count === 'number' && !isNaN(count)) {
              nextTicketNumber = count + 1
            }
          }
        } catch { }
      }

      // 3. Generar tickets:
      // - Jugadores: NO tienen número de sorteo (ticketNumber: 'JUGADOR', DB ticket_number: 0)
      // - Menores < 3 años: Bonificados (ticketNumber: 'MENOR', DB ticket_number: 0)
      // - Acompañantes: SÍ tienen número correlativo de sorteo (ej: 001, 002...)
      let companionRaffleCount = 0
      const tickets: IssuedTicket[] = []

      const makeUuid = () =>
        (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = (Math.random() * 16) | 0
            const v = c === 'x' ? r : (r & 0x3) | 0x8
            return v.toString(16)
          })

      // A) Entradas de Jugadores y Profes (bonificadas $0, sin sorteo)
      for (let i = 0; i < players.length; i++) {
        const p = players[i]
        const pName = p.name.trim() || `${buyer.fullName.trim()} (Jugador/Profe)`
        tickets.push({
          ticketNumber: 'JUGADOR/PROFE',
          attendeeName: `${pName} (Jugador/Profe · ${p.category})`,
          qrToken: makeUuid(),
          orderId: displayOrderId,
          eventName: EVENT_NAME,
          date: EVENT_DATE,
          venue: EVENT_VENUE,
          isPlayer: true,
          role: 'jugador',
          category: (p.category || 'Escuelita') as Category,
        })
      }

      // Comprobar si el comprador ya figura como jugador
      const isBuyerInPlayers = players.some(
        p => p.name.trim().toLowerCase() === buyer.fullName.trim().toLowerCase()
      )

      // B) Entradas de acompañantes que pagan (cada uno con número de sorteo)
      for (let i = 0; i < companionCount; i++) {
        const currentNum = nextTicketNumber + companionRaffleCount
        const formattedNum = String(currentNum).padStart(3, '0')
        companionRaffleCount++

        let attendeeRaw = ''
        if (customCompanionNames[i]?.trim()) {
          attendeeRaw = customCompanionNames[i].trim()
        } else if (i === 0 && !isBuyerInPlayers) {
          attendeeRaw = buyer.fullName.trim()
        } else {
          attendeeRaw = `${buyer.fullName.trim()} - Acompañante ${i + 1}`
        }

        tickets.push({
          ticketNumber: formattedNum,
          attendeeName: `${attendeeRaw} (Acompañante · ${primaryCategory})`,
          qrToken: makeUuid(),
          orderId: displayOrderId,
          eventName: EVENT_NAME,
          date: EVENT_DATE,
          venue: EVENT_VENUE,
          isPlayer: false,
          role: 'acompanante',
          category: (primaryCategory || 'Escuelita') as Category,
        })
      }

      // C) Entradas de menores de 3 años (Gratis, $0, sin número de sorteo)
      for (let i = 0; i < childrenCount; i++) {
        let attendeeRaw = ''
        if (customChildNames[i]?.trim()) {
          attendeeRaw = customChildNames[i].trim()
        } else {
          attendeeRaw = `${buyer.fullName.trim()} - Menor <3 años ${childrenCount > 1 ? i + 1 : ''}`.trim()
        }

        tickets.push({
          ticketNumber: 'MENOR',
          attendeeName: `${attendeeRaw} (Menor <3 años · ${primaryCategory})`,
          qrToken: makeUuid(),
          orderId: displayOrderId,
          eventName: EVENT_NAME,
          date: EVENT_DATE,
          venue: EVENT_VENUE,
          isPlayer: true,
          role: 'menor',
          category: (primaryCategory || 'Escuelita') as Category,
        })
      }

      // 4. Guardar tickets en Supabase
      if (supabase && savedOrderId) {
        const ticketRows = tickets.map((t) => ({
          order_id: savedOrderId,
          attendee_name: t.attendeeName,
          qr_token: t.qrToken,
          status: 'valid',
          ticket_number: (t.isPlayer || t.role === 'menor' || t.role === 'jugador') ? null : parseInt(t.ticketNumber, 10),
        }))
        const { error: ticketErr } = await supabase.from('tickets').insert(ticketRows)
        if (ticketErr) {
          // Si ticket_number viola restricción NOT NULL (código 23502), reintentar asignando 0 a jugadores/menores
          if (ticketErr.code === '23502') {
            const retryRows = ticketRows.map(r => ({
              ...r,
              ticket_number: r.ticket_number ?? 0
            }))
            await supabase.from('tickets').insert(retryRows)
          } else if (ticketErr.code === '42703') {
            // Si la columna no existe aún en la base de datos
            const fallbackRows = ticketRows.map(({ ticket_number, ...rest }) => rest)
            await supabase.from('tickets').insert(fallbackRows)
          } else {
            console.error('Error insertando tickets:', ticketErr)
          }
        }
      }

      // Estructura completa del comprador con los nombres de asistentes para emails y comprobantes
      const buyerWithDetails: BuyerDetails = {
        ...buyer,
        attendees: tickets.map(t => t.attendeeName),
        attendeeDetails: tickets.map(t => ({
          name: t.attendeeName,
          role: t.role || (t.isPlayer ? 'jugador' : 'acompanante'),
          category: (t.category || primaryCategory || 'Escuelita') as Category
        }))
      }

      // 5. Si la orden es 100% bonificada ($0), generar QR y despachar correo inmediatamente
      let generatedQrs: Record<string, string> = {}
      let emailDispatched = false
      if (isZeroCostOrder) {
        try {
          for (const t of tickets) {
            const qrContent = JSON.stringify({
              app: 'ATSC-CENA-2026',
              ticket: t.ticketNumber,
              attendee: t.attendeeName,
              token: t.qrToken,
              order: t.orderId
            })
            const dataUrl = await QRCode.toDataURL(qrContent, {
              width: 320,
              margin: 2,
              color: { dark: '#070e1a', light: '#ffffff' }
            })
            generatedQrs[t.qrToken] = dataUrl
          }
          setConfirmationQrUrls(generatedQrs)

          const instantConf: OrderConfirmation = {
            orderId: displayOrderId,
            buyer: buyerWithDetails,
            quantity: tickets.length,
            totalArs: 0,
            paymentMethod: 'transferencia',
            tickets,
            emailSent: false,
          }

          const mailRes = await sendTicketsEmail(instantConf, generatedQrs)
          emailDispatched = mailRes.success
        } catch (e) {
          console.warn('No se pudo enviar el correo de entradas gratis de forma inmediata:', e)
        }
      }

      const conf: OrderConfirmation = {
        orderId: displayOrderId,
        buyer: buyerWithDetails,
        quantity: tickets.length,
        totalArs: total,
        paymentMethod: 'transferencia',
        tickets,
        emailSent: emailDispatched,
      }
      setOrderConfirmation(conf)

      // Pasar a la pantalla de confirmación
      setCurrentStep('confirmacion')
      scrollToTop()

    } catch (err) {
      console.error(err)
      setErrorMessage(err instanceof Error ? err.message : 'Error al registrar el pedido.')
    } finally {
      setBusy(false)
    }
  }

  // Generar URL de WhatsApp con mensaje prearmado
  const getWhatsAppUrl = () => {
    if (!orderConfirmation) return '#'
    const msg = `¡Hola! Te envío el comprobante de transferencia para la Cena de Fin de Año de Andes Talleres (19 de Diciembre - Estadio Salvador Bonanno).\n\n*Pedido:* #${orderConfirmation.orderId}\n*Titular:* ${orderConfirmation.buyer.fullName}\n*DNI:* ${orderConfirmation.buyer.dni}\n*Categoría:* ${primaryCategory}\n*Entradas:* ${orderConfirmation.quantity}\n*Total:* ${money(orderConfirmation.totalArs)}\n*Email:* ${orderConfirmation.buyer.email}`
    return `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(msg)}`
  }

  if (showAdmin) {
    return <AdminPage logoUrl={logoUrl} onBack={handleCloseAdmin} />
  }

  return (
    <div className="site-shell">
      {/* ── Navbar ── */}
      <header className="navbar">
        <div className="brand" onClick={() => setCurrentStep('fiesta')} style={{ cursor: 'pointer' }}>
          <ClubLogo url={logoUrl} size="sm" />
          <div className="brand-name">
            ANDES TALLERES
            <span>CENA DE FIN DE AÑO 2026</span>
          </div>
        </div>

        {/* Stepper de navegación */}
        <div className="nav-stepper">
          <div className={`nav-step ${currentStep === 'fiesta' ? 'active' : ''}`} onClick={() => setCurrentStep('fiesta')}>
            <span className="step-num">1</span>
            <span className="step-label">Inicio</span>
          </div>
          <span className="step-div">›</span>
          <div className={`nav-step ${currentStep === 'entradas' ? 'active' : ''}`} onClick={() => { if (currentStep !== 'fiesta') setCurrentStep('entradas') }}>
            <span className="step-num">2</span>
            <span className="step-label">Entradas</span>
          </div>
          <span className="step-div">›</span>
          <div className={`nav-step ${currentStep === 'datos' ? 'active' : ''}`} onClick={() => { if (currentStep === 'pago') setCurrentStep('datos') }}>
            <span className="step-num">3</span>
            <span className="step-label">Tus Datos</span>
          </div>
          <span className="step-div">›</span>
          <div className={`nav-step ${currentStep === 'pago' ? 'active' : ''}`}>
            <span className="step-num">4</span>
            <span className="step-label">Pago</span>
          </div>
          <span className="step-div">›</span>
          <div className={`nav-step ${currentStep === 'confirmacion' ? 'active' : ''}`}>
            <span className="step-num">5</span>
            <span className="step-label">Comprobante</span>
          </div>
        </div>

        <div className="nav-actions">
          {currentStep === 'fiesta' && (
            <button className="nav-cta" onClick={() => { setCurrentStep('entradas'); scrollToTop() }}>
              Comprar Entradas <ArrowRight size={15} />
            </button>
          )}
        </div>
      </header>

      <main className="main-content">
        {/* ══════════════════════════════════════════════════════════════
            SECCIÓN 1: PRESENTACIÓN DIRECTA Y LIMPIA DE LA FIESTA
           ══════════════════════════════════════════════════════════════ */}
        {currentStep === 'fiesta' && (
          <section className="fiesta-section animate-fade">
            <div className="fiesta-hero">
              <div className="fiesta-hero-glow" />

              <div className="fiesta-logo-wrap">
                <ClubLogo url={logoUrl} size="lg" />
              </div>

              <div className="club-name-tag">ANDES TALLERES SPORT CLUB</div>

              <h1 className="fiesta-title">
                CENA DE <span className="text-red">FIN DE AÑO</span>
                <span className="fiesta-year">2026</span>
              </h1>

              <div className="fiesta-quick-info">
                <div className="info-item">
                  <Calendar size={18} />
                  <span>Sábado 19 de Diciembre · 21:30 hs</span>
                </div>
                <div className="info-divider" />
                <div className="info-item">
                  <MapPin size={18} />
                  <span>Estadio Salvador Bonanno · Andes Talleres</span>
                </div>
                <div className="info-divider" />
                <div className="info-item">
                  <Ticket size={18} />
                  <span>Entrada: <b>{money(unitPrice)}</b> por persona</span>
                </div>
              </div>

              <div className="fiesta-cta-wrap">
                <button
                  className="btn-huge-red"
                  onClick={() => {
                    setCurrentStep('entradas')
                    scrollToTop()
                  }}
                >
                  <Ticket size={22} />
                  <span>COMPRAR ENTRADAS</span>
                  <ArrowRight size={20} />
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ══════════════════════════════════════════════════════════════
            SECCIÓN 2: SELECCIÓN DE ENTRADAS DEL GRUPO
           ══════════════════════════════════════════════════════════════ */}
        {currentStep === 'entradas' && (
          <section className="step-section animate-fade">
            <div className="step-header">
              <button className="btn-back" onClick={() => { setCurrentStep('fiesta'); scrollToTop() }}>
                <ArrowLeft size={16} /> Volver
              </button>
              <div className="step-badge">PASO 1 DE 3 · SELECCIÓN DE ENTRADAS</div>
              <h1>Armá tu grupo y seleccioná tus entradas</h1>
              <p>Elegí quiénes asistirán al evento: jugadores y profesores bonificados, acompañantes mayores y menores.</p>
            </div>

            <div className="form-container">
              {/* 1. SELECCIÓN DE ENTRADAS DEL GRUPO */}
              <div className="dark-card">
                <div className="card-top-header">
                  <div className="card-icon-round"><Users size={20} /></div>
                  <div>
                    <h3>1. Entradas del Grupo (¿Quiénes van a la fiesta?)</h3>
                    <p>Podés sumar a jugadores y profesores del club, acompañantes mayores y niños menores de 3 años</p>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

                  {/* BLOQUE A: JUGADORES Y PROFESORES DEL CLUB (GRATIS $0) */}
                  <div className="ticket-counter-box" style={{ background: 'rgba(0, 210, 180, 0.05)', border: '1px solid rgba(0, 210, 180, 0.3)', borderRadius: '8px', padding: '16px' }}>
                    <div className="counter-info">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <strong style={{ color: '#00d2b4', fontSize: '15px' }}>⚽ Jugadores y Profes del Club</strong>
                        <span style={{ background: 'rgba(0, 210, 180, 0.2)', color: '#00d2b4', fontSize: '11px', fontWeight: 800, padding: '2px 8px', borderRadius: '4px' }}>
                          ¡ENTRADA BONIFICADA ($0)!
                        </span>
                      </div>
                      <span style={{ fontSize: '13px', color: '#c2cad7' }}>
                        Chicos, jugadores y profesores / cuerpo técnico de cualquier división (Escuelita, C5 hasta Primera, Seniors).
                      </span>
                      <small style={{ color: '#8a9ab5', display: 'block', marginTop: '4px' }}>
                        Entrada bonificada sin costo al 100% · No participan del sorteo de premios
                      </small>
                    </div>

                    <div className="stepper-modern">
                      <button
                        type="button"
                        aria-label="Restar jugador o profe"
                        onClick={() => {
                          if (players.length > 0) {
                            setPlayers(prev => prev.slice(0, -1))
                          }
                        }}
                        disabled={players.length <= 0}
                      >
                        <Minus size={18} />
                      </button>
                      <span className="stepper-val" style={{ color: '#00d2b4' }}>{players.length}</span>
                      <button
                        type="button"
                        aria-label="Sumar jugador o profe"
                        onClick={() => {
                          if (players.length < 10) {
                            setPlayers(prev => [
                              ...prev,
                              { name: '', category: '' }
                            ])
                          }
                        }}
                        disabled={players.length >= 10}
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                  </div>

                  {/* CARDS DE DATOS DE JUGADORES Y PROFES (SI HAY 1 O MÁS) */}
                  {players.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '-6px', marginBottom: '8px' }}>
                      {players.map((p, idx) => (
                        <div key={`player-${idx}`} className="player-input-card">
                          <div className="player-card-header">
                            <span className="player-index-badge">
                              ⚽ Datos del Jugador / Profe #{idx + 1}
                            </span>
                          </div>

                          <div className="player-inputs-row">
                            <div className="form-field">
                              <label htmlFor={`field-player_${idx}`}>Nombre y Apellido del Jugador / Profe *</label>
                              <div className="input-with-tooltip-wrap">
                                <input
                                  id={`field-player_${idx}`}
                                  type="text"
                                  placeholder="Ej: Mateo Rodríguez (Jugador) o Lucas Pérez (Profe)"
                                  className={fieldErrors[`player_${idx}`] ? 'input-field-error' : ''}
                                  value={p.name}
                                  onChange={e => {
                                    const val = e.target.value
                                    setPlayers(prev => prev.map((item, i) => i === idx ? { ...item, name: val } : item))
                                    if (fieldErrors[`player_${idx}`]) {
                                      setFieldErrors(prev => {
                                        const next = { ...prev }
                                        delete next[`player_${idx}`]
                                        return next
                                      })
                                    }
                                  }}
                                  onFocus={() => {
                                    if (fieldErrors[`player_${idx}`]) {
                                      setFieldErrors(prev => {
                                        const next = { ...prev }
                                        delete next[`player_${idx}`]
                                        return next
                                      })
                                    }
                                  }}
                                />
                                {fieldErrors[`player_${idx}`] && (
                                  <div className="custom-validation-bubble" role="alert">
                                    <div className="bubble-arrow" />
                                    <span className="bubble-icon">!</span>
                                    <span className="bubble-text">{fieldErrors[`player_${idx}`]}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="form-field">
                              <label htmlFor={`field-player_cat_${idx}`}>Categoría / División *</label>
                              <div className="input-with-tooltip-wrap">
                                <select
                                  id={`field-player_cat_${idx}`}
                                  className={`category-select-input ${fieldErrors[`player_cat_${idx}`] ? 'input-field-error' : ''}`}
                                  value={p.category}
                                  onChange={e => {
                                    const val = e.target.value as Category | ''
                                    setPlayers(prev => prev.map((item, i) => i === idx ? { ...item, category: val } : item))
                                    if (fieldErrors[`player_cat_${idx}`]) {
                                      setFieldErrors(prev => {
                                        const next = { ...prev }
                                        delete next[`player_cat_${idx}`]
                                        return next
                                      })
                                    }
                                  }}
                                  onFocus={() => {
                                    if (fieldErrors[`player_cat_${idx}`]) {
                                      setFieldErrors(prev => {
                                        const next = { ...prev }
                                        delete next[`player_cat_${idx}`]
                                        return next
                                      })
                                    }
                                  }}
                                >
                                  <option value="">(Ninguno)</option>
                                  {CATEGORIES.map(cat => (
                                    <option key={cat} value={cat}>
                                      Categoría {cat}
                                    </option>
                                  ))}
                                </select>
                                {fieldErrors[`player_cat_${idx}`] && (
                                  <div className="custom-validation-bubble" role="alert">
                                    <div className="bubble-arrow" />
                                    <span className="bubble-icon">!</span>
                                    <span className="bubble-text">{fieldErrors[`player_cat_${idx}`]}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}



                  {/* BLOQUE B: ACOMPAÑANTES MAYORES (PAGAN ENTRADA) */}
                  <div className="ticket-counter-box" style={{ background: 'rgba(14, 26, 43, 0.5)', border: '1px solid var(--navy-card-border)', borderRadius: '8px', padding: '16px' }}>
                    <div className="counter-info">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <strong style={{ color: '#ffffff', fontSize: '15px' }}>🎟️ Acompañantes / Familiares</strong>
                        <span className="price-big" style={{ fontSize: '20px' }}>{money(unitPrice)} <small style={{ fontSize: '12px', fontWeight: 'normal', color: '#8a9ab5' }}>c/u</small></span>
                      </div>
                      <span style={{ fontSize: '13px', color: '#c2cad7' }}>
                        Papás, mamás, familiares y amigos mayores de 3 años.
                      </span>
                      <small style={{ color: '#fbbf24', display: 'block', marginTop: '4px', fontWeight: 'bold' }}>
                        🎟️ Cada acompañante recibe su número oficial para el sorteo de premios
                      </small>
                    </div>

                    <div className="stepper-modern">
                      <button
                        type="button"
                        aria-label="Restar acompañante"
                        onClick={() => setCompanionCount(c => Math.max(0, c - 1))}
                        disabled={companionCount <= 0}
                      >
                        <Minus size={18} />
                      </button>
                      <span className="stepper-val">{companionCount}</span>
                      <button
                        type="button"
                        aria-label="Sumar acompañante"
                        onClick={() => setCompanionCount(c => Math.min(20, c + 1))}
                        disabled={companionCount >= 20}
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                  </div>

                  {/* BLOQUE C: MENORES DE 3 AÑOS (GRATIS $0) */}
                  <div className="ticket-counter-box" style={{ background: 'rgba(56, 189, 248, 0.05)', border: '1px solid rgba(56, 189, 248, 0.25)', borderRadius: '8px', padding: '16px' }}>
                    <div className="counter-info">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                        <strong style={{ color: '#38bdf8', fontSize: '15px' }}>👶 Menores de 3 años</strong>
                        <span style={{ background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8', fontSize: '11px', fontWeight: 800, padding: '2px 8px', borderRadius: '4px' }}>
                          ¡NO PAGAN ENTRADA! ($0)
                        </span>
                      </div>
                      <span style={{ fontSize: '13px', color: '#c2cad7' }}>
                        ¿Llevás niños menores de 3 años cumplidos en el grupo?
                      </span>
                      <small style={{ color: '#8a9ab5', display: 'block', marginTop: '4px' }}>
                        Ingreso bonificado sin costo · No participan del sorteo de premios
                      </small>
                    </div>

                    <div className="stepper-modern">
                      <button
                        type="button"
                        aria-label="Restar menor"
                        onClick={() => setChildrenCount(c => Math.max(0, c - 1))}
                        disabled={childrenCount <= 0}
                      >
                        <Minus size={18} />
                      </button>
                      <span className="stepper-val">{childrenCount}</span>
                      <button
                        type="button"
                        aria-label="Sumar menor"
                        onClick={() => setChildrenCount(c => Math.min(10, c + 1))}
                        disabled={childrenCount >= 10}
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                  </div>

                  {/* PERSONALIZACIÓN OPCIONAL DE NOMBRES */}
                  {(companionCount > 0 || childrenCount > 0) && (
                    <div style={{ marginTop: '2px' }}>
                      <button
                        type="button"
                        onClick={() => setShowCustomNames(!showCustomNames)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#8a9ab5',
                          fontSize: '13px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          cursor: 'pointer',
                          padding: '4px 0',
                          textDecoration: 'underline'
                        }}
                      >
                        {showCustomNames ? '▲ Ocultar personalización de nombres' : '▼ ¿Querés personalizar los nombres en las entradas de acompañantes? (Opcional)'}
                      </button>

                      {showCustomNames && (
                        <div style={{ background: 'rgba(6, 13, 23, 0.7)', border: '1px solid var(--navy-card-border)', borderRadius: '8px', padding: '14px', marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          <p style={{ fontSize: '12px', color: '#8a9ab5', margin: 0 }}>
                            Si no los completás, las entradas se emitirán automáticamente a nombre del titular responsable ({buyer.fullName || 'Responsable'}).
                          </p>

                          {Array.from({ length: companionCount }).map((_, idx) => (
                            <div key={`comp-${idx}`} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <label style={{ fontSize: '11px', color: '#fbbf24', fontWeight: 600 }}>
                                Nombre Acompañante #{idx + 1}
                              </label>
                              <input
                                type="text"
                                placeholder={`${buyer.fullName || 'Titular'} - Acompañante ${idx + 1}`}
                                value={customCompanionNames[idx] || ''}
                                onChange={e => {
                                  const updated = [...customCompanionNames]
                                  updated[idx] = e.target.value
                                  setCustomCompanionNames(updated)
                                }}
                                style={{ background: 'rgba(14, 26, 43, 0.8)', border: '1px solid var(--navy-card-border)', borderRadius: '4px', padding: '8px 10px', color: '#fff', fontSize: '13px' }}
                              />
                            </div>
                          ))}

                          {Array.from({ length: childrenCount }).map((_, idx) => (
                            <div key={`child-${idx}`} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <label style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 600 }}>
                                Nombre Menor &lt;3 años #{idx + 1}
                              </label>
                              <input
                                type="text"
                                placeholder={`${buyer.fullName || 'Titular'} - Menor <3 años ${childrenCount > 1 ? idx + 1 : ''}`}
                                value={customChildNames[idx] || ''}
                                onChange={e => {
                                  const updated = [...customChildNames]
                                  updated[idx] = e.target.value
                                  setCustomChildNames(updated)
                                }}
                                style={{ background: 'rgba(14, 26, 43, 0.8)', border: '1px solid var(--navy-card-border)', borderRadius: '4px', padding: '8px 10px', color: '#fff', fontSize: '13px' }}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                </div>
              </div>

              {/* Barra Resumen de Selección */}
              <div className="dark-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px', background: 'rgba(10, 21, 36, 0.75)', border: '1px solid #182d49', borderRadius: '10px', padding: '18px 22px' }}>
                <div>
                  <div style={{ fontSize: '12px', color: '#8a9ab5', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px' }}>
                    Entradas Seleccionadas
                  </div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#ffffff', marginTop: '2px' }}>
                    {quantity} {quantity === 1 ? 'Entrada' : 'Entradas'}
                    {quantity > 0 && (
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#00d2b4', marginLeft: '10px' }}>
                        ({players.length > 0 ? `${players.length} Jugador${players.length > 1 ? 'es' : ''}` : ''}
                        {players.length > 0 && companionCount > 0 ? ' · ' : ''}
                        {companionCount > 0 ? `${companionCount} Acompañante${companionCount > 1 ? 's' : ''}` : ''}
                        {(players.length > 0 || companionCount > 0) && childrenCount > 0 ? ' · ' : ''}
                        {childrenCount > 0 ? `${childrenCount} Menor${childrenCount > 1 ? 'es' : ''}` : ''})
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '12px', color: '#8a9ab5', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px' }}>
                    Total Estimado
                  </div>
                  <div style={{ fontSize: '26px', fontWeight: 900, color: total > 0 ? '#ff6874' : '#00d2b4', marginTop: '2px' }}>
                    {total > 0 ? money(total) : '¡GRATIS! ($0)'}
                  </div>
                </div>
              </div>

              {errorMessage && (
                <div className="error-banner">
                  <CircleHelp size={18} />
                  <span>{errorMessage}</span>
                </div>
              )}

              <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={() => { setCurrentStep('fiesta'); scrollToTop() }}>
                  <ArrowLeft size={16} /> Volver
                </button>
                <button
                  type="button"
                  className="btn-huge-red"
                  onClick={() => handleProceedToBuyerData()}
                  disabled={quantity === 0}
                  style={{ opacity: quantity === 0 ? 0.6 : 1 }}
                >
                  <span>CONTINUAR A CARGAR DATOS</span>
                  <ArrowRight size={18} />
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ══════════════════════════════════════════════════════════════
            SECCIÓN 2B: DATOS DEL RESPONSABLE Y RESUMEN DEL PEDIDO
           ══════════════════════════════════════════════════════════════ */}
        {(currentStep === 'datos' || currentStep === 'entradas_datos') && (
          <section className="step-section animate-fade">
            <div className="step-header">
              <button className="btn-back" onClick={() => { setCurrentStep('entradas'); scrollToTop() }}>
                <ArrowLeft size={16} /> Modificar Entradas
              </button>
              <div className="step-badge">PASO 2 DE 3 · TUS DATOS</div>
              <h1>Cargá tus datos de contacto</h1>
              <p>Persona que gestiona la compra (papá, mamá o titular) y a quien se enviarán las entradas con QR.</p>
            </div>

            {/* Resumen compacto de las entradas seleccionadas */}
            <div className="dark-card" style={{ padding: '14px 20px', background: 'rgba(10, 21, 36, 0.65)', border: '1px solid #182d49', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '22px' }}>🎟️</span>
                <div>
                  <strong style={{ fontSize: '15px', color: '#fff' }}>
                    {quantity} {quantity === 1 ? 'Entrada seleccionada' : 'Entradas seleccionadas'}
                  </strong>
                  <div style={{ fontSize: '12px', color: '#8a9ab5', marginTop: '2px' }}>
                    {players.length > 0 && `${players.length} Jugador(es) bonificado(s) `}
                    {companionCount > 0 && `· ${companionCount} Acompañante(s) con sorteo `}
                    {childrenCount > 0 && `· ${childrenCount} Menor(es) <3 `}
                    · Total a pagar: <b style={{ color: total > 0 ? '#ff6874' : '#00d2b4' }}>{money(total)}</b>
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn-dash-outline"
                style={{ padding: '6px 14px', fontSize: '12px', color: '#cbd5e1', borderColor: 'rgba(255, 255, 255, 0.2)' }}
                onClick={() => { setCurrentStep('entradas'); scrollToTop() }}
              >
                ✏️ Modificar cantidad
              </button>
            </div>

            <form onSubmit={handleProceedToPayment} className="form-container" noValidate>
              {/* 2. DATOS DEL RESPONSABLE DE LA COMPRA */}
              <div className="dark-card">
                <div className="card-top-header">
                  <div className="card-icon-round"><WalletCards size={20} /></div>
                  <div>
                    <h3>2. Datos de Contacto del Responsable</h3>
                    <p>Persona que gestiona la compra (papá, mamá o titular) y a quien se enviarán las entradas con QR</p>
                  </div>
                </div>

                <div className="form-grid-modern">
                  <div className="form-field full">
                    <label htmlFor="field-fullName">Nombre y Apellido Completo *</label>
                    <div className="input-with-tooltip-wrap">
                      <input
                        id="field-fullName"
                        type="text"
                        placeholder="Ej: Martín Rodríguez"
                        className={fieldErrors.fullName ? 'input-field-error' : ''}
                        value={buyer.fullName}
                        onChange={e => updateBuyer('fullName', e.target.value)}
                        onFocus={() => {
                          if (fieldErrors.fullName) {
                            setFieldErrors(prev => {
                              const next = { ...prev }
                              delete next.fullName
                              return next
                            })
                          }
                        }}
                      />
                      {fieldErrors.fullName && (
                        <div className="custom-validation-bubble" role="alert">
                          <div className="bubble-arrow" />
                          <span className="bubble-icon">!</span>
                          <span className="bubble-text">{fieldErrors.fullName}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="form-field">
                    <label htmlFor="field-dni">DNI del Responsable *</label>
                    <div className="input-with-tooltip-wrap">
                      <input
                        id="field-dni"
                        type="text"
                        inputMode="numeric"
                        placeholder="Sin puntos ni espacios"
                        className={fieldErrors.dni ? 'input-field-error' : ''}
                        value={buyer.dni}
                        onChange={e => updateBuyer('dni', e.target.value.replace(/\D/g, '').slice(0, 8))}
                        onFocus={() => {
                          if (fieldErrors.dni) {
                            setFieldErrors(prev => {
                              const next = { ...prev }
                              delete next.dni
                              return next
                            })
                          }
                        }}
                      />
                      {fieldErrors.dni && (
                        <div className="custom-validation-bubble" role="alert">
                          <div className="bubble-arrow" />
                          <span className="bubble-icon">!</span>
                          <span className="bubble-text">{fieldErrors.dni}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="form-field">
                    <label htmlFor="field-groupCategory">Categoría deportiva *</label>
                    <div className="input-with-tooltip-wrap">
                      <select
                        id="field-groupCategory"
                        className={`category-select-input ${fieldErrors.groupCategory ? 'input-field-error' : ''}`}
                        style={{ width: '100%', height: '44px' }}
                        value={groupCategory}
                        onChange={e => {
                          const newCat = e.target.value as Category | ''
                          setGroupCategory(newCat)
                          if (fieldErrors.groupCategory) {
                            setFieldErrors(prev => {
                              const next = { ...prev }
                              delete next.groupCategory
                              return next
                            })
                          }
                        }}
                        onFocus={() => {
                          if (fieldErrors.groupCategory) {
                            setFieldErrors(prev => {
                              const next = { ...prev }
                              delete next.groupCategory
                              return next
                            })
                          }
                        }}
                      >
                        <option value="">(Ninguno)</option>
                        {CATEGORIES.map(cat => (
                          <option key={cat} value={cat}>
                            Categoría {cat}
                          </option>
                        ))}
                      </select>
                      {fieldErrors.groupCategory && (
                        <div className="custom-validation-bubble" role="alert">
                          <div className="bubble-arrow" />
                          <span className="bubble-icon">!</span>
                          <span className="bubble-text">{fieldErrors.groupCategory}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="form-field full">
                    <label htmlFor="field-email">
                      Correo Electrónico *
                      <span className="highlight-tag">📧 Aquí te llegarán los QR de todas las entradas</span>
                    </label>
                    <div className="input-with-tooltip-wrap">
                      <input
                        id="field-email"
                        type="email"
                        placeholder="tu-correo@gmail.com"
                        className={fieldErrors.email ? 'input-field-error' : ''}
                        value={buyer.email}
                        onChange={e => updateBuyer('email', e.target.value)}
                        onFocus={() => {
                          if (fieldErrors.email) {
                            setFieldErrors(prev => {
                              const next = { ...prev }
                              delete next.email
                              return next
                            })
                          }
                        }}
                      />
                      {fieldErrors.email && (
                        <div className="custom-validation-bubble" role="alert">
                          <div className="bubble-arrow" />
                          <span className="bubble-icon">!</span>
                          <span className="bubble-text">{fieldErrors.email}</span>
                        </div>
                      )}
                    </div>
                    <small className="field-hint">
                      Asegurate de escribirlo correctamente. Te enviaremos todas las entradas emitidas a este correo.
                      <span style={{ display: 'block', color: '#fbbf24', marginTop: '4px', fontSize: '11.5px', fontWeight: '500' }}>
                        ⚠️ Recordá que el correo con tus entradas y códigos QR puede llegar a tu carpeta de <b>Spam</b> o <b>Correo no deseado</b>.
                      </span>
                    </small>
                  </div>
                </div>
              </div>

              {/* 3. RESUMEN EN VIVO DE ENTRADAS Y TOTAL */}
              <div className="dark-card">
                <div className="card-top-header">
                  <div className="card-icon-round"><CheckCircle2 size={20} /></div>
                  <div>
                    <h3>3. Resumen de tu Pedido</h3>
                    <p>Verificá la cantidad de entradas y el total antes de continuar</p>
                  </div>
                </div>

                <div className="ticket-pricing-summary" style={{ marginTop: '0' }}>
                  {players.length > 0 && (
                    <div className="summary-breakdown-row">
                      <span>⚽ Entradas Jugadores y Profes ({players.length}):</span>
                      <strong className="text-green">¡GRATIS! ($0)</strong>
                    </div>
                  )}
                  {childrenCount > 0 && (
                    <div className="summary-breakdown-row">
                      <span>👶 Menores de 3 años ({childrenCount}):</span>
                      <strong style={{ color: '#38bdf8' }}>¡GRATIS! ($0)</strong>
                    </div>
                  )}
                  {companionCount > 0 && (
                    <div className="summary-breakdown-row">
                      <span>🎟️ Acompañantes con Sorteo ({companionCount}):</span>
                      <strong>{money(companionCount * unitPrice)}</strong>
                    </div>
                  )}
                  <div className="summary-breakdown-row" style={{ fontSize: '12px', color: '#8a9ab5' }}>
                    <span>Categoría de referencia:</span>
                    <b style={{ color: '#ffffff' }}>{primaryCategory}</b>
                  </div>
                  <div className="summary-divider-line" />
                  <div className="summary-total-calc-row">
                    <span>Total a pagar ({quantity} entrada{quantity > 1 ? 's' : ''}):</span>
                    <strong className="total-amount-highlight">{money(total)}</strong>
                  </div>
                </div>
              </div>

              {errorMessage && (
                <div className="error-banner">
                  <CircleHelp size={18} />
                  <span>{errorMessage}</span>
                </div>
              )}

              <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={() => { setCurrentStep('entradas'); scrollToTop() }}>
                  <ArrowLeft size={16} /> Volver a Entradas
                </button>
                <button type="submit" className="btn-huge-red">
                  {total > 0 ? (
                    <>
                      <span>CONTINUAR AL PAGO POR ALIAS ({money(total)})</span>
                      <ArrowRight size={18} />
                    </>
                  ) : (
                    <>
                      <span>CONFIRMAR REGISTRO GRATUITO ($0)</span>
                      <ArrowRight size={18} />
                    </>
                  )}
                </button>
              </div>
            </form>
          </section>
        )}

        {/* ══════════════════════════════════════════════════════════════
            SECCIÓN 3: PAGO O CONFIRMACIÓN DIRECTA (SI TOTAL $0)
           ══════════════════════════════════════════════════════════════ */}
        {currentStep === 'pago' && (
          <section className="step-section animate-fade">
            <div className="step-header">
              <button className="btn-back" onClick={() => { setCurrentStep('datos'); scrollToTop() }}>
                <ArrowLeft size={16} /> Modificar datos o cantidad
              </button>
              <div className="step-badge">
                {total > 0 ? 'PASO 3 DE 3 · TRANSFERENCIA POR ALIAS' : 'PASO 3 DE 3 · CONFIRMACIÓN BONIFICADA'}
              </div>
              <h1>
                {total > 0 ? 'Transferí al alias oficial del club' : 'Entradas de Jugador / Profe 100% Bonificadas'}
              </h1>
              <p>
                {total > 0
                  ? 'Copiá el alias, hacé la transferencia desde tu banco o billetera virtual, y al confirmar te habilitará el envío del comprobante por WhatsApp.'
                  : 'Tus entradas corresponden a Jugadores o Profesores del Club y no tienen costo. Confirmá para recibir tus códigos QR al instante por correo.'}
              </p>
            </div>

            <div className="payment-grid-layout">
              {total > 0 ? (
                /* Tarjeta de Transferencia por Alias para Acompañantes */
                <div className="payment-options-col">
                  <div className="dark-card alias-main-card">
                    <div className="alias-badge-header">
                      <span className="alias-pill">PAGO OFICIAL ATSC</span>
                      <span className="alias-only-note">Medio de pago único</span>
                    </div>

                    <h3 className="alias-box-title">Datos para transferir:</h3>

                    {/* Caja destacada del Alias */}
                    <div className="alias-highlight-box">
                      <div className="alias-info-col">
                        <small>ALIAS BANCARIO OFICIAL:</small>
                        <strong className="alias-code">{CLUB_ALIAS}</strong>
                      </div>
                      <button
                        type="button"
                        className={`btn-copy-alias ${copiedAlias ? 'copied' : ''}`}
                        onClick={handleCopyAlias}
                      >
                        {copiedAlias ? (
                          <>
                            <Check size={16} /> ¡COPIADO!
                          </>
                        ) : (
                          <>
                            <Copy size={16} /> COPIAR ALIAS
                          </>
                        )}
                      </button>
                    </div>

                    {/* Detalles bancarios */}
                    <div className="alias-details-list">
                      <div className="cbu-row">
                        <span>Importe exacto a transferir:</span>
                        <strong className="text-red-huge">{money(total)}</strong>
                      </div>
                      <div className="cbu-row">
                        <span>Desglose de cobro:</span>
                        <b>
                          {companionCount} acompañante(s) a {money(unitPrice)}
                          {players.length > 0 ? ` (+ ${players.length} jugador/es o profe/s gratis)` : ''}
                          {childrenCount > 0 ? ` (+ ${childrenCount} menor/es <3 años gratis)` : ''}
                        </b>
                      </div>
                      <div className="cbu-row">
                        <span>Titular de la cuenta:</span>
                        <b>{CLUB_TITULAR}</b>
                      </div>
                      <div className="cbu-row">
                        <span>Banco / Billetera:</span>
                        <b>{CLUB_BANCO}</b>
                      </div>
                      {CLUB_CBU ? (
                        <div className="cbu-row">
                          <span>CBU / CVU:</span>
                          <code>{CLUB_CBU}</code>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : (
                /* Tarjeta especial para Orden de $0 (Solo Jugadores / Menores) */
                <div className="payment-options-col">
                  <div className="dark-card zero-cost-banner-card">
                    <div className="zero-icon-pill">⚽ ENTRADA BONIFICADA ATSC</div>
                    <h3 style={{ fontSize: '22px', margin: '14px 0 8px', color: '#00d2b4' }}>
                      ¡Registro sin costo de acceso!
                    </h3>
                    <p style={{ color: '#c2cad7', lineHeight: '1.6', fontSize: '14px' }}>
                      Como seleccionaste únicamente entradas bonificadas ({quantity} entrada{quantity > 1 ? 's' : ''}), <b>el valor total es de $0</b>. No tenés que realizar ninguna transferencia ni enviar comprobante bancario.
                    </p>
                    <div style={{ marginTop: '18px', padding: '14px', background: 'rgba(0, 210, 180, 0.08)', borderRadius: '8px', border: '1px solid rgba(0, 210, 180, 0.25)', fontSize: '13px', color: '#ffffff' }}>
                      🎟️ <b>Recordatorio de sorteo:</b> Las entradas bonificadas permiten el acceso gratuito al evento pero no cuentan con número para el sorteo de premios.
                    </div>
                  </div>
                </div>
              )}

              {/* Resumen y Botón de Confirmación */}
              <div className="summary-col">
                <div className="dark-card summary-card">
                  <h3>Resumen del Pedido</h3>
                  <div className="summary-rows">
                    <div className="sum-row">
                      <span>Evento:</span>
                      <b>Cena Fin de Año 2026</b>
                    </div>
                    <div className="sum-row">
                      <span>Titular:</span>
                      <b>{buyer.fullName}</b>
                    </div>
                    <div className="sum-row">
                      <span>DNI:</span>
                      <span>{buyer.dni}</span>
                    </div>
                    <div className="sum-row">
                      <span>Email para recibir QR:</span>
                      <b className="email-highlight">{buyer.email}</b>
                    </div>
                    <div className="sum-divider" />
                    <div className="sum-row">
                      <span>⚽ Jugadores / Profes ($0):</span>
                      <b className="text-green">{players.length}</b>
                    </div>
                    {childrenCount > 0 && (
                      <div className="sum-row">
                        <span>👶 Menores &lt;3 años ($0):</span>
                        <b style={{ color: '#38bdf8' }}>{childrenCount}</b>
                      </div>
                    )}
                    <div className="sum-row">
                      <span>🎟️ Acompañantes ({money(unitPrice)}):</span>
                      <b>{companionCount}</b>
                    </div>
                    <div className="sum-row" style={{ fontSize: '12px' }}>
                      <span>Categoría:</span>
                      <b>{primaryCategory}</b>
                    </div>
                    <div className="sum-row total-highlight">
                      <span>TOTAL A PAGAR:</span>
                      <strong className="price-total">{money(total)}</strong>
                    </div>
                  </div>

                  {errorMessage && (
                    <div className="error-banner" style={{ marginTop: '15px' }}>
                      <CircleHelp size={16} />
                      <span>{errorMessage}</span>
                    </div>
                  )}

                  <button
                    className="btn-huge-red full-width"
                    onClick={handleRegisterOrder}
                    disabled={busy}
                  >
                    {busy ? (
                      <>
                        <RefreshCw size={18} className="spinner" />
                        <span>PROCESANDO REGISTRO...</span>
                      </>
                    ) : total > 0 ? (
                      <>
                        <Check size={18} />
                        <span>REGISTRAR Y ENVIAR COMPROBANTE</span>
                        <ArrowRight size={18} />
                      </>
                    ) : (
                      <>
                        <Sparkles size={18} />
                        <span>CONFIRMAR REGISTRO Y OBTENER QR</span>
                        <ArrowRight size={18} />
                      </>
                    )}
                  </button>

                  <div className="security-guarantee">
                    <ShieldCheck size={16} />
                    <span>Validación directa por administración de Andes Talleres</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ══════════════════════════════════════════════════════════════
            SECCIÓN 4: CONFIRMACIÓN Y COMPROBANTE
           ══════════════════════════════════════════════════════════════ */}
        {currentStep === 'confirmacion' && orderConfirmation && (
          <section className="step-section animate-fade">
            {orderConfirmation.totalArs === 0 ? (
              /* Banner de Éxito Inmediato para Jugadores ($0) */
              <div className="confirmed-success-banner">
                <div className="confirmed-icon-wrap">
                  <CheckCircle2 size={50} color="#00d2b4" />
                </div>
                <span className="status-badge-free">REGISTRO CONFIRMADO · BONIFICADO ($0)</span>
                <h1>¡REGISTRO CONFIRMADO #{orderConfirmation.orderId}!</h1>
                <p>
                  Tus entradas de jugador / profesor quedaron registradas y confirmadas. Te enviamos el correo electrónico con los códigos QR a <b>{orderConfirmation.buyer.email}</b>.
                </p>
                <div style={{ maxWidth: '580px', margin: '18px auto 0', background: 'rgba(251, 191, 36, 0.1)', border: '1px solid rgba(251, 191, 36, 0.35)', borderRadius: '8px', padding: '12px 18px', textAlign: 'left', display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <AlertCircle size={24} style={{ color: '#fbbf24', flexShrink: 0 }} />
                  <div style={{ fontSize: '13px', color: '#e2e8f0', lineHeight: '1.5' }}>
                    <strong style={{ color: '#fbbf24', display: 'block', marginBottom: '2px' }}>¿No encontrás el correo en tu bandeja de entrada?</strong>
                    Revisá tu carpeta de <b>Spam</b>, <b>Correo no deseado</b> o <b>Promociones</b> en <b>{orderConfirmation.buyer.email}</b>. A veces los filtros de correo desvían los correos automáticos con códigos QR adjuntos.
                  </div>
                </div>
              </div>
            ) : (
              /* Banner de Validación Pendiente para Transferencia con Acompañantes */
              <div className="pending-confirmation-banner">
                <div className="pending-icon-wrap">
                  <AlertCircle size={46} />
                </div>
                <span className="status-badge-pending">PENDIENTE DE VALIDACIÓN</span>
                <h1>¡PEDIDO REGISTRADO #{orderConfirmation.orderId}!</h1>
                <p>
                  Para confirmar tu compra de acompañante(s), por favor <b>envianos el comprobante de transferencia por WhatsApp</b>.
                </p>
              </div>
            )}

            {/* Si es de pago (> $0), gran botón de WhatsApp */}
            {orderConfirmation.totalArs > 0 && (
              <div className="whatsapp-cta-card">
                <div className="wa-card-header">
                  <div className="wa-icon-circle">
                    <MessageCircle size={28} />
                  </div>
                  <div>
                    <h3>Paso Final: Enviar Comprobante</h3>
                    <p>Hacé clic en el botón para abrir WhatsApp con los datos de tu pedido ya listos para adjuntar la captura del comprobante.</p>
                  </div>
                </div>

                <a
                  href={getWhatsAppUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-whatsapp-huge"
                >
                  <MessageCircle size={22} />
                  <span>ENVIAR COMPROBANTE POR WHATSAPP</span>
                </a>

                <div style={{ textAlign: 'center', fontSize: '13px', color: '#8a9ab5', marginTop: '-6px' }}>
                  <span>WhatsApp de comprobantes: <b>+54 9 261 575-1033</b> (2615751033)</span>
                </div>

                <div className="resend-info-note">
                  <p>
                    📧 <b>¿Cuándo me llega la entrada con el código QR?</b><br />
                    Apenas el equipo de administración verifique el pago en el banco, <b>recibirás automáticamente un correo a {orderConfirmation.buyer.email}</b> con los códigos QR de acceso para cada asistente.
                  </p>
                  <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(255, 255, 255, 0.1)', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '17px', lineHeight: '1' }}>⚠️</span>
                    <div style={{ color: '#fbbf24', fontSize: '12.5px', lineHeight: '1.5' }}>
                      <b>Atención importante sobre el correo:</b> Si tras la confirmación de la orden no ves el correo en tu Bandeja Principal, <b>revisá tu carpeta de Spam, Correo no deseado o Promociones</b>. Para evitar que vuelva a ocurrir, podés marcarlo como "No es spam".
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Listado de Entradas Generadas */}
            <div className="dark-card" style={{ marginTop: '24px' }}>
              <div className="card-top-header">
                <div>
                  <h3>Detalle de Entradas ({orderConfirmation.quantity})</h3>
                  <p>Pedido: <b>#{orderConfirmation.orderId}</b> · Titular: <b>{orderConfirmation.buyer.fullName}</b></p>
                </div>
                <div className="card-right-badge">Total: {money(orderConfirmation.totalArs)}</div>
              </div>

              <div className="confirmation-tickets-grid">
                {orderConfirmation.tickets.map((t, idx) => (
                  <div key={idx} className="conf-ticket-card">
                    <div className="conf-ticket-top">
                      {t.role === 'menor' ? (
                        <span className="badge-player-pill" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.3)' }}>
                          👶 MENOR &lt;3 AÑOS ($0 · Sin sorteo)
                        </span>
                      ) : t.isPlayer ? (
                        <span className="badge-player-pill">⚽ JUGADOR / PROFE ($0 · Sin sorteo)</span>
                      ) : (
                        <span className="badge-raffle-pill">🎟️ SORTEO N° {t.ticketNumber}</span>
                      )}
                      <span className="conf-club-tag">ATSC 2026</span>
                    </div>
                    <div className="conf-ticket-name">{t.attendeeName}</div>
                    <small className="conf-ticket-event">Cena de Fin de Año 2026 · Estadio Salvador Bonanno</small>

                    {confirmationQrUrls[t.qrToken] && (
                      <div className="conf-qr-display">
                        <img
                          src={confirmationQrUrls[t.qrToken]}
                          alt={`QR Entrada ${t.ticketNumber}`}
                          className="conf-qr-img"
                        />
                        <small className="conf-qr-token">{t.qrToken.slice(0, 16)}...</small>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="confirmation-final-actions" style={{ marginTop: '30px' }}>
              <button
                className="btn-secondary"
                onClick={() => {
                  setCurrentStep('fiesta')
                  setOrderConfirmation(null)
                  setConfirmationQrUrls({})
                  scrollToTop()
                }}
              >
                Volver al inicio
              </button>
            </div>
          </section>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="footer">
        <div className="brand footer-brand" onClick={() => setCurrentStep('fiesta')} style={{ cursor: 'pointer' }}>
          <ClubLogo url={logoUrl} size="sm" />
          <div className="brand-name">
            ANDES TALLERES
            <span>SPORT CLUB · MENDOZA</span>
          </div>
        </div>
        <div className="footer-right">
          <div>ORGULLO AZULGRANA DESDE 1933 <b>✳</b> SOMOS FAMILIA</div>
          <button
            className="footer-admin-btn"
            onClick={handleOpenAdmin}
          >
            🔒 Panel Admin / Escáner QR
          </button>
        </div>
        <small>© 2026 Andes Talleres Sport Club. Sistema oficial de venta y emisión de entradas digitales.</small>
      </footer>
    </div>
  )
}

export default App
