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
const CLUB_ALIAS = (import.meta.env.VITE_CLUB_ALIAS as string) || 'ANDES.TALLERES.FUTSAL'
const CLUB_CBU = '0170081720000001234567'
const CLUB_TITULAR = 'Andes Talleres Sport Club'
const WHATSAPP_PHONE = (import.meta.env.VITE_WHATSAPP_PHONE as string) || '5492610000000'

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

  // ── Logo y configuración del evento desde Supabase ──
  const [logoUrl, setLogoUrl] = useState<string | null>(
    (import.meta.env.VITE_CLUB_LOGO_URL as string) || null
  )
  const [unitPrice, setUnitPrice] = useState<number>(DEFAULT_PRICE_ARS)

  // ── Selección clara y estructurada de entradas del grupo ──
  interface PlayerAttendeeItem {
    name: string
    category: Category
  }

  // Jugadores del club ($0 - entrada bonificada, sin número de sorteo)
  const [players, setPlayers] = useState<PlayerAttendeeItem[]>([])

  // Acompañantes / Familiares que abonan entrada ($unitPrice) y participan del sorteo
  const [companionCount, setCompanionCount] = useState<number>(0)

  // Categoría por defecto si no hay jugadores en el grupo
  const [groupCategory, setGroupCategory] = useState<Category>('Escuelita')

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
  const primaryCategory = useMemo<Category>(() => {
    return players[0]?.category || groupCategory
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
  }

  // Copiar alias al portapapeles
  const handleCopyAlias = () => {
    navigator.clipboard.writeText(CLUB_ALIAS)
    setCopiedAlias(true)
    setTimeout(() => setCopiedAlias(false), 2500)
  }

  // ── Validación paso 2: Entradas y Datos ──
  const handleProceedToPayment = (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage('')

    if (!buyer.fullName.trim() || !buyer.dni.trim() || !buyer.email.trim()) {
      setErrorMessage('Por favor completá todos los datos obligatorios del responsable.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.email)) {
      setErrorMessage('Ingresá un correo electrónico válido para recibir las entradas con código QR.')
      return
    }
    if (buyer.dni.length < 7) {
      setErrorMessage('Ingresá un número de DNI válido.')
      return
    }
    if (quantity < 1) {
      setErrorMessage('Debés seleccionar al menos una entrada para continuar.')
      return
    }

    // Validar que cada jugador tenga su nombre y apellido
    for (let i = 0; i < players.length; i++) {
      if (!players[i].name.trim()) {
        setErrorMessage(
          players.length === 1
            ? 'Por favor ingresá el nombre y apellido del jugador.'
            : `Por favor ingresá el nombre y apellido del Jugador #${i + 1}.`
        )
        return
      }
    }

    setCurrentStep('pago')
    window.scrollTo({ top: 0, behavior: 'smooth' })
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

      // A) Entradas de Jugadores (bonificadas $0, sin sorteo)
      for (let i = 0; i < players.length; i++) {
        const p = players[i]
        const pName = p.name.trim() || `${buyer.fullName.trim()} (Jugador)`
        tickets.push({
          ticketNumber: 'JUGADOR',
          attendeeName: `${pName} (Jugador · ${p.category})`,
          qrToken: makeUuid(),
          orderId: displayOrderId,
          eventName: 'Cena de Fin de Año 2026 - Andes Talleres',
          date: 'Sábado 19 de Diciembre de 2026 · 21:30 hs',
          venue: 'Microestadio Andes Talleres · Godoy Cruz, Mendoza',
          isPlayer: true,
          role: 'jugador',
          category: p.category,
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
          eventName: 'Cena de Fin de Año 2026 - Andes Talleres',
          date: 'Sábado 19 de Diciembre de 2026 · 21:30 hs',
          venue: 'Microestadio Andes Talleres · Godoy Cruz, Mendoza',
          isPlayer: false,
          role: 'acompanante',
          category: primaryCategory,
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
          eventName: 'Cena de Fin de Año 2026 - Andes Talleres',
          date: 'Sábado 19 de Diciembre de 2026 · 21:30 hs',
          venue: 'Microestadio Andes Talleres · Godoy Cruz, Mendoza',
          isPlayer: true,
          role: 'menor',
          category: primaryCategory,
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
          category: t.category || primaryCategory
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
      window.scrollTo({ top: 0, behavior: 'smooth' })

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
    const msg = `¡Hola! Te envío el comprobante de transferencia para la Cena de Fin de Año de Andes Talleres.\n\n*Pedido:* #${orderConfirmation.orderId}\n*Titular:* ${orderConfirmation.buyer.fullName}\n*DNI:* ${orderConfirmation.buyer.dni}\n*Categoría:* ${primaryCategory}\n*Entradas:* ${orderConfirmation.quantity}\n*Total:* ${money(orderConfirmation.totalArs)}\n*Email:* ${orderConfirmation.buyer.email}`
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
          <div className={`nav-step ${currentStep === 'entradas_datos' ? 'active' : ''}`} onClick={() => { if (currentStep !== 'fiesta') setCurrentStep('entradas_datos') }}>
            <span className="step-num">2</span>
            <span className="step-label">Entradas</span>
          </div>
          <span className="step-div">›</span>
          <div className={`nav-step ${currentStep === 'pago' ? 'active' : ''}`}>
            <span className="step-num">3</span>
            <span className="step-label">Pago</span>
          </div>
          <span className="step-div">›</span>
          <div className={`nav-step ${currentStep === 'confirmacion' ? 'active' : ''}`}>
            <span className="step-num">4</span>
            <span className="step-label">Comprobante</span>
          </div>
        </div>

        <div className="nav-actions">
          {currentStep === 'fiesta' && (
            <button className="nav-cta" onClick={() => setCurrentStep('entradas_datos')}>
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
                  <span>Andes Talleres · Godoy Cruz</span>
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
                    setCurrentStep('entradas_datos')
                    window.scrollTo({ top: 0, behavior: 'smooth' })
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
            SECCIÓN 2: SELECCIÓN DE ENTRADAS Y DATOS DEL COMPRADOR
           ══════════════════════════════════════════════════════════════ */}
        {currentStep === 'entradas_datos' && (
          <section className="step-section animate-fade">
            <div className="step-header">
              <button className="btn-back" onClick={() => setCurrentStep('fiesta')}>
                <ArrowLeft size={16} /> Volver
              </button>
              <div className="step-badge">PASO 2 DE 3</div>
              <h1>Armá tu grupo y completá tus datos</h1>
              <p>Indicá quiénes van a la fiesta y completá los datos del responsable para recibir los códigos QR.</p>
            </div>

            <form onSubmit={handleProceedToPayment} className="form-container">
              {/* 1. SELECCIÓN DE ENTRADAS DEL GRUPO */}
              <div className="dark-card">
                <div className="card-top-header">
                  <div className="card-icon-round"><Users size={20} /></div>
                  <div>
                    <h3>1. Entradas del Grupo (¿Quiénes van a la fiesta?)</h3>
                    <p>Podés sumar a jugadores del club, acompañantes mayores y niños menores de 3 años</p>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

                  {/* BLOQUE A: JUGADORES DEL CLUB (GRATIS $0) */}
                  <div className="ticket-counter-box" style={{ background: 'rgba(0, 210, 180, 0.05)', border: '1px solid rgba(0, 210, 180, 0.3)', borderRadius: '8px', padding: '16px' }}>
                    <div className="counter-info">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <strong style={{ color: '#00d2b4', fontSize: '15px' }}>⚽ Jugadores del Club</strong>
                        <span style={{ background: 'rgba(0, 210, 180, 0.2)', color: '#00d2b4', fontSize: '11px', fontWeight: 800, padding: '2px 8px', borderRadius: '4px' }}>
                          ¡ENTRADA BONIFICADA ($0)!
                        </span>
                      </div>
                      <span style={{ fontSize: '13px', color: '#c2cad7' }}>
                        Chicos o jugadores de cualquier división (Escuelita, C5 hasta Primera, Seniors).
                      </span>
                      <small style={{ color: '#8a9ab5', display: 'block', marginTop: '4px' }}>
                        Entrada bonificada sin costo al 100% · No participan del sorteo de premios
                      </small>
                    </div>

                    <div className="stepper-modern">
                      <button
                        type="button"
                        aria-label="Restar jugador"
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
                        aria-label="Sumar jugador"
                        onClick={() => {
                          if (players.length < 10) {
                            setPlayers(prev => [
                              ...prev,
                              { name: '', category: prev[prev.length - 1]?.category || groupCategory || 'Escuelita' }
                            ])
                          }
                        }}
                        disabled={players.length >= 10}
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                  </div>

                  {/* CARDS DE DATOS DE JUGADORES (SI HAY 1 O MÁS) */}
                  {players.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '-6px', marginBottom: '8px' }}>
                      {players.map((p, idx) => (
                        <div key={`player-${idx}`} className="player-input-card">
                          <div className="player-card-header">
                            <span className="player-index-badge">
                              ⚽ Datos del Jugador #{idx + 1}
                            </span>
                          </div>

                          <div className="player-inputs-row">
                            <div className="form-field">
                              <label>Nombre y Apellido del Jugador *</label>
                              <input
                                type="text"
                                placeholder="Ej: Mateo Rodríguez"
                                value={p.name}
                                onChange={e => {
                                  const val = e.target.value
                                  setPlayers(prev => prev.map((item, i) => i === idx ? { ...item, name: val } : item))
                                }}
                                required
                              />
                            </div>
                            <div className="form-field">
                              <label>Categoría / División *</label>
                              <select
                                className="category-select-input"
                                value={p.category}
                                onChange={e => {
                                  const val = e.target.value as Category
                                  setPlayers(prev => prev.map((item, i) => i === idx ? { ...item, category: val } : item))
                                }}
                              >
                                {CATEGORIES.map(cat => (
                                  <option key={cat} value={cat}>
                                    Categoría {cat}
                                  </option>
                                ))}
                              </select>
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
                    <label>Nombre y Apellido Completo *</label>
                    <input
                      type="text"
                      required
                      placeholder="Ej: Martín Rodríguez"
                      value={buyer.fullName}
                      onChange={e => updateBuyer('fullName', e.target.value)}
                    />
                  </div>

                  <div className="form-field">
                    <label>DNI del Responsable *</label>
                    <input
                      type="text"
                      required
                      inputMode="numeric"
                      placeholder="Sin puntos ni espacios"
                      value={buyer.dni}
                      onChange={e => updateBuyer('dni', e.target.value.replace(/\D/g, '').slice(0, 8))}
                    />
                  </div>

                  <div className="form-field">
                    <label>Categoría deportiva *</label>
                    <select
                      className="category-select-input"
                      style={{ width: '100%', height: '44px' }}
                      value={groupCategory}
                      onChange={e => {
                        const newCat = e.target.value as Category
                        setGroupCategory(newCat)
                        setPlayers(prev => prev.map(p => ({ ...p, category: p.category === groupCategory ? newCat : p.category })))
                      }}
                      required
                    >
                      {CATEGORIES.map(cat => (
                        <option key={cat} value={cat}>
                          Categoría {cat}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-field full">
                    <label>
                      Correo Electrónico *
                      <span className="highlight-tag">📧 Aquí te llegarán los QR de todas las entradas</span>
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="tu-correo@gmail.com"
                      value={buyer.email}
                      onChange={e => updateBuyer('email', e.target.value)}
                    />
                    <small className="field-hint">Asegurate de escribirlo correctamente. Te enviaremos todas las entradas emitidas a este correo.</small>
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
                      <span>⚽ Entradas Jugadores ({players.length}):</span>
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
                <button type="button" className="btn-secondary" onClick={() => setCurrentStep('fiesta')}>
                  <ArrowLeft size={16} /> Volver
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
              <button className="btn-back" onClick={() => setCurrentStep('entradas_datos')}>
                <ArrowLeft size={16} /> Modificar datos o cantidad
              </button>
              <div className="step-badge">
                {total > 0 ? 'PASO 3 DE 3 · TRANSFERENCIA POR ALIAS' : 'PASO 3 DE 3 · CONFIRMACIÓN BONIFICADA'}
              </div>
              <h1>
                {total > 0 ? 'Transferí al alias oficial del club' : 'Entradas de Jugador 100% Bonificadas'}
              </h1>
              <p>
                {total > 0
                  ? 'Copiá el alias, hacé la transferencia desde tu banco o billetera virtual, y al confirmar te habilitará el envío del comprobante por WhatsApp.'
                  : 'Tus entradas corresponden a Jugadores del Club y no tienen costo. Confirmá para recibir tus códigos QR al instante por correo.'}
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
                          {players.length > 0 ? ` (+ ${players.length} jugador/es gratis)` : ''}
                          {childrenCount > 0 ? ` (+ ${childrenCount} menor/es <3 años gratis)` : ''}
                        </b>
                      </div>
                      <div className="cbu-row">
                        <span>Titular de la cuenta:</span>
                        <b>{CLUB_TITULAR}</b>
                      </div>
                      <div className="cbu-row">
                        <span>CBU:</span>
                        <code>{CLUB_CBU}</code>
                      </div>
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
                      <span>⚽ Jugadores ($0):</span>
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
                  Tus entradas de jugador quedaron registradas y confirmadas. Te enviamos el correo electrónico con los códigos QR a <b>{orderConfirmation.buyer.email}</b>.
                </p>
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

                <div className="resend-info-note">
                  <p>
                    📧 <b>¿Cuándo me llega la entrada con el código QR?</b><br />
                    Apenas el equipo de administración verifique el pago en el banco, <b>recibirás automáticamente un correo a {orderConfirmation.buyer.email}</b> con los códigos QR de acceso para cada asistente.
                  </p>
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
                        <span className="badge-player-pill">⚽ JUGADOR ($0 · Sin sorteo)</span>
                      ) : (
                        <span className="badge-raffle-pill">🎟️ SORTEO N° {t.ticketNumber}</span>
                      )}
                      <span className="conf-club-tag">ATSC 2026</span>
                    </div>
                    <div className="conf-ticket-name">{t.attendeeName}</div>
                    <small className="conf-ticket-event">Cena de Fin de Año 2026 · Microestadio ATSC</small>

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
                  window.scrollTo({ top: 0, behavior: 'smooth' })
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
