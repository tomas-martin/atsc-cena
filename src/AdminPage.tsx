import { useEffect, useState } from 'react'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { LockKeyhole, LogOut, RefreshCw, ShieldAlert } from 'lucide-react'
import './admin.css'

type OrderRow = {
  id: string
  buyer_full_name: string
  buyer_email: string
  quantity: number
  total_ars: number
  payment_method: string
  status: string
  created_at: string
}

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const client: SupabaseClient | null = url && key && !url.includes('TU-PROYECTO')
  ? createClient(url, key)
  : null

export default function AdminPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [signedIn, setSignedIn] = useState(false)
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!client) return
    client.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)))
    const { data } = client.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session)))
    return () => data.subscription.unsubscribe()
  }, [])

  async function signIn(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!client) { setError('Configurá Supabase en .env.local primero.'); return }
    setLoading(true)
    const { error: authError } = await client.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (authError) setError('No se pudo iniciar sesión. Revisá las credenciales y que el usuario esté habilitado.')
  }

  async function loadOrders() {
    if (!client) return
    setLoading(true); setError('')
    const { data, error: queryError } = await client.from('orders')
      .select('id,buyer_full_name,buyer_email,quantity,total_ars,payment_method,status,created_at')
      .order('created_at', { ascending: false }).limit(200)
    setLoading(false)
    if (queryError) setError('No se pudieron cargar los pedidos. Verificá las políticas RLS de administrador en Supabase.')
    else setOrders((data ?? []) as OrderRow[])
  }

  useEffect(() => { if (signedIn) void loadOrders() }, [signedIn])

  async function signOut() {
    if (client) await client.auth.signOut()
    setOrders([])
  }

  const money = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

  if (!signedIn) return <main className="admin-wrap"><form className="admin-login" onSubmit={signIn}>
    <div className="admin-mark">AT<span>SC</span></div><p className="admin-kicker">ÁREA PRIVADA</p><h1>Panel de administración</h1>
    <p className="admin-muted">Acceso exclusivo para personas autorizadas por el club.</p>
    <label>Correo electrónico<input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="username" /></label>
    <label>Contraseña<input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" /></label>
    {error && <p className="admin-error">{error}</p>}
    <button className="admin-primary" disabled={loading}><LockKeyhole size={16}/>{loading ? 'Ingresando…' : 'Iniciar sesión'}</button>
    <p className="admin-foot"><ShieldAlert size={15}/> No crees cuentas públicas para este panel. El administrador debe dar de alta los usuarios.</p>
  </form></main>

  return <main className="admin-dashboard">
    <header><div><div className="admin-kicker">ATSC · CENA 2026</div><h1>Administración de ventas</h1></div><div className="admin-actions"><button onClick={() => void loadOrders()}><RefreshCw size={15}/> Actualizar</button><button onClick={() => void signOut()}><LogOut size={15}/> Salir</button></div></header>
    <div className="admin-notice"><ShieldAlert size={17}/> Los estados de pago se actualizan desde el proveedor/webhook. No marques un pedido como pagado solo por una captura de pantalla.</div>
    {error && <p className="admin-error">{error}</p>}
    <section className="admin-stats">
      <article><span>Pedidos</span><strong>{orders.length}</strong></article>
      <article><span>Entradas solicitadas</span><strong>{orders.reduce((sum, order) => sum + order.quantity, 0)}</strong></article>
      <article><span>Ventas confirmadas</span><strong>{money(orders.filter(o => o.status === 'pagado').reduce((sum, order) => sum + order.total_ars, 0))}</strong></article>
      <article><span>Pendientes</span><strong>{orders.filter(o => o.status === 'pendiente').length}</strong></article>
    </section>
    <section className="admin-table-wrap"><div className="admin-table-title"><h2>Pedidos recientes</h2><span>Máximo 200 registros</span></div>
      {loading ? <p className="admin-muted">Cargando pedidos…</p> : <div className="table-scroll"><table><thead><tr><th>Fecha</th><th>Comprador</th><th>Contacto</th><th>Entradas</th><th>Total</th><th>Pago</th><th>Estado</th></tr></thead>
      <tbody>{orders.map(order => <tr key={order.id}><td>{new Date(order.created_at).toLocaleString('es-AR')}</td><td>{order.buyer_full_name}</td><td>{order.buyer_email}</td><td>{order.quantity}</td><td>{money(order.total_ars)}</td><td>{order.payment_method}</td><td><span className={`status status-${order.status}`}>{order.status}</span></td></tr>)}
      {!orders.length && <tr><td colSpan={7}>Todavía no hay pedidos para mostrar.</td></tr>}</tbody></table></div>}
    </section>
  </main>
}
