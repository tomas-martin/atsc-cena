import { useMemo, useState, useEffect } from 'react'
import {
  ArrowRight, ArrowLeft, CircleHelp,
  Minus, Plus, ShieldCheck, Ticket,
  WalletCards, Calendar, MapPin, Users,
  RefreshCw, Check, Copy, MessageCircle, AlertCircle, LockKeyhole
} from 'lucide-react'
import { supabase } from './lib/supabase'
import AdminPage from './AdminPage'
import {
  type BuyerDetails,
  type Step,
  type IssuedTicket,
  type OrderConfirmation
} from './types'

// Precio base de referencia por entrada en ARS (si Supabase no define otro)
const DEFAULT_PRICE_ARS = 25000
const MAX_PER_ORDER = 10

// Datos bancarios y de contacto oficiales
const CLUB_ALIAS = (import.meta.env.VITE_CLUB_ALIAS as string) || 'ANDES.TALLERES.FUTSAL'
const CLUB_CBU = '0170081720000001234567'
const CLUB_TITULAR = 'Andes Talleres Sport Club'
const WHATSAPP_PHONE = (import.meta.env.VITE_WHATSAPP_PHONE as string) || '5492610000000'

const money = (amount: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(amount)

// Componente para mostrar el Logo de Andes Talleres (imagen de Supabase o escudo azulgrana oficial)
function ClubLogo({
  url,
  size = 'md',
  className = ''
}: {
  url?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const [imgError, setImgError] = useState(false)

  if (url && !imgError) {
    return (
      <img
        src={url}
        alt="Andes Talleres Sport Club"
        className={`club-logo-img logo-${size} ${className}`}
        onError={() => setImgError(true)}
      />
    )
  }

  return (
    <div className={`brand-shield shield-${size} ${className}`} aria-label="Andes Talleres">
      <span>AT</span>
      <small>SC</small>
    </div>
  )
}

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
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const handleCloseAdmin = () => {
    setShowAdmin(false)
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  if (showAdmin) return <AdminPage onBack={handleCloseAdmin} />

  // ── Estados de la navegación por secciones ──
  const [currentStep, setCurrentStep] = useState<Step>('fiesta')

  // ── Logo y configuración del evento desde Supabase ──
  const [logoUrl, setLogoUrl] = useState<string | null>(
    (import.meta.env.VITE_CLUB_LOGO_URL as string) || null
  )
  const [unitPrice, setUnitPrice] = useState<number>(DEFAULT_PRICE_ARS)

  // ── Selección de entradas y comprador ──
  const [quantity, setQuantity] = useState(1)
  const [buyer, setBuyer] = useState<BuyerDetails>({
    fullName: '',
    dni: '',
    email: '',
    phone: '',
    attendees: ['']
  })

  // Pago: Exclusivo Transferencia por Alias
  const [transferRef, setTransferRef] = useState('')
  const [copiedAlias, setCopiedAlias] = useState(false)

  // ── Procesamiento y Confirmación ──
  const [busy, setBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [orderConfirmation, setOrderConfirmation] = useState<OrderConfirmation | null>(null)

  const total = useMemo(() => unitPrice * quantity, [unitPrice, quantity])

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

  // Sincronizar array de asistentes con la cantidad seleccionada
  useEffect(() => {
    setBuyer(prev => {
      const currentList = prev.attendees || []
      const newList = Array.from({ length: quantity }, (_, idx) => {
        if (idx === 0) return currentList[0] || prev.fullName
        return currentList[idx] || ''
      })
      return { ...prev, attendees: newList }
    })
  }, [quantity])

  const updateBuyer = (field: keyof BuyerDetails, value: string) => {
    setBuyer(current => {
      const updated = { ...current, [field]: value }
      if (field === 'fullName' && (!updated.attendees || !updated.attendees[0] || updated.attendees[0] === current.fullName)) {
        const att = [...(updated.attendees || [])]
        att[0] = value
        updated.attendees = att
      }
      return updated
    })
  }

  const updateAttendee = (index: number, name: string) => {
    setBuyer(current => {
      const list = [...(current.attendees || [])]
      list[index] = name
      return { ...current, attendees: list }
    })
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

    if (!buyer.fullName.trim() || !buyer.dni.trim() || !buyer.email.trim() || !buyer.phone.trim()) {
      setErrorMessage('Por favor completá todos los campos obligatorios para continuar.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.email)) {
      setErrorMessage('Ingresá un correo electrónico válido para recibir las entradas.')
      return
    }
    if (buyer.dni.length < 7) {
      setErrorMessage('Ingresá un número de DNI válido.')
      return
    }

    setCurrentStep('pago')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ── Registro del pedido pendiente de confirmación ──
  const handleRegisterOrder = async () => {
    setErrorMessage('')
    setBusy(true)

    try {
      let savedOrderId = ''

      // 1. Guardar pedido en Supabase con estado PENDIENTE
      if (supabase) {
        const { data: orderData, error: orderErr } = await supabase.from('orders').insert({
          buyer_full_name: buyer.fullName,
          buyer_dni: buyer.dni,
          buyer_email: buyer.email,
          buyer_phone: buyer.phone,
          quantity,
          unit_price_ars: unitPrice,
          total_ars: total,
          payment_method: 'transferencia',
          status: 'pendiente',
          transfer_reference: transferRef || null,
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

      // 2. Generar tickets con UUIDs válidos para la base de datos
      const tickets: IssuedTicket[] = Array.from({ length: quantity }, (_, i) => {
        const uuidToken = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
              const r = (Math.random() * 16) | 0
              const v = c === 'x' ? r : (r & 0x3) | 0x8
              return v.toString(16)
            })

        const attendeeName = (buyer.attendees && buyer.attendees[i] && buyer.attendees[i].trim())
          ? buyer.attendees[i].trim()
          : (i === 0 ? buyer.fullName : `Acompañante ${i + 1}`)

        return {
          ticketNumber: `ATSC-${String(i + 1).padStart(2, '0')}-${displayOrderId.replace('ATSC-', '')}`,
          attendeeName,
          qrToken: uuidToken,
          orderId: displayOrderId,
          eventName: 'Cena de Fin de Año 2026 - Andes Talleres',
          date: 'Sábado 19 de Diciembre de 2026 · 21:30 hs',
          venue: 'Microestadio Andes Talleres Sport Club · Godoy Cruz, Mendoza',
        }
      })

      // 3. Guardar tickets en Supabase
      if (supabase && savedOrderId) {
        const ticketRows = tickets.map(t => ({
          order_id: savedOrderId,
          attendee_name: t.attendeeName,
          qr_token: t.qrToken,
          status: 'valid'
        }))
        const { error: ticketErr } = await supabase.from('tickets').insert(ticketRows)
        if (ticketErr) {
          console.warn('Registro de tickets en Supabase:', ticketErr)
        }
      }

      const conf: OrderConfirmation = {
        orderId: displayOrderId,
        buyer,
        quantity,
        totalArs: total,
        paymentMethod: 'transferencia',
        tickets,
        emailSent: false,
      }
      setOrderConfirmation(conf)

      // Pasar a la pantalla de confirmación pendiente y envío de WhatsApp
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
    const msg = `¡Hola! Te envío el comprobante de transferencia para la Cena de Fin de Año de Andes Talleres.\n\n*Pedido:* #${orderConfirmation.orderId}\n*Titular:* ${orderConfirmation.buyer.fullName}\n*DNI:* ${orderConfirmation.buyer.dni}\n*Entradas:* ${orderConfirmation.quantity}\n*Total:* ${money(orderConfirmation.totalArs)}\n*Email:* ${orderConfirmation.buyer.email}`
    return `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(msg)}`
  }

  return (
    <div className="site-shell">
      {/* ── Banner Superior ── */}
      <div className="announcement">
        <span className="ann-badge">ATSC</span>
        <span>CENA DE FIN DE AÑO 2026 · ANDES TALLERES SPORT CLUB</span>
      </div>

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
          <button className="nav-admin-btn" onClick={handleOpenAdmin} title="Ingreso al Panel Administrador">
            <LockKeyhole size={13} />
            <span>Admin</span>
          </button>
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
                  <span>Microestadio Andes Talleres · Godoy Cruz</span>
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
              <h1>Seleccioná tus entradas y completá tus datos</h1>
              <p>Elegí la cantidad de entradas e ingresá el correo donde recibirás los códigos QR tras confirmar el pago.</p>
            </div>

            <form onSubmit={handleProceedToPayment} className="form-container">
              {/* Selector de Cantidad */}
              <div className="dark-card">
                <div className="card-top-header">
                  <div className="card-icon-round"><Ticket size={20} /></div>
                  <div>
                    <h3>Cantidad de Entradas</h3>
                    <p>Entrada Cena de Fin de Año 2026</p>
                  </div>
                  <div className="card-right-badge">Máx. {MAX_PER_ORDER} entradas</div>
                </div>

                <div className="ticket-counter-box">
                  <div className="counter-info">
                    <strong>Precio por persona:</strong>
                    <span className="price-big">{money(unitPrice)}</span>
                  </div>

                  <div className="stepper-modern">
                    <button
                      type="button"
                      aria-label="Restar entrada"
                      onClick={() => setQuantity(q => Math.max(1, q - 1))}
                      disabled={quantity <= 1}
                    >
                      <Minus size={18} />
                    </button>
                    <span className="stepper-val">{quantity}</span>
                    <button
                      type="button"
                      aria-label="Sumar entrada"
                      onClick={() => setQuantity(q => Math.min(MAX_PER_ORDER, q + 1))}
                      disabled={quantity >= MAX_PER_ORDER}
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                </div>

                <div className="ticket-total-calc">
                  <span>Total a pagar ({quantity} entrada{quantity > 1 ? 's' : ''}):</span>
                  <strong>{money(total)}</strong>
                </div>
              </div>

              {/* Datos del Comprador */}
              <div className="dark-card">
                <div className="card-top-header">
                  <div className="card-icon-round"><WalletCards size={20} /></div>
                  <div>
                    <h3>Datos del Comprador</h3>
                    <p>Titular de la reserva</p>
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
                    <label>DNI del Titular *</label>
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
                    <label>Teléfono Celular / WhatsApp *</label>
                    <input
                      type="tel"
                      required
                      placeholder="+54 9 261 ..."
                      value={buyer.phone}
                      onChange={e => updateBuyer('phone', e.target.value)}
                    />
                  </div>

                  <div className="form-field full">
                    <label>
                      Correo Electrónico *
                      <span className="highlight-tag">Aquí te llegarán los QR de tus entradas</span>
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="tu-correo@gmail.com"
                      value={buyer.email}
                      onChange={e => updateBuyer('email', e.target.value)}
                    />
                    <small className="field-hint">Asegurate de escribirlo correctamente. Una vez confirmada la transferencia, te llegará el email con las entradas y códigos QR.</small>
                  </div>
                </div>

                {/* Si compró más de 1 entrada, nombres opcionales */}
                {quantity > 1 && (
                  <div className="attendees-box">
                    <h4><Users size={16} /> Nombres de los asistentes en cada entrada:</h4>
                    <p className="attendees-desc">Podés personalizar el nombre que aparecerá en cada ticket digital.</p>
                    <div className="attendees-list">
                      {Array.from({ length: quantity }).map((_, idx) => (
                        <div key={idx} className="attendee-row">
                          <span className="att-num">Entrada #{idx + 1}</span>
                          <input
                            type="text"
                            placeholder={idx === 0 ? (buyer.fullName || 'Titular') : `Nombre y Apellido Asistente ${idx + 1}`}
                            value={buyer.attendees?.[idx] ?? ''}
                            onChange={e => updateAttendee(idx, e.target.value)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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
                  <span>CONTINUAR AL PAGO POR ALIAS</span>
                  <ArrowRight size={18} />
                </button>
              </div>
            </form>
          </section>
        )}

        {/* ══════════════════════════════════════════════════════════════
            SECCIÓN 3: PAGO EXCLUSIVO POR TRANSFERENCIA DE ALIAS
           ══════════════════════════════════════════════════════════════ */}
        {currentStep === 'pago' && (
          <section className="step-section animate-fade">
            <div className="step-header">
              <button className="btn-back" onClick={() => setCurrentStep('entradas_datos')}>
                <ArrowLeft size={16} /> Modificar datos o cantidad
              </button>
              <div className="step-badge">PASO 3 DE 3 · TRANSFERENCIA POR ALIAS</div>
              <h1>Transferí al alias oficial del club</h1>
              <p>Copiá el alias, hacé la transferencia desde tu banco o billetera virtual, y al confirmar te habilitará el envío del comprobante por WhatsApp.</p>
            </div>

            <div className="payment-grid-layout">
              {/* Tarjeta de Transferencia por Alias */}
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
                      <span>Titular de la cuenta:</span>
                      <b>{CLUB_TITULAR}</b>
                    </div>
                    <div className="cbu-row">
                      <span>CBU:</span>
                      <code>{CLUB_CBU}</code>
                    </div>
                    <div className="cbu-row">
                      <span>Entradas a reservar:</span>
                      <b>{quantity} entrada{quantity > 1 ? 's' : ''} general{quantity > 1 ? 'es' : ''}</b>
                    </div>
                  </div>

                  <div className="form-field" style={{ marginTop: '18px' }}>
                    <label>Número de comprobante / Referencia (Opcional):</label>
                    <input
                      type="text"
                      placeholder="Ej: 98451230"
                      value={transferRef}
                      onChange={e => setTransferRef(e.target.value)}
                    />
                  </div>
                </div>
              </div>

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
                      <span>Entradas:</span>
                      <b>{quantity} x {money(unitPrice)}</b>
                    </div>
                    <div className="sum-row total-highlight">
                      <span>TOTAL A TRANSFERIR:</span>
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
                        <span>REGISTRANDO PEDIDO...</span>
                      </>
                    ) : (
                      <>
                        <Check size={18} />
                        <span>REGISTRAR Y ENVIAR COMPROBANTE</span>
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
            SECCIÓN 4: CONFIRMACIÓN PENDIENTE + BOTÓN DE WHATSAPP
           ══════════════════════════════════════════════════════════════ */}
        {currentStep === 'confirmacion' && orderConfirmation && (
          <section className="step-section animate-fade">
            <div className="pending-confirmation-banner">
              <div className="pending-icon-wrap">
                <AlertCircle size={46} />
              </div>
              <span className="status-badge-pending">PENDIENTE DE VALIDACIÓN</span>
              <h1>¡PEDIDO REGISTRADO #{orderConfirmation.orderId}!</h1>
              <p>
                Para confirmar tu compra, por favor <b>envianos el comprobante de transferencia por WhatsApp</b>.
              </p>
            </div>

            {/* Gran botón de WhatsApp para enviar el comprobante */}
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

            {/* Resumen de los datos transferidos */}
            <div className="dark-card" style={{ marginTop: '24px' }}>
              <div className="card-top-header">
                <div>
                  <h3>Detalle de tu compra</h3>
                  <p>Guardá el número de pedido: <b>#{orderConfirmation.orderId}</b></p>
                </div>
                <div className="card-right-badge">Importe: {money(orderConfirmation.totalArs)}</div>
              </div>

              <div className="alias-details-list">
                <div className="cbu-row">
                  <span>Alias donde transferiste:</span>
                  <div className="copy-row">
                    <code>{CLUB_ALIAS}</code>
                    <button type="button" className="btn-mini-copy" onClick={handleCopyAlias}>
                      {copiedAlias ? '¡Copiado!' : 'Copiar'}
                    </button>
                  </div>
                </div>
                <div className="cbu-row">
                  <span>Titular de la reserva:</span>
                  <b>{orderConfirmation.buyer.fullName} (DNI: {orderConfirmation.buyer.dni})</b>
                </div>
                <div className="cbu-row">
                  <span>Entradas solicitadas:</span>
                  <b>{orderConfirmation.quantity} persona(s)</b>
                </div>
                <div className="cbu-row">
                  <span>Email registrado:</span>
                  <b>{orderConfirmation.buyer.email}</b>
                </div>
              </div>
            </div>

            <div className="confirmation-final-actions" style={{ marginTop: '30px' }}>
              <button
                className="btn-secondary"
                onClick={() => {
                  setCurrentStep('fiesta')
                  setOrderConfirmation(null)
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
          <div>ORGULLO AZULGRANA DESDE 1932 <b>✳</b> SOMOS FAMILIA</div>
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
