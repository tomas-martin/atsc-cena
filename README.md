# ATSC Cena 2026

Frontend para la venta de entradas de la Cena de Fin de Año de Andes Talleres Sport Club. Stack: Vite, React, TypeScript, Supabase, Edge Functions y Vercel.

## Estado inicial

- Landing responsive azul marino/rojo.
- Selector de cantidad (1–10), datos del comprador y métodos de pago.
- Panel inicial en `/admin` con login Supabase Auth, resumen y tabla de pedidos (requiere políticas RLS administrativas).\n- SQL inicial para configuración del evento, pedidos y entradas.
- Edge Function para crear pedidos y preferencia de Mercado Pago.
- Webhook que consulta el pago directamente a Mercado Pago antes de actualizar estado.
- Naranja X está señalado como proveedor pendiente de integración real.
- Venta deshabilitada por defecto y precio sin definir.

**No usar en producción todavía sin completar la lista de seguridad de abajo.** El código es una base inicial y debe probarse con credenciales sandbox.

## Requisitos

Node.js LTS y npm. Para funciones backend, instalar Supabase CLI y Docker si se desea desarrollo local.

## Ejecutar frontend

```bash
npm install
cp .env.example .env.local
npm run dev
```

En Windows PowerShell, copiar el ejemplo:
```powershell
Copy-Item .env.example .env.local
```

Completar `.env.local` con:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (clave pública/publishable/anon, nunca service_role)

## Configurar Supabase

1. Crear un proyecto en Supabase.
2. Abrir SQL Editor y ejecutar `supabase/schema.sql`.
3. Mantener `sales_enabled = false` hasta que el club confirme precio, fecha, cupo y responsable de los cobros.
4. Configurar los secretos de Edge Functions:
```bash
supabase secrets set MERCADOPAGO_ACCESS_TOKEN=TEST-... SITE_URL=https://tu-dominio.vercel.app ALLOWED_ORIGIN=https://tu-dominio.vercel.app
```
5. Desplegar funciones (desde la raíz, con Supabase CLI vinculado al proyecto):
```bash
supabase functions deploy create-checkout
supabase functions deploy mercadopago-webhook
```
6. Para producción, configurar un webhook de Mercado Pago y comprobar que llega a:
`https://TU-PROYECTO.supabase.co/functions/v1/mercadopago-webhook`
7. Usar credenciales de prueba primero. No compartir ni subir secretos a GitHub.

## Desplegar en Vercel

1. Subir el repositorio a GitHub.
2. En Vercel, importar el repo.
3. Framework preset: Vite; build command `npm run build`; output directory `dist`.
4. Añadir variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en Project Settings → Environment Variables.
5. Deploy. Configurar `SITE_URL` y `ALLOWED_ORIGIN` con el dominio final en los secretos de Supabase.

## Importante antes de vender de verdad

- [ ] Confirmar fecha, lugar, precio, cupo, política de devoluciones y contacto del club.
- [ ] Definir cuenta de cobro oficial del club y quién administrará los pagos.
- [ ] Configurar precio/cupo en base de datos desde un canal administrativo protegido.
- [ ] Implementar transacción SQL atómica para reservar cupo y evitar sobreventa bajo compras simultáneas.
- [ ] Añadir validación de firma del webhook según la documentación vigente de Mercado Pago; el ejemplo consulta la API del proveedor, pero no valida la firma de la notificación.
- [ ] Configurar políticas RLS administrativas para que solo usuarios autorizados puedan leer pedidos; el login de `/admin` no sustituye las políticas de base de datos.
- [ ] Implementar página/pantalla que consulte el estado del pedido de forma segura y permita al comprador recuperar su QR sin exponer datos personales.
- [ ] Implementar entrega de emails con entradas/QR y proceso de reembolso/cancelación.
- [ ] Añadir integración oficial de Naranja X una vez elegido y habilitado el producto de cobro e-commerce; no se debe asumir que el checkout/QR de comercios sirve como API web.
- [ ] Crear flujo administrativo de validación de transferencias y control de acceso de QR usado.
- [ ] Revisar privacidad, retención de DNI y protección de datos personales.
- [ ] Probar duplicados/reintentos de webhook, importes incorrectos, fallas de red y pagos en estado pendiente.
- [ ] Configurar monitoreo y backups.

## Seguridad

Nunca incluir `SUPABASE_SERVICE_ROLE_KEY` ni `MERCADOPAGO_ACCESS_TOKEN` en variables `VITE_*`, frontend o repositorio. La clave pública de Supabase es visible por diseño: las tablas deben estar protegidas con RLS y no tener políticas públicas de lectura/escritura de pedidos o tickets.
