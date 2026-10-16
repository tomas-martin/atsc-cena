import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import nodemailer from 'nodemailer'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      {
        name: 'smtp-local-api',
        configureServer(server) {
          server.middlewares.use('/api/send-email', async (req, res) => {
            if (req.method !== 'POST') {
              res.statusCode = 405
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ success: false, error: 'Method not allowed' }))
              return
            }

            let body = ''
            req.on('data', chunk => {
              body += chunk
            })
            req.on('end', async () => {
              res.setHeader('Content-Type', 'application/json')
              try {
                const payload = JSON.parse(body)
                const host = env.SMTP_HOST || process.env.SMTP_HOST || 'smtp.gmail.com'
                const port = Number(env.SMTP_PORT || process.env.SMTP_PORT || 465)
                const secure = (env.SMTP_SECURE || process.env.SMTP_SECURE) !== undefined
                  ? (env.SMTP_SECURE === 'true' || env.SMTP_SECURE === '1' || process.env.SMTP_SECURE === 'true')
                  : port === 465
                const user = (env.SMTP_USER || process.env.SMTP_USER)?.trim()
                const rawPass = env.SMTP_PASS || process.env.SMTP_PASS
                const pass = rawPass ? rawPass.replace(/\s+/g, '').trim() : undefined
                const mailFrom =
                  env.MAIL_FROM ||
                  process.env.MAIL_FROM ||
                  (user ? `Andes Talleres <${user}>` : 'Andes Talleres <no-reply@andestalleres.com.ar>')

                if (!user || !pass) {
                  console.warn('[Local SMTP] SMTP_USER o SMTP_PASS no configurados en el entorno local.')
                  res.statusCode = 200
                  res.end(JSON.stringify({
                    success: false,
                    error: 'SMTP_USER o SMTP_PASS no configurados en .env.local',
                  }))
                  return
                }

                const transporter = nodemailer.createTransport({
                  host,
                  port,
                  secure,
                  auth: { user, pass },
                })

                const info = await transporter.sendMail({
                  from: mailFrom,
                  to: payload.to,
                  subject: payload.subject,
                  html: payload.html,
                  attachments: payload.attachments,
                })

                console.log('[Local SMTP] Email enviado exitosamente:', info.messageId)
                res.statusCode = 200
                res.end(JSON.stringify({ success: true, messageId: info.messageId }))
              } catch (err: any) {
                const safeMessage = err?.message || 'Error al enviar por SMTP'
                console.error('[Local SMTP Error]:', safeMessage)
                res.statusCode = 200
                res.end(JSON.stringify({ success: false, error: safeMessage }))
              }
            })
          })
        },
      },
    ],
  }
})
