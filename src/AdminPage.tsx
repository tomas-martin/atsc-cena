import { useEffect, useState, useRef } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import {
  LockKeyhole, LogOut, RefreshCw,
  Camera, CheckCircle2, XCircle, AlertTriangle, Users,
  Ticket, ArrowLeft, Search, Check
} from 'lucide-react'
import { supabase } from './lib/supabase'
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
}

interface ScanResult {
  status: 'valid' | 'used' | 'invalid'
  message: string
  attendeeName?: string
  ticketNumber?: string
  checkedInAt?: string
  buyerName?: string
}

// PIN por defecto para el personal en puerta del club
const ADMIN_QUICK_PIN = '2026'

export default function AdminPage({ onBack }: { onBack?: () => void }) {
  // Autenticación
  const [signedIn, setSignedIn] = useState(false)
  const [pin, setPin] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginMethod, setLoginMethod] = useState<'pin' | 'auth'>('pin')
  const [authError, setAuthError] = useState('')
  const [loading, setLoading] = useState(false)

  // Tabs del panel: 'scanner' | 'tickets' | 'orders' | 'config'
  const [activeTab, setActiveTab] = useState<'scanner' | 'tickets' | 'orders'>('scanner')

  // Datos
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [tickets, setTickets] = useState<TicketRow[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('all')

  // Escáner QR
  const [scannerActive, setScannerActive] = useState(false)
  const [scannerStarting, setScannerStarting] = useState(false)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [manualCode, setManualCode] = useState('')
  const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([])
  const [selectedCamera, setSelectedCamera] = useState<string>('')
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null)

  // Cargar sesión guardada en localStorage
  useEffect(() => {
    const savedPin = localStorage.getItem('atsc_admin_auth')
    if (savedPin === 'true') {
      setSignedIn(true)
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

  // Login con PIN
  function handlePinLogin(e: React.FormEvent) {
    e.preventDefault()
    setAuthError('')
    if (pin.trim() === ADMIN_QUICK_PIN) {
      setSignedIn(true)
      localStorage.setItem('atsc_admin_auth', 'true')
    } else {
      setAuthError('PIN incorrecto. El PIN por defecto es 2026.')
    }
  }

  // Login con Supabase Auth
  async function handleAuthLogin(e: React.FormEvent) {
    e.preventDefault()
    setAuthError('')
    if (!supabase) {
      setAuthError('Supabase no está conectado.')
      return
    }
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) {
      setAuthError('Credenciales incorrectas.')
    } else {
      setSignedIn(true)
      localStorage.setItem('atsc_admin_auth', 'true')
    }
  }

  function handleSignOut() {
    stopScanner()
    localStorage.removeItem('atsc_admin_auth')
    if (supabase) void supabase.auth.signOut()
    setSignedIn(false)
    setOrders([])
    setTickets([])
  }

  // ═════════════════════════════════════════════════════════════════
  // LÓGICA DEL ESCÁNER QR
  // ═════════════════════════════════════════════════════════════════
  async function startScanner() {
    if (scannerActive) return
    setScannerStarting(true)
    setScanResult(null)

    try {
      const qrScanner = new Html5Qrcode('qr-reader-viewport')
      html5QrCodeRef.current = qrScanner

      const cameraId = selectedCamera || { facingMode: 'environment' }

      await qrScanner.start(
        cameraId,
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
        },
        async (decodedText) => {
          // Al detectar un código
          await processQrCode(decodedText)
        },
        () => {
          // Error por frame no detectado (normal, ignorar)
        }
      )

      setScannerActive(true)
    } catch (err) {
      console.error('Error al iniciar cámara:', err)
      setAuthError('No se pudo acceder a la cámara. Verificá los permisos del navegador.')
    } finally {
      setScannerStarting(false)
    }
  }

  function stopScanner() {
    if (html5QrCodeRef.current && scannerActive) {
      html5QrCodeRef.current.stop().catch(e => console.warn(e))
      html5QrCodeRef.current = null
      setScannerActive(false)
    }
  }

  // Procesar y validar el código QR detectado
  async function processQrCode(rawText: string) {
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

    // Si ya fue utilizado
    if (matchedTicket.status === 'used') {
      const hora = matchedTicket.checked_in_at
        ? new Date(matchedTicket.checked_in_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
        : 'Previamente'

      setScanResult({
        status: 'used',
        message: `¡ATENCIÓN! Esta entrada ya ingresó al evento a las ${hora} hs.`,
        attendeeName: matchedTicket.attendee_name,
        ticketNumber: matchedTicket.id.slice(0, 8),
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
      ticketNumber: matchedTicket.id.slice(0, 8),
    })
    playBeep(true)
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

  // Marcar pedido como pagado (ej. transferencia recibida)
  async function handleMarkOrderPaid(orderId: string) {
    if (supabase) {
      await supabase
        .from('orders')
        .update({ status: 'pagado', paid_at: new Date().toISOString() })
        .eq('id', orderId)
    }
    setOrders(prev =>
      prev.map(o => (o.id === orderId ? { ...o, status: 'pagado' } : o))
    )
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
            <div className="admin-mark">AT<span>SC</span></div>
            <div>
              <p className="admin-kicker">CONTROL DE ACCESO & ADMINISTRACIÓN</p>
              <h1>Panel de Control ATSC</h1>
            </div>
          </div>

          <div className="login-tabs">
            <button
              type="button"
              className={loginMethod === 'pin' ? 'active' : ''}
              onClick={() => { setLoginMethod('pin'); setAuthError('') }}
            >
              PIN Rápido (Control en Puerta)
            </button>
            <button
              type="button"
              className={loginMethod === 'auth' ? 'active' : ''}
              onClick={() => { setLoginMethod('auth'); setAuthError('') }}
            >
              Usuario / Clave Supabase
            </button>
          </div>

          {loginMethod === 'pin' ? (
            <form onSubmit={handlePinLogin} className="login-form">
              <label>
                PIN de Acceso
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={pin}
                  onChange={e => setPin(e.target.value)}
                  placeholder="Ingresá el PIN (por defecto: 2026)"
                  autoFocus
                  required
                />
              </label>
              {authError && <p className="admin-error">{authError}</p>}
              <button className="admin-primary">
                <LockKeyhole size={16} /> Ingresar al Panel y Escáner
              </button>
              <p className="admin-hint">
                Diseñado para acceder rápido desde el celular en el ingreso al microestadio.
              </p>
            </form>
          ) : (
            <form onSubmit={handleAuthLogin} className="login-form">
              <label>
                Correo Electrónico
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  placeholder="admin@andestalleres.com.ar"
                />
              </label>
              <label>
                Contraseña
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
              </label>
              {authError && <p className="admin-error">{authError}</p>}
              <button className="admin-primary" disabled={loading}>
                <LockKeyhole size={16} /> {loading ? 'Verificando...' : 'Iniciar Sesión'}
              </button>
            </form>
          )}

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

  // Filtrado de tickets
  const filteredTickets = tickets.filter(t => {
    const q = searchQuery.toLowerCase()
    const matchesSearch =
      !q ||
      t.attendee_name.toLowerCase().includes(q) ||
      t.qr_token.toLowerCase().includes(q) ||
      t.id.toLowerCase().includes(q)

    if (!matchesSearch) return false
    if (filterStatus === 'used') return t.status === 'used'
    if (filterStatus === 'valid') return t.status === 'valid'
    return true
  })

  // Filtrado de pedidos
  const filteredOrders = orders.filter(o => {
    const q = searchQuery.toLowerCase()
    const matchesSearch =
      !q ||
      o.buyer_full_name.toLowerCase().includes(q) ||
      o.buyer_email.toLowerCase().includes(q) ||
      o.buyer_dni.includes(q)

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
          <div className="dash-shield">AT<span>SC</span></div>
          <div>
            <div className="admin-kicker">ANDES TALLERES · CONTROL DE EVENTO</div>
            <h1>Cena de Fin de Año 2026</h1>
          </div>
        </div>

        <div className="dash-top-actions">
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
              <div className="camera-viewport-wrap">
                <div id="qr-reader-viewport" className="qr-viewport"></div>
                {!scannerActive && (
                  <div className="camera-placeholder">
                    <Camera size={48} className="cam-icon" />
                    <p>La cámara está apagada</p>
                    <button
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
                  <button className="btn-stop-camera" onClick={stopScanner}>
                    Detener Cámara
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
                      <small className="result-ticket-num">Entrada #{scanResult.ticketNumber}</small>
                    )}
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
                  <th># Ticket</th>
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
                    <td><code>#{ticket.id.slice(0, 8)}</code></td>
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

          <div className="table-scroll-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Comprador</th>
                  <th>DNI</th>
                  <th>Contacto</th>
                  <th>Entradas</th>
                  <th>Total</th>
                  <th>Medio</th>
                  <th>Estado</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map(order => (
                  <tr key={order.id}>
                    <td>{new Date(order.created_at).toLocaleDateString('es-AR')}</td>
                    <td><strong>{order.buyer_full_name}</strong></td>
                    <td>{order.buyer_dni}</td>
                    <td>
                      <div>{order.buyer_phone}</div>
                      <small className="text-muted">{order.buyer_email}</small>
                    </td>
                    <td><b>{order.quantity}</b></td>
                    <td><strong>{money(order.total_ars)}</strong></td>
                    <td><span className="pay-method-badge">{order.payment_method}</span></td>
                    <td>
                      <span className={`badge-status badge-${order.status}`}>
                        {order.status.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      {order.status === 'pendiente' && (
                        <button
                          className="btn-action-paid"
                          onClick={() => void handleMarkOrderPaid(order.id)}
                        >
                          <Check size={14} /> Confirmar Pago
                        </button>
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
