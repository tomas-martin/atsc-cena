import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (!resendApiKey) {
      return new Response(JSON.stringify({
        error: 'RESEND_API_KEY no configurado en los secretos de Supabase.'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { confirmation, qrDataUrls } = await req.json()
    if (!confirmation || !confirmation.buyer?.email) {
      return new Response(JSON.stringify({ error: 'Faltan datos de la orden o email.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const ticketsHtml = (confirmation.tickets || []).map((t: any) => `
      <div style="background:#0f1c2e; border: 1px solid #1a2d47; border-radius: 8px; padding: 20px; margin-bottom: 20px; color: #ffffff; font-family: sans-serif;">
        <div style="border-bottom: 2px solid #d92736; padding-bottom: 10px; margin-bottom: 12px; display: flex; justify-content: space-between;">
          <strong style="color: #ffffff; font-size: 16px;">ENTRADA #${t.ticketNumber}</strong>
          <span style="color: #d92736; font-weight: bold;">ATSC 2026</span>
        </div>
        <p style="margin: 4px 0; color: #8a9ab5; font-size: 13px;">Asistente: <b style="color: #fff;">${t.attendeeName}</b></p>
        <p style="margin: 4px 0; color: #8a9ab5; font-size: 13px;">Evento: <b style="color: #fff;">${t.eventName}</b></p>
        <p style="margin: 4px 0; color: #8a9ab5; font-size: 13px;">Lugar: <b style="color: #fff;">${t.venue}</b></p>
        <div style="text-align: center; margin-top: 15px; padding: 12px; background: #ffffff; border-radius: 6px; display: inline-block;">
          ${qrDataUrls && qrDataUrls[t.qrToken] ? `<img src="${qrDataUrls[t.qrToken]}" alt="Código QR Entrada" style="width: 170px; height: 170px; display: block;" />` : ''}
          <small style="color: #333; font-family: monospace; display: block; margin-top: 5px;">${t.qrToken}</small>
        </div>
      </div>
    `).join('')

    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: Deno.env.get('RESEND_FROM_EMAIL') ?? 'Andes Talleres <onboarding@resend.dev>',
        to: [confirmation.buyer.email],
        subject: `Tus Entradas - Gran Cena de Fin de Año ATSC 2026`,
        html: `
          <div style="background: #070e1a; color: #ffffff; font-family: Arial, sans-serif; padding: 25px;">
            <div style="max-width: 600px; margin: 0 auto; background: #0b1726; border: 1px solid #1a2d47; border-radius: 10px; padding: 30px;">
              <div style="text-align: center; margin-bottom: 25px;">
                <h1 style="color: #d92736; margin: 0; font-size: 24px;">ANDES TALLERES SPORT CLUB</h1>
                <p style="color: #8a9ab5; margin: 5px 0 0; font-size: 13px;">Gran Cena de Fin de Año 2026 · Mendoza</p>
              </div>
              <h2 style="color: #ffffff; font-size: 20px;">¡Hola, ${confirmation.buyer.fullName}!</h2>
              <p style="color: #c2cad7; line-height: 1.6; font-size: 14px;">
                Tu pago ha sido acreditado exitosamente. A continuación tenés tus entradas oficiales con código QR.
              </p>
              ${ticketsHtml}
              <div style="margin-top: 25px; padding-top: 15px; border-top: 1px solid #1a2d47; text-align: center; color: #586a85; font-size: 11px;">
                <p>© 2026 Andes Talleres Sport Club · Mendoza, Argentina.</p>
                <p>Enviado mediante la plataforma oficial de Resend.</p>
              </div>
            </div>
          </div>
        `,
      }),
    })

    const data = await emailResponse.json()
    if (!emailResponse.ok) {
      throw new Error(data.message || 'Error al enviar email con Resend')
    }

    return new Response(JSON.stringify({ success: true, messageId: data.id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error send-ticket-email:', error)
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Error interno' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
