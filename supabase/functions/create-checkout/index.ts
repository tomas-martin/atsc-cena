import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { MercadoPagoConfig, Preference } from 'https://esm.sh/mercadopago@2.3.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceRole)

    const body = await req.json()
    const buyer = body?.buyer
    const quantity = Number(body?.quantity)
    const paymentMethod = body?.paymentMethod

    if (!buyer || typeof buyer.fullName !== 'string' || buyer.fullName.trim().length < 3 ||
        typeof buyer.dni !== 'string' || !/^\d{7,8}$/.test(buyer.dni) ||
        typeof buyer.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.email) ||
        typeof buyer.phone !== 'string' || buyer.phone.trim().length < 6 ||
        !Number.isInteger(quantity) || quantity < 1 || quantity > 10 ||
        !['mercadopago', 'naranja_x', 'transferencia'].includes(paymentMethod)) {
      return json({ error: 'Datos inválidos' }, 400)
    }

    // El precio se obtiene de la configuración del servidor. El navegador no envía el importe.
    const { data: config, error: configError } = await supabase
      .from('event_config')
      .select('ticket_price_ars, sales_enabled, event_date, capacity')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (configError || !config || !config.sales_enabled || config.ticket_price_ars === null) {
      return json({ error: 'La venta todavía no está habilitada por el club.' }, 409)
    }
    if (config.event_date && new Date(config.event_date).getTime() < Date.now()) {
      return json({ error: 'La venta para este evento ya finalizó.' }, 409)
    }

    // TODO producción: validar capacidad de forma atómica mediante una función SQL transaccional.
    const unitPrice = Number(config.ticket_price_ars)
    const total = unitPrice * quantity
    const { data: order, error: orderError } = await supabase.from('orders').insert({
      buyer_full_name: buyer.fullName.trim(),
      buyer_dni: buyer.dni,
      buyer_email: buyer.email.trim().toLowerCase(),
      buyer_phone: buyer.phone.trim(),
      quantity,
      unit_price_ars: unitPrice,
      total_ars: total,
      payment_method: paymentMethod,
      status: 'pendiente',
    }).select('id').single()

    if (orderError || !order) throw new Error('No se pudo crear el pedido.')

    if (paymentMethod === 'transferencia') {
      // No marcar como pagado. El club debe verificar la acreditación antes de emitir entradas.
      return json({ orderId: order.id, message: 'Pedido pendiente. El club compartirá las instrucciones de transferencia.' })
    }

    if (paymentMethod === 'naranja_x') {
      // No inventamos un endpoint Naranja X: integrar aquí el producto de e-commerce contratado
      // y sus credenciales oficiales. Mantener el pedido pendiente hasta verificar webhook firmado.
      return json({ error: 'Naranja X todavía no está conectado. Contactá al administrador del sitio.' }, 501)
    }

    const accessToken = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN')
    const siteUrl = Deno.env.get('SITE_URL')
    if (!accessToken || !siteUrl) throw new Error('Falta configurar Mercado Pago o SITE_URL en secretos de Supabase.')

    const mp = new MercadoPagoConfig({ accessToken })
    const preference = new Preference(mp)
    const created = await preference.create({
      body: {
        items: [{
          id: 'atsc-cena-2026',
          title: 'Entrada - Cena de Fin de Año ATSC 2026',
          quantity,
          currency_id: 'ARS',
          unit_price: unitPrice,
        }],
        external_reference: order.id,
        payer: { name: buyer.fullName.trim(), email: buyer.email.trim().toLowerCase() },
        back_urls: {
          success: `${siteUrl}/?payment=return`,
          pending: `${siteUrl}/?payment=pending`,
          failure: `${siteUrl}/?payment=failure`,
        },
        auto_return: 'approved',
        notification_url: `${supabaseUrl}/functions/v1/mercadopago-webhook`,
        metadata: { order_id: order.id },
      },
    })

    await supabase.from('orders').update({ provider_preference_id: created.id }).eq('id', order.id)
    return json({ orderId: order.id, url: created.init_point })
  } catch (error) {
    console.error('create-checkout error', error)
    return json({ error: error instanceof Error ? error.message : 'Error interno al iniciar el checkout.' }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
