# ATSC Cena 2026 - Andes Talleres Sport Club

Sistema de venta y control de entradas para la **Cena de Fin de Año 2026 de Andes Talleres Sport Club**.

Stack: **React 19**, **Vite**, **TypeScript**, **Supabase**, **Nodemailer (SMTP Gmail)** y **Vercel Serverless Functions**.

---

## 🚀 Flujo del Sistema

1. **Venta y Reserva por Transferencia Bancaria (Paso a paso):**
   - El comprador elige la cantidad de entradas (1 a 10) e ingresa sus datos (Nombre, DNI, Celular y Email).
   - Realiza la transferencia al **Alias oficial del Club** (`VITE_CLUB_ALIAS`).
   - Al registrar el pedido, se genera la orden en estado `pendiente`.
   - Se muestra la pantalla de confirmación con un botón directo a **WhatsApp** con el mensaje prearmado para enviar el comprobante de pago.

2. **Validación y Envío en el Panel de Administrador (`/admin`):**
   - El administrador ingresa con PIN rápido (`2026`) o credenciales Supabase.
   - En la pestaña **Órdenes**, revisa las compras en estado `pendiente`.
   - Al hacer clic en **"Aprobar y Enviar QR"**, el sistema:
     - Asigna los tokens únicos de cada entrada.
     - Genera los códigos QR.
     - Despacha automáticamente el correo electrónico con las entradas y sus códigos QR embebidos mediante **SMTP con Nodemailer**.
     - Actualiza la orden a estado `pagado`.
     - *Si el correo fallase (por credenciales o conexión), la orden queda aprobada en el sistema sin interrumpir la operación y se registra el error de forma segura.*

3. **Control de Ingreso en Puerta (Escáner QR):**
   - El panel incluye un escáner que utiliza la cámara del celular.
   - Valida el código QR en tiempo real, emite sonido de confirmación/error y marca la entrada como utilizada (`used`) registrando la hora exacta de ingreso.

---

## 🛠️ Variables de Entorno

### Variables Frontend (Públicas, prefijo `VITE_`):
- `VITE_SUPABASE_URL`: URL del proyecto de Supabase.
- `VITE_SUPABASE_ANON_KEY`: Clave pública anon de Supabase.
- `VITE_CLUB_ALIAS`: Alias oficial para transferencias (ej: `futsal.atsc`).
- `VITE_CLUB_TITULAR`: Titular de la cuenta (ej: `Jimena Patricia Calivar`).
- `VITE_CLUB_BANCO`: Banco o billetera virtual (ej: `Naranja X`).
- `VITE_WHATSAPP_PHONE`: Número de WhatsApp con código de país y área sin guiones (ej: `5492615751033`).
- `VITE_CLUB_LOGO_URL`: (Opcional) URL pública del logo alojado en Supabase Storage.

### Variables Backend SMTP (Secretas para Vercel Serverless Functions y `.env.local`):
- `SMTP_HOST`: Host del servidor SMTP (por defecto `smtp.gmail.com`).
- `SMTP_PORT`: Puerto del servidor SMTP (por defecto `465`).
- `SMTP_SECURE`: `true` para puerto 465 (SSL) o `false` para 587 (STARTTLS).
- `SMTP_USER`: Correo de Gmail emisor (ej: `tu-club@gmail.com`).
- `SMTP_PASS`: **Contraseña de aplicación de Google** de 16 caracteres (creada en [Seguridad de Google](https://myaccount.google.com/apppasswords)).
- `MAIL_FROM`: (Opcional) Nombre y correo visible del remitente (ej: `Andes Talleres <tu-club@gmail.com>`).

---

## 🔑 Cómo generar la Contraseña de Aplicación en Gmail

1. Ingresá a tu cuenta de Google en: [myaccount.google.com/security](https://myaccount.google.com/security).
2. Asegurate de tener activada la **Verificación en 2 pasos**.
3. Buscá o ingresá en: [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).
4. Asigná un nombre a la aplicación (ej: `ATSC Entradas`).
5. Copiá la contraseña generada de 16 caracteres y cargala en la variable `SMTP_PASS` en Vercel y `.env.local` (sin espacios).

---

## 💻 Desarrollo Local

```bash
# Instalar dependencias
npm install

# Iniciar servidor de desarrollo (con soporte local de /api/send-email vía Nodemailer)
npm run dev
```

---

## 🚢 Despliegue en Vercel

1. Subir los cambios a GitHub.
2. En Vercel, ir a **Project Settings → Environment Variables**.
3. Cargar las siguientes variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_CLUB_ALIAS` (`futsal.atsc`)
   - `VITE_CLUB_TITULAR` (`Jimena Patricia Calivar`)
   - `VITE_CLUB_BANCO` (`Naranja X`)
   - `VITE_WHATSAPP_PHONE` (`5492615751033`)
   - `VITE_CLUB_LOGO_URL` (opcional)
   - `SMTP_HOST` (`smtp.gmail.com`)
   - `SMTP_PORT` (`465`)
   - `SMTP_SECURE` (`true`)
   - `SMTP_USER` (`tu-correo@gmail.com`)
   - `SMTP_PASS` (`tu-contraseña-de-aplicación`)
   - `MAIL_FROM` (`Andes Talleres <tu-correo@gmail.com>`)
4. Hacer un nuevo deploy o `Redeploy` para que tome los cambios.
