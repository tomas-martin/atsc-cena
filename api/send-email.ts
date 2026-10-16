import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'

export interface MailAttachment {
  filename: string
  content?: string | Buffer
  path?: string
  cid?: string
  contentType?: string
}

let cachedTransporter: Transporter | null = null

function getTransporter(): Transporter {
  if (cachedTransporter) {
    return cachedTransporter
  }

  const host = process.env.SMTP_HOST || 'smtp.gmail.com'
  const port = Number(process.env.SMTP_PORT || 465)

  let secure = port === 465
  if (process.env.SMTP_SECURE !== undefined && process.env.SMTP_SECURE !== '') {
    secure = process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === '1'
  }

  const user = process.env.SMTP_USER?.trim()
  // Normalizar contraseña removiendo espacios (por si se copió con espacios de Google App Password)
  const pass = process.env.SMTP_PASS ? process.env.SMTP_PASS.replace(/\s+/g, '').trim() : undefined

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  })

  return cachedTransporter
}

function getMailFrom(): string {
  if (process.env.MAIL_FROM && process.env.MAIL_FROM.trim()) {
    return process.env.MAIL_FROM.trim()
  }
  if (process.env.SMTP_USER) {
    return `Andes Talleres <${process.env.SMTP_USER.trim()}>`
  }
  return 'Andes Talleres <no-reply@andestalleres.com.ar>'
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Método no permitido. Utilizar POST.',
    })
  }

  let payload = req.body
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch {
      payload = {}
    }
  }

  const { to, subject, html, attachments } = payload || {}

  if (!to || !subject || !html) {
    return res.status(400).json({
      success: false,
      error: 'Faltan campos obligatorios: to, subject, html.',
    })
  }

  const smtpUser = process.env.SMTP_USER?.trim()
  const smtpPass = process.env.SMTP_PASS?.trim()

  if (!smtpUser || !smtpPass) {
    console.warn('[SMTP] Advertencia: SMTP_USER o SMTP_PASS no están configurados en el entorno de Vercel.')
    return res.status(200).json({
      success: false,
      error: 'SMTP no configurado en el servidor (faltan SMTP_USER o SMTP_PASS en las Variables de Entorno de Vercel).',
    })
  }

  try {
    const transporter = getTransporter()
    const from = getMailFrom()

    const info = await transporter.sendMail({
      from,
      to: Array.isArray(to) ? to.join(', ') : to,
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
    const safeError = error?.message || 'Error desconocido al enviar correo vía SMTP'
    console.error('[SMTP Error]:', safeError)

    // Se responde con status 200 y success: false para que el cliente reciba el detalle
    return res.status(200).json({
      success: false,
      error: safeError,
    })
  }
}
