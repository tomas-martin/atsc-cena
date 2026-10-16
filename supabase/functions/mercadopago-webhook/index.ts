import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST' && req.method !== 'GET') return new Response('Method not allowed', { status: 405 })

  try {
    const url = new URL(req.url)
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    const paymentId = String(url.searchParams.get('data.id') ?? body?.data?.id ?? body?.id ?? '')
    const topic = url.searchParams.get('type') ?? body?.type ?? body?.topic

    // Mercado Pago puede enviar eventos distintos. Responder 200 a eventos irrelevantes.
    if (!paymentId || (topic && topic !== 'payment')) return new Response('ok', { status: 200 })

    const accessToken = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN')
    if (!accessToken) throw new Error('MERCADOPAGO_ACCESS_TOKEN no configurado')

    // Consultar el pago directamente a la API oficial: no confiar en el estado recibido en el webhook.
    const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!paymentResponse.ok) throw new Error('No se pudo verificar el pago en Mercado Pago')
    const payment = await paymentResponse.json()
    const orderId = String(payment.external_reference ?? payment.metadata?.order_id ?? '')
    if (!orderId) return new Response('ok', { status: 200 })

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: order, error: orderError } = await supabase.from('orders').select('*').eq('id', orderId).single()
    if (orderError || !order) return new Response('order not found', { status: 404 })

    // Verificar importe, moneda y referencia antes de actualizar el pedido.
    const expectedAmount = Number(order.total_ars)
    if (payment.currency_id !== 'ARS' || Number(payment.transaction_amount) !== expectedAmount) {
      console.error('Payment amount/currency mismatch', { orderId, expectedAmount, paymentAmount: payment.transaction_amount, currency: payment.currency_id })
      return new Response('payment mismatch', { status: 400 })
    }

    const paymentStatus = payment.status
    if (paymentStatus === 'approved') {
      // Evitar emitir duplicados ante reintentos del webhook.
      const { data: updated, error: updateError } = await supabase.from('orders')
        .update({ status: 'pagado', provider_payment_id: String(payment.id), paid_at: new Date().toISOString() })
        .eq('id', orderId).neq('status', 'pagado').select('id').maybeSingle()
      if (updateError) throw updateError
      if (updated) {
        const tickets = Array.from({ length: Number(order.quantity) }, () => ({ order_id: orderId }))
        const { error: ticketsError } = await supabase.from('tickets').insert(tickets)
        if (ticketsError) throw ticketsError
      }
    } else if (['rejected', 'cancelled'].includes(paymentStatus)) {
      await supabase.from('orders').update({ status: 'rechazado' }).eq('id', orderId).neq('status', 'pagado')
    }
    return new Response('ok', { status: 200, headers: corsHeaders })
  } catch (error) {
    console.error('mercadopago-webhook error', error)
    return new Response('webhook error', { status: 500 })
  }
})
