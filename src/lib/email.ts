import type { OrderConfirmation } from '../types'
import { supabase } from './supabase'

/**
 * Envío de email con las entradas y códigos QR mediante Resend.
 * Puede ejecutarse llamando a la Edge Function de Supabase `send-ticket-email`
 * o llamando directamente al endpoint si se provee VITE_RESEND_API_KEY.
 */
export async function sendTicketsEmailWithResend(
  confirmation: OrderConfirmation,
  qrDataUrls: Record<string, string>
): Promise<{ success: boolean; message: string; messageId?: string }> {
  const resendApiKey = import.meta.env.VITE_RESEND_API_KEY as string | undefined

  // 1. Intentar llamar a Supabase Edge Function si está configurado
  if (supabase) {
    try {
      const { data, error } = await supabase.functions.invoke('send-ticket-email', {
        body: {
          confirmation,
          qrDataUrls,
        },
      })
      if (!error && data?.success) {
        return {
          success: true,
          message: `Correo enviado exitosamente a ${confirmation.buyer.email} mediante Resend.`,
          messageId: data.messageId,
        }
      }
    } catch (e) {
      console.warn('Edge Function send-ticket-email no disponible, probando envío directo...', e)
    }
  }

  // 2. Si hay clave directa en el frontend (útil para pruebas y desarrollo)
  if (resendApiKey && !resendApiKey.includes('TU_RESEND')) {
    try {
      const ticketsHtml = confirmation.tickets.map(t => `
        <div style="background:#0f1c2e; border: 1px solid #1a2d47; border-radius: 8px; padding: 20px; margin-bottom: 20px; color: #ffffff; font-family: sans-serif;">
          <div style="border-bottom: 2px solid #d92736; padding-bottom: 10px; margin-bottom: 12px; display: flex; justify-content: space-between;">
            <strong style="color: #ffffff; font-size: 16px;">ENTRADA #${t.ticketNumber}</strong>
            <span style="color: #d92736; font-weight: bold;">ATSC 2026</span>
          </div>
          <p style="margin: 4px 0; color: #8a9ab5; font-size: 13px;">Titular / Asistente: <b style="color: #fff;">${t.attendeeName}</b></p>
          <p style="margin: 4px 0; color: #8a9ab5; font-size: 13px;">Evento: <b style="color: #fff;">${t.eventName}</b></p>
          <p style="margin: 4px 0; color: #8a9ab5; font-size: 13px;">Lugar: <b style="color: #fff;">${t.venue}</b></p>
          <div style="text-align: center; margin-top: 15px; padding: 10px; background: #ffffff; border-radius: 6px; display: inline-block;">
            ${qrDataUrls[t.qrToken] ? `<img src="${qrDataUrls[t.qrToken]}" alt="Código QR Entrada" style="width: 170px; height: 170px; display: block;" />` : '<p style="color:#000;">Código QR listo</p>'}
            <small style="color: #333; font-family: monospace; display: block; margin-top: 5px;">${t.qrToken.slice(0, 16)}...</small>
          </div>
        </div>
      `).join('')

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"></head>
        <body style="background: #070e1a; color: #ffffff; font-family: Arial, sans-serif; padding: 25px;">
          <div style="max-width: 600px; margin: 0 auto; background: #0b1726; border: 1px solid #1a2d47; border-radius: 10px; padding: 30px;">
            <div style="text-align: center; margin-bottom: 25px;">
              <h1 style="color: #d92736; margin: 0; font-size: 24px; letter-spacing: 1px;">ANDES TALLERES SPORT CLUB</h1>
              <p style="color: #8a9ab5; margin: 5px 0 0; font-size: 13px;">Cena de Fin de Año 2026 · Mendoza</p>
            </div>
            <h2 style="color: #ffffff; font-size: 20px; border-bottom: 1px solid #1a2d47; padding-bottom: 10px;">¡Hola, ${confirmation.buyer.fullName}!</h2>
            <p style="color: #c2cad7; line-height: 1.6; font-size: 14px;">
              Confirmamos tu compra de <b>${confirmation.quantity} entrada(s)</b> para la Gran Cena de Fin de Año de Andes Talleres.
              Presentá los siguientes códigos QR en la entrada el día del evento desde tu celular o impresos.
            </p>
            ${ticketsHtml}
            <div style="margin-top: 25px; padding-top: 15px; border-top: 1px solid #1a2d47; text-align: center; color: #586a85; font-size: 11px;">
              <p>© 2026 Andes Talleres Sport Club · Todos los derechos reservados.</p>
              <p>Este correo fue generado y enviado automáticamente vía Resend.</p>
            </div>
          </div>
        </body>
        </html>
      `

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Andes Talleres <entradas@andestalleres.com.ar>',
          to: [confirmation.buyer.email],
          subject: `Tus Entradas QR - Cena Fin de Año ATSC 2026 (#${confirmation.orderId.slice(0, 8)})`,
          html: htmlContent,
        }),
      })

      const resData = await response.json()
      if (response.ok) {
        return {
          success: true,
          message: `Email con entradas QR despachado con éxito vía Resend a ${confirmation.buyer.email}.`,
          messageId: resData.id,
        }
      } else {
        return {
          success: false,
          message: resData.message || 'Error en la API de Resend.',
        }
      }
    } catch (err) {
      console.error('Error al enviar email directo con Resend:', err)
      return {
        success: false,
        message: err instanceof Error ? err.message : 'Error al conectar con Resend.',
      }
    }
  }

  // 3. Simulación exitosa amigable para entorno de desarrollo / prueba si aún no colocó la API Key
  await new Promise(r => setTimeout(r, 900))
  return {
    success: true,
    message: `[Simulación Resend activa] Se preparó el correo con ${confirmation.tickets.length} entrada(s) y código(s) QR para ${confirmation.buyer.email}. En producción configurá RESEND_API_KEY en Supabase o en .env.local.`,
    messageId: 'resend_sim_' + Math.random().toString(36).substring(2, 9),
  }
}
