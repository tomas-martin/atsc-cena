# 🎟️ ATSC Cena 2026 — Andes Talleres Sport Club

> **Plataforma integral de venta de entradas, acreditación digital con código QR, control de acceso en puerta y gestión de eventos masivos para clubes e instituciones deportivas.**

Desarrollada para la **Gran Cena de Fin de Año de Andes Talleres Sport Club**, esta solución web moderna reemplaza las entradas impresas en papel y las comisiones abusivas de ticketeras tradicionales por un flujo directo, automatizado, seguro y 100% bajo control de la institución.

---

## 📑 Tabla de Contenidos

1. [Características Principales](#-características-principales)
2. [Arquitectura y Stack Tecnológico](#-arquitectura-y-stack-tecnológico)
3. [Flujos del Sistema](#-flujos-del-sistema)
   - [3.1. Flujo del Comprador](#31-flujo-del-comprador)
   - [3.2. Flujo Administrativo](#32-flujo-administrativo)
   - [3.3. Control de Ingreso en Puerta (Escáner QR)](#33-control-de-ingreso-en-puerta-escáner-qr)
   - [3.4. Sistema de Sorteos en Vivo](#34-sistema-de-sorteos-en-vivo)
4. [Avisos de Correo y Carpeta de Spam](#-avisos-de-correo-y-carpeta-de-spam)
5. [Variables de Entorno](#-variables-de-entorno)
6. [Guía de Configuración de Gmail (Contraseña de Aplicación)](#-guía-de-configuración-de-gmail)
7. [Base de Datos Supabase (Esquema SQL)](#-base-de-datos-supabase)
8. [Instalación y Desarrollo Local](#-instalación-y-desarrollo-local)
9. [Despliegue en Producción (Vercel)](#-despliegue-en-producción-vercel)
10. [Buenas Prácticas y Preguntas Frecuentes](#-buenas-prácticas-y-faq)

---

## ✨ Características Principales

- 💳 **Cobro Directo por Transferencia / Alias Bancario:** Sin intermediarios ni retenciones del 15% o 20%. El dinero entra directo a la cuenta bancaria del club. Botón de copiado de Alias en 1 clic.
- 📱 **Integración Nativa con WhatsApp:** Al registrar el pedido, se genera un enlace directo a WhatsApp con el mensaje prearmado (ID de pedido, titular, DNI, total e importe) para adjuntar la captura del comprobante.
- ⚽ **Soporte de Roles y Entradas Bonificadas:**
  - **Acompañantes:** Entradas de pago general con número asignado para sorteos de premios.
  - **Jugadores / Profesores:** Entradas 100% bonificadas ($0) sin costo.
  - **Menores de 3 años:** Entradas sin cargo ($0).
  - Si una orden contiene únicamente entradas de $0, se emiten y aprueban inmediatamente sin requerir comprobante bancario.
- 📧 **Despacho Automático de Entradas por Email (Nodemailer SMTP):**
  - Envío automático de correos HTML con diseño responsivo premium.
  - Códigos QR embebidos como imágenes inline seguras (`CID:`) para visualización instantánea en teléfonos o impresión.
  - **Avisos visibles para revisión de carpeta Spam / Correo no deseado** para garantizar que ningún asistente pierda su entrada.
- 🔒 **Panel de Administración Completo (`/admin`):**
  - Acceso con PIN rápido configurable (`2026`) o autenticación Supabase.
  - Estadísticas en tiempo real: recaudación total acumulada, entradas pagadas vs. pendientes, porcentaje de ocupación e ingresos por categoría/disciplina.
  - Gestión integral de órdenes (Aprobar con emisión de QR, Cancelar con liberación de cupos, Reenviar entradas por correo).
  - Emisión manual de órdenes de cortesía para directivos, invitados de honor o ventas en secretaría en efectivo.
  - Exportación a planilla CSV compatible con Microsoft Excel y Google Sheets.
- 📷 **Escáner QR para Control de Puerta en Tiempo Real:**
  - Utiliza la cámara de cualquier teléfono móvil o tablet sin instalar aplicaciones externas.
  - Verificación criptográfica del token QR contra la base de datos Supabase.
  - Feedback sonoro y visual (tono agudo y verde para ingreso aprobado; tono grave y rojo para entradas ya utilizadas o inválidas).
  - Registro de hora y fecha exacta del ingreso para auditoría.
- 🎁 **Módulo de Sorteos en Vivo para Proyectores:**
  - Animación de ruleta interactiva para proyectar en pantallas gigantes durante la fiesta.
  - Filtra automáticamente las entradas con derecho a sorteo (excluyendo cortesías no participantes).
  - Botón para enviar felicitaciones al ganador vía WhatsApp al instante.

---

## 🛠️ Arquitectura y Stack Tecnológico

| Capa | Tecnología | Descripción |
| :--- | :--- | :--- |
| **Frontend** | React 19 + TypeScript + Vite | Interfaz ultra rápida, tipado estricto y diseño moderno optimizado para móviles. |
| **Estilos** | CSS3 Moderno (Vanilla) | Paleta HSL azulgrana institucional, micro-interacciones, animaciones y glassmorphism. |
| **Base de Datos** | Supabase (PostgreSQL) | Base de datos relacional con Row Level Security (RLS) y almacenamiento en tiempo real. |
| **Storage** | Supabase Storage | Alojamiento para logotipos y activos gráficos de la institución. |
| **Mailing / Backend** | Vercel Serverless Functions + Nodemailer | Despacho de correos transaccionales vía protocolo SMTP seguro (TLS/SSL). |
| **QR Code & Scanner** | `qrcode` + `html5-qrcode` | Generación y lectura de códigos QR de alta densidad sin dependencias externas. |

---

## 🚀 Flujos del Sistema

### 3.1. Flujo del Comprador
1. **Selección de Entradas:** El usuario indica cuántas entradas necesita, especificando el rol de cada asistente (Acompañante con sorteo, Jugador/Profe bonificado, Menor de 3 años) y su disciplina/categoría deportiva.
2. **Datos Personales:** Ingresa Nombre completo, DNI, Teléfono celular y Correo Electrónico. El sistema incluye validaciones de formato y advertencias sobre la carpeta de correo no deseado.
3. **Pago por Transferencia:** Se exhiben los datos bancarios oficiales del club (Alias, Titular, Banco, CBU). El usuario copia el alias con un clic y transfiere desde su app bancaria o billetera virtual.
4. **Confirmación y Comprobante:** Al confirmar, se genera el pedido en estado `pendiente`. Se abre un botón directo a WhatsApp para que envíe el comprobante al teléfono de tesorería del club. Si la orden fue 100% bonificada ($0), pasa directamente a aprobada y despacha los QR al instante.

### 3.2. Flujo Administrativo
1. El personal de tesorería ingresa en la ruta `/admin` e introduce su PIN de acceso.
2. En la pestaña **Órdenes**, revisa las compras pendientes y coteja el comprobante recibido por WhatsApp con el extracto bancario.
3. Al presionar **"Aprobar y Enviar QR"**, el sistema:
   - Asigna los números oficiales de entrada.
   - Genera los tokens criptográficos y los códigos QR.
   - Envía el email con las entradas adjuntas al comprador mediante Nodemailer.
   - Marca la orden como `pagado`.
4. Si un comprador extravía su correo, el administrador cuenta con la función **"Reenviar QR por Email"** con un solo clic.

### 3.3. Control de Ingreso en Puerta (Escáner QR)
1. El personal de seguridad o recepción accede a la pestaña **Control en Puerta** desde su celular.
2. Apunta la cámara al código QR presentado por el asistente (en pantalla del celular o impreso).
3. El sistema valida si el token existe y si ya fue utilizado:
   - **Válido (1° ingreso):** Suena un beep agudo de confirmación, la pantalla se ilumina en verde, se muestra el nombre y DNI del asistente, y el estado cambia a `used` con timestamp.
   - **Ya utilizado:** Suena un sonido de advertencia y se muestra en rojo la hora en que ya ingresó previamente, impidiendo el reingreso duplicado.
   - **Inválido / Falso:** Alerta inmediata de código no reconocido.

### 3.4. Sistema de Sorteos en Vivo
1. Durante la cena, se proyecta la pestaña **Sorteos** en la pantalla del salón.
2. Al pulsar **"Girar Ruleta"**, se produce una animación de suspenso y se selecciona aleatoriamente un número de entrada pagada válida.
3. Se exhibe el nombre del ganador, su DNI y su categoría, permitiendo disparar un mensaje directo a su WhatsApp para que suba al escenario a retirar el premio.

---

## 📧 Avisos de Correo y Carpeta de Spam

Debido a que los correos automáticos con archivos adjuntos o imágenes en base64 pueden ser catalogados preventivamente por algunos proveedores (Gmail, Hotmail/Outlook, Yahoo) en carpetas secundarias, la plataforma incorpora avisos estratégicos en cada punto de contacto:

1. **En el formulario de compra:** Al ingresar el email, se informa que allí se recibirán las entradas y se sugiere revisar carpetas secundarias.
2. **En la pantalla de comprobante:** Al enviar el comprobante por WhatsApp, se explica con un cartel de atención que al recibir el correo debe chequearse **Spam**, **Correo no deseado** o la pestaña **Promociones**.
3. **En el cuerpo del correo:** El template HTML incluye un banner explicativo solicitando al usuario marcar el mensaje como *"No es spam"* o moverlo a la *"Bandeja Principal"* para garantizar acceso inmediato al QR sin conexión o demoras en la puerta.
4. **En el panel de administración:** Cada vez que el administrador aprueba o reenvía una orden, el sistema le recuerda sugerirle al comprador que revise su carpeta de Spam.

---

## ⚙️ Variables de Entorno

Creá un archivo `.env.local` en la raíz del proyecto basándote en `.env.example`:

```env
# ==========================================
# SUPABASE (Base de datos y Storage)
# ==========================================
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# ==========================================
# DATOS BANCARIOS OFICIALES DEL CLUB
# ==========================================
VITE_CLUB_ALIAS=futsal.atsc
VITE_CLUB_TITULAR=Jimena Patricia Calivar
VITE_CLUB_BANCO=Naranja X
VITE_CLUB_CBU=

# ==========================================
# CONTACTO Y ATENCIÓN
# ==========================================
# Número con código de país y área sin signos '+' ni guiones (ej: 5492615751033)
VITE_WHATSAPP_PHONE=5492615751033

# URL pública del logo en Supabase Storage (opcional)
VITE_CLUB_LOGO_URL=

# ==========================================
# SERVIDOR SMTP (Envío de Emails con Nodemailer)
# ==========================================
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=tu-correo@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx
MAIL_FROM=Andes Talleres <tu-correo@gmail.com>
```

---

## 🔑 Guía de Configuración de Gmail

Para enviar correos institucionales mediante Gmail con Nodemailer sin bloqueos de seguridad:

1. Ingresá a la cuenta de Google de la institución en: [myaccount.google.com/security](https://myaccount.google.com/security).
2. Asegurate de tener activada la **Verificación en dos pasos (2FA)**.
3. Accedé a la sección de **Contraseñas de aplicación**: [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).
4. Escribí un nombre identificatorio (ejemplo: `ATSC Entradas 2026`) y hacé clic en **Crear**.
5. Google te mostrará una clave de 16 caracteres (ej: `abcd efgh ijkl mnop`).
6. Copiá esa clave y pegala en `SMTP_PASS` en tu archivo `.env.local` y en las variables de entorno de Vercel (sin espacios).

---

## 🗄️ Base de Datos Supabase

Ejecutá el siguiente script SQL en el **SQL Editor** de tu consola de Supabase para crear las tablas, índices y políticas de seguridad:

```sql
-- 1. Tabla de Órdenes de Compra
CREATE TABLE IF NOT EXISTS public.orders (
    id TEXT PRIMARY KEY,
    buyer_full_name TEXT NOT NULL,
    buyer_dni TEXT NOT NULL,
    buyer_email TEXT NOT NULL,
    buyer_phone TEXT NOT NULL,
    primary_category TEXT,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price NUMERIC NOT NULL DEFAULT 0,
    total_ars NUMERIC NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL DEFAULT 'transferencia',
    status TEXT NOT NULL DEFAULT 'pendiente', -- 'pendiente' | 'pagado' | 'cancelado'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    paid_at TIMESTAMP WITH TIME ZONE
);

-- 2. Tabla de Entradas Individuales
CREATE TABLE IF NOT EXISTS public.tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id TEXT REFERENCES public.orders(id) ON DELETE CASCADE,
    ticket_number TEXT NOT NULL,
    attendee_name TEXT NOT NULL,
    attendee_dni TEXT,
    role TEXT NOT NULL DEFAULT 'general', -- 'general' | 'jugador' | 'profe' | 'menor'
    category TEXT,
    qr_token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'used' | 'cancelled'
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Índices para acelerar búsquedas y validación en puerta
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_buyer_dni ON public.orders(buyer_dni);
CREATE INDEX IF NOT EXISTS idx_tickets_qr_token ON public.tickets(qr_token);
CREATE INDEX IF NOT EXISTS idx_tickets_order_id ON public.tickets(order_id);

-- 4. Habilitar Row Level Security (RLS)
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

-- Políticas de lectura e inserción pública para compradores
CREATE POLICY "Permitir crear pedidos" ON public.orders FOR INSERT WITH CHECK (true);
CREATE POLICY "Permitir leer pedidos propios o admin" ON public.orders FOR SELECT USING (true);
CREATE POLICY "Permitir actualizar pedidos para admin" ON public.orders FOR UPDATE USING (true);

CREATE POLICY "Permitir crear tickets" ON public.tickets FOR INSERT WITH CHECK (true);
CREATE POLICY "Permitir leer tickets" ON public.tickets FOR SELECT USING (true);
CREATE POLICY "Permitir actualizar tickets (puerta / admin)" ON public.tickets FOR UPDATE USING (true);
```

---

## 💻 Instalación y Desarrollo Local

```bash
# 1. Clonar el repositorio
git clone https://github.com/tu-usuario/atsc-cena.git
cd atsc-cena

# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno
cp .env.example .env.local
# (Completar .env.local con tus credenciales)

# 4. Iniciar el servidor local
npm run dev
```

La aplicación se ejecutará en `http://localhost:5173`.
- Portal de compra para el público: `http://localhost:5173/`
- Panel de administración y escáner: `http://localhost:5173/admin` (o mediante el botón en el pie de página).

---

## 🚢 Despliegue en Producción (Vercel)

1. Subí tu repositorio a GitHub o GitLab.
2. Creá un nuevo proyecto en [Vercel](https://vercel.com/new) importando el repositorio.
3. En **Project Settings → Environment Variables**, cargá todas las variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_CLUB_ALIAS`
   - `VITE_CLUB_TITULAR`
   - `VITE_CLUB_BANCO`
   - `VITE_WHATSAPP_PHONE`
   - `VITE_CLUB_LOGO_URL`
   - `SMTP_HOST` (`smtp.gmail.com`)
   - `SMTP_PORT` (`465`)
   - `SMTP_SECURE` (`true`)
   - `SMTP_USER` (`tu-correo@gmail.com`)
   - `SMTP_PASS` (`tu-clave-de-aplicación-de-16-caracteres`)
   - `MAIL_FROM` (`Andes Talleres <tu-correo@gmail.com>`)
4. Hacé clic en **Deploy**. Vercel configurará automáticamente el frontend Vite y las Serverless Functions de Node en `/api/send-email`.

---

## 💡 Buenas Prácticas y FAQ

### ¿Qué pasa si el comprador escribe mal su correo?
El administrador puede buscar la orden por el DNI o nombre del comprador en `/admin`, verificar o corregir su correo en la base de datos o reenviar las entradas por WhatsApp mediante la visualización directa del código QR en el panel.

### ¿Se pueden vender entradas físicas en secretaría?
Sí. El panel cuenta con la pestaña de **Emisión Manual / Cortesías**, donde secretaría puede cargar compradores que abonan en efectivo y emitir sus entradas inmediatamente.

### ¿Qué ocurre si falla la conexión a internet en la puerta?
El escáner almacena en memoria los tokens leídos recientemente. No obstante, se recomienda que el celular o dispositivo asignado al control de acceso disponga de conexión 4G/5G para registrar la hora exacta de ingreso en Supabase y evitar duplicaciones en accesos múltiples.

---

© 2026 Andes Talleres Sport Club. Todos los derechos reservados.
Orgullo Azulgrana desde 1933 · Mendoza, Argentina.
