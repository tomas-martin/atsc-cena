import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'

export interface MailAttachment {
  filename: string
  content?: string | Buffer
  path?: string
  cid?: string
  contentType?: string
}

export interface SendMailOptions {
  to: string | string[]
  subject: string
  html: string
  attachments?: MailAttachment[]
}

let cachedTransporter: Transporter | null = null

/**
 * Obtiene o crea el transportador SMTP reutilizable usando las variables del entorno.
 * Valores por defecto:
 * - SMTP_HOST: smtp.gmail.com
 * - SMTP_PORT: 465
 * - SMTP_SECURE: true (para puerto 465)
 */
export function getTransporter(): Transporter {
  if (cachedTransporter) {
    return cachedTransporter
  }

  const host = process.env.SMTP_HOST || 'smtp.gmail.com'
  const port = Number(process.env.SMTP_PORT || 465)

  // Por defecto secure: true si el puerto es 465, o parsear booleano explícito
  let secure = port === 465
  if (process.env.SMTP_SECURE !== undefined && process.env.SMTP_SECURE !== '') {
    secure = process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === '1'
  }

  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  })

  return cachedTransporter
}

/**
 * Remitente del correo configurado en MAIL_FROM o deducido de SMTP_USER.
 */
export function getMailFrom(): string {
  if (process.env.MAIL_FROM && process.env.MAIL_FROM.trim()) {
    return process.env.MAIL_FROM.trim()
  }
  if (process.env.SMTP_USER) {
    return `Andes Talleres <${process.env.SMTP_USER.trim()}>`
  }
  return 'Andes Talleres <no-reply@andestalleres.com.ar>'
}

/**
 * Envía un correo electrónico mediante SMTP con Nodemailer.
 */
export async function sendMail(options: SendMailOptions) {
  const transporter = getTransporter()
  const from = getMailFrom()

  return await transporter.sendMail({
    from,
    to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
    subject: options.subject,
    html: options.html,
    attachments: options.attachments,
  })
}
