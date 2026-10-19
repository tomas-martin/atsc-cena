import type { OrderConfirmation } from '../types'

/**
 * Envío de email con las entradas y códigos QR mediante SMTP (Nodemailer).
 * Llama a la ruta serverless `/api/send-email` tanto en desarrollo local como en producción (Vercel).
 */
export async function sendTicketsEmail(
  confirmation: OrderConfirmation,
  qrDataUrls: Record<string, string>
): Promise<{ success: boolean; message: string; messageId?: string }> {
  try {
    // Generar attachments con Content-ID (CID) para que Gmail y otros clientes muestren el QR inline de forma óptima
    const attachments: Array<{
      filename: string
      path: string
      cid: string
    }> = []

    const ticketsHtml = confirmation.tickets.map((t, idx) => {
      const cidName = `qr-ticket-${idx}-${t.qrToken.slice(0, 8)}`
      const qrDataUrl = qrDataUrls[t.qrToken]

      if (qrDataUrl) {
        attachments.push({
          filename: `ticket-${t.ticketNumber}.png`,
          path: qrDataUrl,
          cid: cidName,
        })
      }

      // Usar cid si está disponible o el data url
      const qrImageSrc = qrDataUrl ? `cid:${cidName}` : ''

      const isPlayer =
        t.isPlayer === true ||
        t.role === 'jugador' ||
        t.ticketNumber === 'JUGADOR' ||
        t.ticketNumber === 'Sin sorteo' ||
        /jugador/i.test(t.attendeeName)

      const headerTitle = isPlayer
        ? `<strong style="color: #ffffff; font-size: 18px; letter-spacing: 0.5px;">ENTRADA JUGADOR</strong>
           <div style="color: #60a5fa; font-size: 11px; font-weight: bold; margin-top: 3px;">⚽ ACCESO BONIFICADO (SIN SORTEO)</div>`
        : `<strong style="color: #ffffff; font-size: 18px; letter-spacing: 0.5px;">ENTRADA N° ${t.ticketNumber.replace(/^N°\s*/i, '')}</strong>
           <div style="color: #fbbf24; font-size: 11px; font-weight: bold; margin-top: 3px;">🎟️ NÚMERO VÁLIDO PARA EL SORTEO</div>`

      return `
        <div style="background:#0f1c2e; border: 1px solid #1a2d47; border-radius: 8px; padding: 20px; margin-bottom: 20px; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          <div style="border-bottom: 2px solid #d92736; padding-bottom: 12px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              ${headerTitle}
            </div>
            <span style="color: #d92736; font-weight: bold; font-size: 13px; background: rgba(217,39,54,0.15); padding: 4px 10px; border-radius: 4px;">ATSC 2026</span>
          </div>
          <p style="margin: 6px 0; color: #8a9ab5; font-size: 13px;">Titular / Asistente: <b style="color: #ffffff; font-size: 14px;">${t.attendeeName}</b></p>
          <p style="margin: 6px 0; color: #8a9ab5; font-size: 13px;">Evento: <b style="color: #ffffff;">${t.eventName}</b></p>
          <p style="margin: 6px 0; color: #8a9ab5; font-size: 13px;">Fecha: <b style="color: #ffffff;">${t.date}</b></p>
          <p style="margin: 6px 0; color: #8a9ab5; font-size: 13px;">Lugar: <b style="color: #ffffff;">${t.venue}</b></p>
          <div style="text-align: center; margin-top: 15px; padding: 14px; background: #ffffff; border-radius: 8px; display: inline-block;">
            ${qrImageSrc ? `<img src="${qrImageSrc}" alt="Código QR Entrada ${t.ticketNumber}" width="180" height="180" style="display: block; margin: 0 auto; width: 180px; height: 180px;" />` : '<p style="color:#000;">Código QR listo</p>'}
            <small style="color: #1a2d47; font-family: monospace; display: block; margin-top: 6px; font-weight: bold;">${t.qrToken.slice(0, 18)}...</small>
          </div>
        </div>
      `
    }).join('')

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"></head>
      <body style="background: #070e1a; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 25px; margin: 0;">
        <div style="max-width: 600px; margin: 0 auto; background: #0b1726; border: 1px solid #1a2d47; border-radius: 12px; padding: 30px;">
          <div style="text-align: center; margin-bottom: 25px;">
            <h1 style="color: #d92736; margin: 0; font-size: 24px; letter-spacing: 1px; font-weight: 800;">ANDES TALLERES SPORT CLUB</h1>
            <p style="color: #8a9ab5; margin: 6px 0 0; font-size: 13px;">Cena de Fin de Año 2026 · Mendoza</p>
          </div>
          <h2 style="color: #ffffff; font-size: 19px; border-bottom: 1px solid #1a2d47; padding-bottom: 12px; margin-top: 0;">¡Hola, ${confirmation.buyer.fullName}!</h2>
          <p style="color: #c2cad7; line-height: 1.6; font-size: 14px;">
            Confirmamos tu compra de <b>${confirmation.quantity} entrada(s)</b> para la Gran Cena de Fin de Año de Andes Talleres.
            Presentá los siguientes códigos QR en el ingreso del evento desde tu teléfono celular o impresos.
          </p>
          ${ticketsHtml}
          <div style="margin-top: 25px; padding-top: 15px; border-top: 1px solid #1a2d47; text-align: center; color: #586a85; font-size: 12px;">
            <p style="margin: 4px 0;">© 2026 Andes Talleres Sport Club · Todos los derechos reservados.</p>
            <p style="margin: 4px 0;">Este correo fue despachado automáticamente tras la confirmación de tu pago.</p>
          </div>
        </div>
      </body>
      </html>
    `

    // Enviar solicitud a la ruta serverless de Node
    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: confirmation.buyer.email,
        subject: `Tus Entradas QR - Cena Fin de Año ATSC 2026 (#${confirmation.orderId.slice(0, 8)})`,
        html: htmlContent,
        attachments,
      }),
    })

    if (!response.ok) {
      const errData = await response.json().catch(() => null)
      const errorMsg =
        errData?.error ||
        (response.status === 500
          ? 'Error 500 en Vercel al despachar el correo. Verificá que las variables SMTP (SMTP_USER, SMTP_PASS) estén configuradas en Vercel y hacé un Redeploy.'
          : `Error en el servidor al despachar correo (Status ${response.status})`)
      // Loguear error sin credenciales
      console.error('[SMTP Client Error]:', errorMsg)
      return {
        success: false,
        message: errorMsg,
      }
    }

    const data = await response.json()
    if (data.success) {
      return {
        success: true,
        message: `Correo enviado exitosamente a ${confirmation.buyer.email} vía SMTP.`,
        messageId: data.messageId,
      }
    } else {
      const errorMsg = data.error || 'No se pudo enviar el correo vía SMTP'
      console.warn('[SMTP Warning]:', errorMsg)
      return {
        success: false,
        message: errorMsg,
      }
    }
  } catch (err: any) {
    // Si el mail falla, que no rompa la compra; loguear el error sin credenciales
    const safeError = err?.message || 'Error de conexión con el servicio de correo'
    console.error('[SMTP Client Exception]:', safeError)
    return {
      success: false,
      message: safeError,
    }
  }
}

// Alias para compatibilidad con llamadas existentes
export const sendTicketsEmailWithResend = sendTicketsEmail
