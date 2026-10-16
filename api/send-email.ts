import { sendMail } from './mailer'

// Forzar runtime Node.js (no Edge) en Vercel
export const config = {
  runtime: 'nodejs',
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Método no permitido. Utilizar POST.',
    })
  }

  const { to, subject, html, attachments } = req.body || {}

  if (!to || !subject || !html) {
    return res.status(400).json({
      success: false,
      error: 'Faltan campos obligatorios: to, subject, html.',
    })
  }

  // Si no hay credenciales SMTP configuradas en el entorno
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('[SMTP] Advertencia: SMTP_USER o SMTP_PASS no están configurados en el entorno.')
    return res.status(200).json({
      success: false,
      error: 'SMTP no configurado en el servidor (faltan SMTP_USER / SMTP_PASS).',
    })
  }

  try {
    // Await del envío dentro de la ruta
    const info = await sendMail({
      to,
      subject,
      html,
      attachments,
    })

    console.log('[SMTP] Correo enviado exitosamente a:', Array.isArray(to) ? to.join(', ') : to, 'ID:', info.messageId)
    return res.status(200).json({
      success: true,
      messageId: info.messageId,
    })
  } catch (error: any) {
    // Si el mail falla, que no rompa la compra; loguear el error sin credenciales
    const safeError = error?.message || 'Error desconocido al enviar correo vía SMTP'
    console.error('[SMTP Error]:', safeError)

    // Se responde con status 200 y success: false para no interrumpir el flujo de compra
    return res.status(200).json({
      success: false,
      error: safeError,
    })
  }
}
