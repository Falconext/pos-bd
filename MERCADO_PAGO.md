# Mercado Pago en la tienda pública (OAuth Marketplace + Checkout Pro)

Cada empresa conecta **su propia cuenta** de Mercado Pago desde
*Perfil → Medios de pago → Conectar Mercado Pago*. El dinero cae directo en su
cuenta; la plataforma solo intermedia (comisión configurable, hoy 0 %).

## Flujo

1. Empresario → `GET /api/mercadopago/oauth/connect` → redirige a MP.
2. MP → `GET /api/mercadopago/oauth/callback?code&state` → guarda tokens en `Empresa`
   (`mpUserId`, `mpAccessToken`, `mpRefreshToken`, `mpTokenExpira`, `mpConectado`).
3. Comprador elige "Mercado Pago" en el checkout → `crearPedido` crea la preferencia
   con el token de la empresa y devuelve `mpInitPoint` → el frontend redirige.
4. Confirmación del pago (cualquiera de las dos vías, idempotentes):
   - **Webhook** `POST /api/mercadopago/webhook` (evento *Pagos*). Usa `user_id`
     del payload para ubicar la empresa y consulta el pago con su token.
   - **Retorno** `GET /api/public/store/track/:codigo/mp-sync?payment_id=` que
     llama la página de seguimiento al volver de MP (respaldo si el webhook falla).
   Pedido → `CONFIRMADO`, `montoPagado = total`, `mpPaymentId`, historial.

## Variables de entorno (backend)

| Variable | Valor en producción |
|---|---|
| `MP_CLIENT_ID` / `MP_CLIENT_SECRET` | Credenciales **de producción** de la app MP |
| `MP_REDIRECT_URI` | `https://api.falconext.pe/api/mercadopago/oauth/callback` |
| `BACKEND_URL` | `https://api.falconext.pe` (se usa para `notification_url`) |
| `FRONTEND_URL` | URL pública del frontend (back_urls y retorno del OAuth) |
| `MP_WEBHOOK_SECRET` | Clave secreta de Webhooks de la app MP (modo productivo) |
| `MP_MARKETPLACE_FEE_PERCENT` | `0` (o el % de comisión de la plataforma) |

Si `MP_WEBHOOK_SECRET` está vacío el webhook se acepta sin validar firma (solo
para QA). En producción **debe** estar configurado.

## Configuración de la app en developers.mercadopago.com

1. *Tus integraciones → Crear aplicación*: producto **Pagos online → Checkout Pro**,
   plataforma "Otro", marcar **"Vas a usar el modelo Marketplace"** (vender en
   nombre de terceros). Esto habilita OAuth.
2. *Detalles de la aplicación → Redirect URL*: pegar exactamente `MP_REDIRECT_URI`.
3. *Webhooks → Modo productivo*: URL `https://api.falconext.pe/api/mercadopago/webhook`,
   evento **Pagos**. Copiar la *Clave secreta* → `MP_WEBHOOK_SECRET`.
4. *Credenciales de producción*: activar (MP pide datos del negocio/industria y
   rubro; suele ser inmediato para Checkout Pro). Copiar Client ID / Secret.
5. Para QA usar *Cuentas de prueba*: una como **vendedor** (se conecta desde el
   panel de la empresa) y otra como **comprador** (paga en el checkout). En
   sandbox el `notification_url` y la `back_url` deben ser HTTPS públicos
   (ngrok para local).

## Puntos a saber

- Los tokens de vendedor duran 180 días; el servicio los refresca solo cuando
  faltan < 5 min para vencer. Si el refresh falla (empresa revocó el permiso), el
  empresario debe volver a *Conectar*.
- `marketplace_fee` solo se envía si `MP_MARKETPLACE_FEE_PERCENT > 0`.
- Moneda fija `PEN`. Las tiendas en USD no deben ofrecer MP.
- `auto_return` solo se manda cuando la `back_url` es HTTPS pública (MP rechaza
  localhost).
