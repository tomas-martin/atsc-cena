import { useMemo, useState, useEffect } from 'react'
import QRCode from 'qrcode'
import {
  ArrowRight, ArrowLeft, CheckCircle2, CircleHelp,
  CreditCard, LockKeyhole, Minus, Plus, ShieldCheck, Ticket,
  WalletCards, Calendar, MapPin, Users, Download, Mail,
  RefreshCw, Send, Check
} from 'lucide-react'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { sendTicketsEmailWithResend } from './lib/email'
import AdminPage from './AdminPage'
import {
  type BuyerDetails,
  type PaymentMethod,
  type Step,
  type IssuedTicket,
  type OrderConfirmation
} from './types'

// Precio base de referencia por entrada en ARS (si Supabase no define otro)
const DEFAULT_PRICE_ARS = 25000
const MAX_PER_ORDER = 10

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

  // Si hay URL y no dio error, renderiza la imagen subida a Supabase
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

  // Fallback: Escudo vectorial azulgrana del club
  return (
    <div className={`brand-shield shield-${size} ${className}`} aria-label="Andes Talleres">
      <span>AT</span>
      <small>SC</small>
    </div>
  )
}

function App() {
  if (window.location.pathname === '/admin') return <AdminPage />

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

  // ── Pago ──
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('mercadopago')
  const [transferRef, setTransferRef] = useState('')

  // ── Procesamiento y Confirmación ──
  const [busy, setBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [orderConfirmation, setOrderConfirmation] = useState<OrderConfirmation | null>(null)
  const [qrImages, setQrImages] = useState<Record<string, string>>({})
  const [resendStatus, setResendStatus] = useState<{ loading: boolean; message: string; success?: boolean }>({
    loading: false,
    message: '',
  })

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

  // ── Procesamiento del pago y emisión de tickets ──
  const handlePayOrder = async () => {
    setErrorMessage('')
    setBusy(true)

    try {
      const orderId = 'ORD-' + Math.random().toString(36).substring(2, 8).toUpperCase()

      // Generar tickets oficiales con tokens únicos
      const tickets: IssuedTicket[] = Array.from({ length: quantity }, (_, i) => {
        const token = crypto.randomUUID ? crypto.randomUUID() : `atsc-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 6)}`
        const attendeeName = (buyer.attendees && buyer.attendees[i] && buyer.attendees[i].trim())
          ? buyer.attendees[i].trim()
          : (i === 0 ? buyer.fullName : `Acompañante ${i + 1}`)
        return {
          ticketNumber: `ATSC-${String(i + 1).padStart(2, '0')}-${orderId.slice(-4)}`,
          attendeeName,
          qrToken: token,
          orderId,
          eventName: 'Cena de Fin de Año 2026 - Andes Talleres',
          date: 'Sábado 19 de Diciembre de 2026 · 21:30 hs',
          venue: 'Microestadio Andes Talleres Sport Club · Godoy Cruz, Mendoza',
        }
      })

      // Generar imágenes QR para cada ticket
      const generatedQrs: Record<string, string> = {}
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
          color: {
            dark: '#070e1a',
            light: '#ffffff',
          },
        })
        generatedQrs[t.qrToken] = dataUrl
      }
      setQrImages(generatedQrs)

      // Guardar en base de datos si Supabase está activo
      if (supabase) {
        try {
          await supabase.from('orders').insert({
            buyer_full_name: buyer.fullName,
            buyer_dni: buyer.dni,
            buyer_email: buyer.email,
            buyer_phone: buyer.phone,
            quantity,
            unit_price_ars: unitPrice,
            total_ars: total,
            payment_method: paymentMethod,
            status: paymentMethod === 'transferencia' ? 'pendiente' : 'pagado',
            transfer_reference: transferRef || null,
          })
        } catch (dbErr) {
          console.warn('Registro en DB:', dbErr)
        }
      }

      const conf: OrderConfirmation = {
        orderId,
        buyer,
        quantity,
        totalArs: total,
        paymentMethod,
        tickets,
        emailSent: false,
      }
      setOrderConfirmation(conf)

      // ── Enviar email con Resend ──
      setResendStatus({ loading: true, message: 'Enviando entradas con Resend a ' + buyer.email + '...' })
      const emailResult = await sendTicketsEmailWithResend(conf, generatedQrs)
      setResendStatus({
        loading: false,
        message: emailResult.message,
        success: emailResult.success
      })

      // Pasar a la pantalla de confirmación
      setCurrentStep('confirmacion')
      window.scrollTo({ top: 0, behavior: 'smooth' })

    } catch (err) {
      console.error(err)
      setErrorMessage(err instanceof Error ? err.message : 'Error al procesar el pago.')
    } finally {
      setBusy(false)
    }
  }

  // Descarga individual del código QR de la entrada
  const downloadTicketQr = (ticket: IssuedTicket) => {
    const dataUrl = qrImages[ticket.qrToken]
    if (!dataUrl) return
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = `Entrada_${ticket.ticketNumber}_${ticket.attendeeName.replace(/\s+/g, '_')}.png`
    link.click()
  }

  // Reenviar email con Resend
  const handleResendEmail = async () => {
    if (!orderConfirmation) return
    setResendStatus({ loading: true, message: 'Reenviando email con Resend...' })
    const res = await sendTicketsEmailWithResend(orderConfirmation, qrImages)
    setResendStatus({ loading: false, message: res.message, success: res.success })
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
            <span className="step-label">Entradas QR</span>
          </div>
        </div>

        {currentStep === 'fiesta' && (
          <button className="nav-cta" onClick={() => setCurrentStep('entradas_datos')}>
            Comprar Entradas <ArrowRight size={15} />
          </button>
        )}
      </header>

      <main className="main-content">
        {/* ══════════════════════════════════════════════════════════════
            SECCIÓN 1: PRESENTACIÓN DIRECTA Y LIMPIA DE LA FIESTA
           ══════════════════════════════════════════════════════════════ */}
        {currentStep === 'fiesta' && (
          <section className="fiesta-section animate-fade">
            <div className="fiesta-hero">
              <div className="fiesta-hero-glow" />

              {/* Logo protagonista de Andes Talleres */}
              <div className="fiesta-logo-wrap">
                <ClubLogo url={logoUrl} size="lg" />
              </div>

              <div className="club-name-tag">ANDES TALLERES SPORT CLUB</div>

              <h1 className="fiesta-title">
                CENA DE <span className="text-red">FIN DE AÑO</span>
                <span className="fiesta-year">2026</span>
              </h1>

              {/* Datos concisos del evento */}
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

              {/* Botón Principal para Comprar Entradas */}
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
              <p>Elegí la cantidad de entradas e ingresá el correo donde recibirás los códigos QR con Resend.</p>
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
                  <span>Total estimado ({quantity} entrada{quantity > 1 ? 's' : ''}):</span>
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
                      <span className="highlight-tag">Aquí recibirás los QR con Resend</span>
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="tu-correo@gmail.com"
                      value={buyer.email}
                      onChange={e => updateBuyer('email', e.target.value)}
                    />
                    <small className="field-hint">Asegurate de escribirlo correctamente. Te llegará un mail automático con el QR de cada entrada.</small>
                  </div>
                </div>

                {/* Si compró más de 1 entrada, nombres opcionales */}
                {quantity > 1 && (
                  <div className="attendees-box">
                    <h4><Users size={16} /> Nombres de los asistentes en cada entrada:</h4>
                    <p className="attendees-desc">Podés personalizar el nombre que aparecerá en cada ticket digital con código QR.</p>
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
                  <span>CONTINUAR AL PAGO</span>
                  <ArrowRight size={18} />
                </button>
              </div>
            </form>
          </section>
        )}

        {/* ══════════════════════════════════════════════════════════════
            SECCIÓN 3: PAGO
           ══════════════════════════════════════════════════════════════ */}
        {currentStep === 'pago' && (
          <section className="step-section animate-fade">
            <div className="step-header">
              <button className="btn-back" onClick={() => setCurrentStep('entradas_datos')}>
                <ArrowLeft size={16} /> Modificar datos o cantidad
              </button>
              <div className="step-badge">PASO 3 DE 3 · FINALIZAR COMPRA</div>
              <h1>Elegí cómo querés pagar</h1>
              <p>Al confirmar el pago se emitirán las entradas y se enviarán automáticamente a <b>{buyer.email}</b> con Resend.</p>
            </div>

            <div className="payment-grid-layout">
              {/* Opciones de pago */}
              <div className="payment-options-col">
                <div className="dark-card">
                  <h3 className="section-subhead">Seleccioná tu medio de pago</h3>

                  {/* Mercado Pago */}
                  <label className={`pay-choice ${paymentMethod === 'mercadopago' ? 'active' : ''}`}>
                    <input
                      type="radio"
                      name="payment"
                      checked={paymentMethod === 'mercadopago'}
                      onChange={() => setPaymentMethod('mercadopago')}
                    />
                    <div className="pay-logo mp">MP</div>
                    <div className="pay-info">
                      <strong>Mercado Pago</strong>
                      <span>Tarjetas de débito, crédito, dinero en cuenta o cuotas.</span>
                    </div>
                    <div className="pay-radio-circle" />
                  </label>

                  {/* Transferencia */}
                  <label className={`pay-choice ${paymentMethod === 'transferencia' ? 'active' : ''}`}>
                    <input
                      type="radio"
                      name="payment"
                      checked={paymentMethod === 'transferencia'}
                      onChange={() => setPaymentMethod('transferencia')}
                    />
                    <div className="pay-logo bank"><CreditCard size={20} /></div>
                    <div className="pay-info">
                      <strong>Transferencia Bancaria Directa</strong>
                      <span>Transferís directamente a la cuenta del club.</span>
                    </div>
                    <div className="pay-radio-circle" />
                  </label>

                  {/* Naranja X */}
                  <label className={`pay-choice ${paymentMethod === 'naranja_x' ? 'active' : ''}`}>
                    <input
                      type="radio"
                      name="payment"
                      checked={paymentMethod === 'naranja_x'}
                      onChange={() => setPaymentMethod('naranja_x')}
                    />
                    <div className="pay-logo nx">NX</div>
                    <div className="pay-info">
                      <strong>Naranja X</strong>
                      <span>Con dinero en cuenta o tarjeta Naranja Plan Z.</span>
                    </div>
                    <div className="pay-radio-circle" />
                  </label>

                  {/* Datos de transferencia bancaria */}
                  {paymentMethod === 'transferencia' && (
                    <div className="transfer-data-box animate-fade">
                      <h4>Datos bancarios oficiales de Andes Talleres:</h4>
                      <div className="cbu-row">
                        <span>Alias CBU:</span>
                        <code>ANDES.TALLERES.FUTSAL</code>
                      </div>
                      <div className="cbu-row">
                        <span>CBU:</span>
                        <code>0170081720000001234567</code>
                      </div>
                      <div className="cbu-row">
                        <span>Titular:</span>
                        <b>Andes Talleres Sport Club</b>
                      </div>
                      <div className="cbu-row">
                        <span>Importe exacto:</span>
                        <strong className="text-red">{money(total)}</strong>
                      </div>
                      <div className="form-field" style={{ marginTop: '14px' }}>
                        <label>Número de comprobante / Referencia (Opcional):</label>
                        <input
                          type="text"
                          placeholder="Ej: 89347291"
                          value={transferRef}
                          onChange={e => setTransferRef(e.target.value)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Resumen */}
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
                      <span>Email de entrega:</span>
                      <b className="email-highlight">{buyer.email}</b>
                    </div>
                    <div className="sum-divider" />
                    <div className="sum-row">
                      <span>Entradas solicitadas:</span>
                      <b>{quantity} x {money(unitPrice)}</b>
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
                    onClick={handlePayOrder}
                    disabled={busy}
                  >
                    {busy ? (
                      <>
                        <RefreshCw size={18} className="spinner" />
                        <span>PROCESANDO PAGO Y EMITIENDO QR...</span>
                      </>
                    ) : (
                      <>
                        <LockKeyhole size={18} />
                        <span>PAGAR Y GENERAR ENTRADAS ({money(total)})</span>
                        <ArrowRight size={18} />
                      </>
                    )}
                  </button>

                  <div className="security-guarantee">
                    <ShieldCheck size={16} />
                    <span>Pago protegido · Despacho automático de QR por Resend</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ══════════════════════════════════════════════════════════════
            SECCIÓN 4: CONFIRMACIÓN Y ENTRADAS CON CÓDIGOS QR
           ══════════════════════════════════════════════════════════════ */}
        {currentStep === 'confirmacion' && orderConfirmation && (
          <section className="step-section animate-fade">
            <div className="success-banner">
              <div className="success-icon-wrap">
                <CheckCircle2 size={46} />
              </div>
              <h1>¡PAGO CONFIRMADO Y ENTRADAS EMITIDAS!</h1>
              <p>Tu lugar en la Cena de Fin de Año de Andes Talleres ya está reservado.</p>
              <div className="order-id-tag">PEDIDO #{orderConfirmation.orderId}</div>
            </div>

            {/* Notificación de Resend */}
            <div className="resend-notification-card">
              <div className="resend-badge-row">
                <span className="resend-pill"><Send size={13} /> ENVÍO POR RESEND</span>
                {resendStatus.loading && <span className="status-live">Enviando correo...</span>}
                {!resendStatus.loading && resendStatus.success && <span className="status-ok"><Check size={14} /> Correo enviado</span>}
              </div>
              <div className="resend-content">
                <div className="resend-icon-circle"><Mail size={24} /></div>
                <div>
                  <h3>Te enviamos las entradas a tu correo</h3>
                  <p>
                    Enviamos las <b>{orderConfirmation.quantity} entrada(s)</b> con sus códigos QR en formato digital a: <b>{orderConfirmation.buyer.email}</b>.
                  </p>
                  <small className="resend-msg">{resendStatus.message}</small>
                </div>
              </div>
              <button
                className="btn-resend-again"
                onClick={handleResendEmail}
                disabled={resendStatus.loading}
              >
                <RefreshCw size={14} className={resendStatus.loading ? 'spinner' : ''} />
                Reenviar correo con Resend
              </button>
            </div>

            {/* Entradas con Códigos QR */}
            <div className="tickets-display-container">
              <h2 className="text-center" style={{ marginBottom: '10px' }}>TUS ENTRADAS CON CÓDIGO QR</h2>
              <p className="text-center text-muted" style={{ marginBottom: '32px' }}>
                Presentá el código QR desde tu celular o descargalo en tu dispositivo.
              </p>

              <div className="tickets-grid">
                {orderConfirmation.tickets.map(t => (
                  <div key={t.ticketNumber} className="official-ticket-card">
                    <div className="ticket-top-strip">
                      <ClubLogo url={logoUrl} size="sm" />
                      <div className="ticket-club-info">
                        <strong>ANDES TALLERES SPORT CLUB</strong>
                        <small>CENA FIN DE AÑO 2026</small>
                      </div>
                      <div className="ticket-number-badge">
                        #{t.ticketNumber}
                      </div>
                    </div>

                    <div className="ticket-perforations">
                      <span className="perf-left" />
                      <span className="perf-line" />
                      <span className="perf-right" />
                    </div>

                    <div className="ticket-body">
                      <div className="ticket-meta">
                        <div className="ticket-attendee-name">
                          <small>ASISTENTE:</small>
                          <h3>{t.attendeeName}</h3>
                        </div>
                        <div className="ticket-event-details">
                          <div><Calendar size={13} /> Sábado 19 de Diciembre · 21:30 hs</div>
                          <div><MapPin size={13} /> Microestadio Andes Talleres</div>
                        </div>
                      </div>

                      <div className="qr-container">
                        {qrImages[t.qrToken] ? (
                          <img
                            src={qrImages[t.qrToken]}
                            alt={`Código QR entrada ${t.ticketNumber}`}
                            className="qr-image"
                          />
                        ) : (
                          <div className="qr-loading">Generando QR...</div>
                        )}
                        <span className="qr-token-id">TOKEN: {t.qrToken.slice(0, 18)}...</span>
                      </div>
                    </div>

                    <div className="ticket-footer-action">
                      <button className="btn-download-qr" onClick={() => downloadTicketQr(t)}>
                        <Download size={15} /> Descargar QR
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="confirmation-final-actions">
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
        <div>ORGULLO AZULGRANA DESDE 1932 <b>✳</b> SOMOS FAMILIA</div>
        <small>© 2026 Andes Talleres Sport Club. Sistema oficial de venta y emisión de entradas digitales con Resend.</small>
      </footer>
    </div>
  )
}

export default App
