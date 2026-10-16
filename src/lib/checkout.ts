import { supabase } from './supabase'
import type { CreateOrderRequest } from '../types'

/**
 * Checkout real: requiere una Edge Function `create-checkout`.
 * La función debe calcular el precio desde la base de datos, no confiar en importes del browser.
 */
export async function createCheckout(payload: CreateOrderRequest) {
  if (!supabase) {
    throw new Error('La conexión con Supabase todavía no está configurada. Completá .env.local.')
  }

  const { data, error } = await supabase.functions.invoke('create-checkout', {
    body: payload,
  })

  if (error) throw new Error(error.message || 'No se pudo iniciar el checkout.')
  if (!data?.url && payload.paymentMethod !== 'transferencia') {
    throw new Error('El proveedor todavía no devolvió un enlace de pago configurado.')
  }
  return data as { orderId: string; url?: string; message?: string }
}
