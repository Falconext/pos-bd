# WhatsApp del negocio por QR con Evolution API propio

"Conectar mi WhatsApp" dentro de Krezka: el dueño escanea un QR (o escribe un
código de 8 caracteres) y los avisos automáticos salen desde SU número, sin
cuenta en Takiy, sin plantillas de Meta y sin costo por mensaje. Corre sobre un
[Evolution API](https://github.com/EvolutionAPI/evolution-api) v2 (conexión
Baileys) que desplegamos nosotros como servicio privado.

> Este documento describe el despliegue; nada de esto se ejecuta solo.

## Cómo encaja en el backend

| Pieza | Archivo |
|---|---|
| Cliente HTTP tipado (timeouts, errores en español, sin secretos) | `src/whatsapp/evolution.ts` |
| Variables de entorno y piloto | `src/whatsapp/evolution-config.ts` |
| Envío con cola por número, pausa aleatoria y tope diario | `src/whatsapp/evolution-envio.service.ts` |
| "Enviar desde el número del negocio": Evolution → Takiy | `src/whatsapp/numero-negocio.service.ts` |
| Panel (`/whatsapp/conexion`) y webhook (`/whatsapp/evolution/webhook`) | `src/whatsapp/conexion/` |
| Tabla `WhatsappConexion` (una por empresa) | `prisma/migrations/20261101150000_whatsapp_evolution` |

Orden de proveedores para todo lo que antes salía por Takiy (PDF del
comprobante, avisos de despacho, avisos al equipo, libro de reclamaciones):
**Evolution conectado → Takiy activo → lo de siempre** (Meta si el plan lo
permite, o nada). Donde antes "Takiy activo" habilitaba algo sin plan (textos
de despacho, enviar comprobante al emitir), Evolution conectado cuenta igual.

Protección del número (anti-bloqueo):

- Los mensajes de un mismo número salen de a uno, con una pausa aleatoria
  entre ellos (`EVOLUTION_PAUSA_MIN_MS`–`EVOLUTION_PAUSA_MAX_MS`, 3–7 s) y el
  "escribiendo…" de Evolution (`delay` de 1,2 s).
- Cola máxima por número (`EVOLUTION_COLA_MAX`, 20): lo que no entra pasa a
  Takiy/Meta en el momento. No hay envíos masivos por esta vía.
- Tope diario por número (`EVOLUTION_TOPE_DIARIO`, 300, día de Lima),
  persistido en Postgres con un UPDATE condicional: sobrevive reinicios.
- **Limitación conocida:** la cola y la pausa viven en memoria del proceso.
  Un reinicio corta los mensajes que esperaban turno (su llamador también
  muere) y con varias réplicas del backend cada una lleva su propia pausa
  (el tope diario sí es global). No se usó BullMQ porque los llamadores
  necesitan el resultado en el momento para caer a Takiy/Meta.
- Si Evolution no responde a tiempo (timeout) el mensaje NO se repite por
  Takiy: pudo haber salido y se duplicaría.

Seguridad:

- La llave global (`EVOLUTION_API_KEY`) solo vive en el backend; nunca va al
  panel, a la app ni a los logs. Cada instancia tiene su propio token
  (aleatorio, guardado cifrado con `CREDENCIALES_SECRET`/`JWT_SECRET`, igual que
  las credenciales de pasarelas) y se usa para conectar/enviar; la llave
  global solo para crear y borrar.
- Nombre de instancia no adivinable: `krezka-<empresaId>-<12 hex aleatorios>`.
- Webhook autenticado con el header `x-krezka-webhook-secret`
  (= `EVOLUTION_WEBHOOK_SECRET`), comparado en tiempo constante. Sin secreto
  configurado, toda la función queda apagada.
- Se suscriben solo `CONNECTION_UPDATE` y `QRCODE_UPDATED`; la instancia no
  lee chats, no marca leídos y no sincroniza historial.

## 1. Evolution en Railway (servicio privado)

Crear en el mismo proyecto de Railway tres servicios nuevos, **separados** de
la base y el Redis del backend:

1. **Postgres** (plantilla de Railway) → `evolution-db`.
2. **Redis** (plantilla de Railway) → `evolution-redis`.
3. **Evolution API** → "Deploy from Docker image":
   `evoapicloud/evolution-api:v2.3.7`
   - Versión **fija**. Nunca `latest` (en Docker Hub `latest` se actualizó el
     mismo día que la 2.4.0-rc1). Para actualizar, ver la sección 5.
   - **Sin dominio público** (Settings → Networking: no generar dominio). Solo
     se accede por la red privada: `http://<nombre-servicio>.railway.internal:8080`.
   - **Volumen** montado en `/evolution/instances`: ahí Baileys guarda parte de
     las llaves de cada sesión. Sin volumen, cada redeploy obliga a todos los
     negocios a volver a escanear.

Variables del servicio Evolution (las de la base y Redis se referencian con
`${{evolution-db.DATABASE_URL}}` etc.):

```env
SERVER_TYPE=http
SERVER_PORT=8080
SERVER_URL=http://<nombre-servicio>.railway.internal:8080

# Llave global: 32+ caracteres aleatorios (openssl rand -hex 32). La misma va en EVOLUTION_API_KEY del backend.
AUTHENTICATION_API_KEY=<llave-global>
# No exponer tokens de instancia en /instance/fetchInstances ni en los webhooks.
AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false

DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=${{evolution-db.DATABASE_URL}}?schema=evolution_api
DATABASE_CONNECTION_CLIENT_NAME=krezka
DATABASE_SAVE_DATA_INSTANCE=true
# Solo mandamos: no guardar mensajes, contactos ni chats de los negocios.
DATABASE_SAVE_DATA_NEW_MESSAGE=false
DATABASE_SAVE_MESSAGE_UPDATE=false
DATABASE_SAVE_DATA_CONTACTS=false
DATABASE_SAVE_DATA_CHATS=false
DATABASE_SAVE_DATA_LABELS=false
DATABASE_SAVE_DATA_HISTORIC=false

CACHE_REDIS_ENABLED=true
CACHE_REDIS_URI=${{evolution-redis.REDIS_URL}}/6
CACHE_REDIS_PREFIX_KEY=evolution
CACHE_REDIS_SAVE_INSTANCES=false
CACHE_LOCAL_ENABLED=false

# Nombre con el que aparece en "Dispositivos vinculados" del celular.
CONFIG_SESSION_PHONE_CLIENT=Krezka
CONFIG_SESSION_PHONE_NAME=Chrome

# Nunca borrar instancias por inactividad: las borra el backend al desconectar.
DEL_INSTANCE=false
QRCODE_LIMIT=30
WEBHOOK_GLOBAL_ENABLED=false
WEBSOCKET_ENABLED=false
RABBITMQ_ENABLED=false
CHATWOOT_ENABLED=false
OPENAI_ENABLED=false
S3_ENABLED=false
TELEMETRY_ENABLED=false
CORS_ORIGIN=*
LOG_LEVEL=ERROR,WARN,INFO
LOG_BAILEYS=error
LANGUAGE=en
```

Notas:
- No poner `WEBHOOKS` en `LOG_LEVEL`: ese nivel imprime el cuerpo de cada
  webhook en los logs de Evolution.
- El manager web de Evolution (`/manager`) queda inaccesible al no tener
  dominio público. Si alguna vez se publica, va con la llave global: no
  compartirla.
- Comprobar que arrancó (desde un shell del backend en Railway):
  `curl http://<nombre-servicio>.railway.internal:8080/` → `"version":"2.3.7"`.

## 2. Variables del backend

```env
EVOLUTION_API_URL=http://<nombre-servicio>.railway.internal:8080
EVOLUTION_API_KEY=<la misma AUTHENTICATION_API_KEY>
EVOLUTION_WEBHOOK_SECRET=<otro aleatorio: openssl rand -hex 32>
# Opcional. Vacío = BACKEND_URL (pública, protegida por el secreto). Usar la
# privada solo si el backend escucha en IPv6 dentro de Railway.
EVOLUTION_WEBHOOK_BASE_URL=
EVOLUTION_EMPRESAS_PILOTO=          # vacío = nadie; "12,34" = esas empresas; "*" = todas
EVOLUTION_TOPE_DIARIO=300
EVOLUTION_PAUSA_MIN_MS=3000
EVOLUTION_PAUSA_MAX_MS=7000
EVOLUTION_COLA_MAX=20
```

- El webhook que se registra en cada instancia es
  `${EVOLUTION_WEBHOOK_BASE_URL || BACKEND_URL}/api/whatsapp/evolution/webhook`
  con el header `x-krezka-webhook-secret`. Se fija al crear la instancia: si
  cambian la URL o el secreto, cada negocio debe desconectar y volver a
  conectar (o actualizarlo con `POST /webhook/set/{instancia}`).
- El backend escucha en `0.0.0.0` (IPv4). Si la red privada del entorno de
  Railway es solo IPv6, dejar el webhook en la URL pública (por defecto). La
  dirección backend → Evolution sí funciona por la privada (Node escucha en
  `::`).
- Migración: `prisma/migrations/20261101150000_whatsapp_evolution` (tabla
  nueva y un enum; no toca tablas existentes). Corre con el
  `prisma migrate deploy` habitual del despliegue.

## 3. Activar el piloto

1. Desplegar Evolution (sección 1) y verificar que responde.
2. En el backend: `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`,
   `EVOLUTION_WEBHOOK_SECRET` y `EVOLUTION_EMPRESAS_PILOTO=<id de la empresa piloto>`.
3. Redeploy del backend. `GET /api/whatsapp/conexion` de esa empresa debe
   responder `disponible: true`; las demás, `disponible: false`.
4. En el panel de la empresa: Conectar → escanear → "Enviar prueba".
5. Ampliar: agregar ids separados por coma, o `*` para todas.

## 4. Apagar

- Para una empresa: quitar su id de `EVOLUTION_EMPRESAS_PILOTO`. Sus mensajes
  vuelven a salir por Takiy/Meta al instante (la instancia queda viva en
  Evolution hasta que se borre).
- Todo: vaciar `EVOLUTION_API_URL` (o la llave o el secreto) y redeploy. El
  panel responde `disponible: false` y nada más cambia. Los webhooks que sigan
  llegando se rechazan con 401.
- Para cortar también las sesiones: apagar el servicio Evolution en Railway
  (los celulares verán el dispositivo vinculado como inactivo).

## 5. Actualizar Evolution

1. Leer el changelog de la versión nueva
   (https://github.com/EvolutionAPI/evolution-api/releases).
2. Correr el QA contra la versión nueva en local (sección 6).
3. Cambiar la etiqueta de la imagen en Railway (siempre una versión exacta).

## 6. QA local con un Evolution real

```bash
docker network create evo-qa
docker run -d --name evo-qa-pg --network evo-qa -e POSTGRES_USER=evo -e POSTGRES_PASSWORD=evo -e POSTGRES_DB=evo postgres:16-alpine
docker run -d --name evo-qa-redis --network evo-qa redis:7-alpine
docker run -d --name evo-qa-api --network evo-qa -p 127.0.0.1:18080:8080 \
  -e SERVER_URL=http://localhost:18080 -e AUTHENTICATION_API_KEY=qa-global-key-0123456789 \
  -e AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false -e DATABASE_PROVIDER=postgresql \
  -e "DATABASE_CONNECTION_URI=postgresql://evo:evo@evo-qa-pg:5432/evo?schema=evolution_api" \
  -e DATABASE_SAVE_DATA_INSTANCE=true -e CACHE_REDIS_ENABLED=true \
  -e CACHE_REDIS_URI=redis://evo-qa-redis:6379/6 -e CACHE_LOCAL_ENABLED=false \
  -e DEL_INSTANCE=false -e TELEMETRY_ENABLED=false -e WEBHOOK_GLOBAL_ENABLED=false \
  evoapicloud/evolution-api:v2.3.7

EVOLUTION_QA_URL=http://127.0.0.1:18080 EVOLUTION_QA_KEY=qa-global-key-0123456789 \
EVOLUTION_QA_WEBHOOK_BASE=http://host.docker.internal:4799 \
  npx jest --runInBand src/whatsapp/conexion/evolution-real.qa
```

El QA usa una base en memoria (no toca ninguna base de datos) y levanta un
receptor de webhooks en el puerto 4799. Lo que no cubre: escanear con un
celular real (estado `open`, envío de mensajes); eso se prueba con la empresa
piloto.

## 7. Licencia

Evolution API se publica bajo Apache 2.0 **con condiciones adicionales**
(archivo `LICENSE` del repositorio):

- No quitar ni modificar el logo/copyright en sus componentes de frontend
  (no los usamos: solo la API).
- **Aviso de uso**: si se usa como parte de un sistema, aunque sea cerrado, se
  debe mostrar de forma visible para los administradores (documentación o
  página de configuración) que el sistema usa Evolution API. Incumplirlo
  puede exigir licencia comercial.

Antes de producción: confirmar con los autores (contato@evolution-api.com) si
nuestro uso como backend de un SaaS requiere licencia comercial, y agregar el
aviso "Conexión por QR provista por Evolution API" en la pantalla de
Conectar mi WhatsApp.

Además, Baileys no es una API oficial de WhatsApp: Meta puede bloquear
números que manden mucho o reciban reportes. La cola, la pausa y el tope
reducen el riesgo pero no lo eliminan; conviene decirlo en la pantalla de
conexión.
