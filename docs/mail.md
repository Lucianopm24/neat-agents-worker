# 📮 is-so.pro Mail — Documentación completa

> El correo que llega a `nombre@is-so.pro` ya no solo se reenvía: **vive en Neat**.
> Email Worker de Cloudflare que guarda cada mensaje en D1 y lo sirve por API a su dueño.
> Worker: `mail/` (script `is-so-pro-mail`) · Parser: `mail/mime.js` · Estado: **v1 lista, esperando switch de routing** 🚦

---

## 1. Arquitectura

```
remitente ──SMTP──▶ MX de is-so.pro (Cloudflare Email Routing)
                      │
                      ▼ regla catch-all (o custom) → "Send to Worker"
            ┌──────────────────────────┐
            │  is-so-pro-mail (CF)     │  email(): parsea MIME (mime.js, latin1 byte-fiel)
            │  mail/index.js           │  guarda en D1 `mail` (buzón por dirección; huérfanos se conservan)
            └──────────┬───────────────┘
                       │ Service Binding MAIL
   agente ──HTTPS──▶ agents.neat.blue/api/v1/mail/*   (gateway = paso directo, sin auth propio ahí)
                       └─▶ el MAIL worker autentica neat_sk_ contra D1 (misma tabla agent_keys)
```

- **Una sola superficie pública**: el gateway; el mail worker expone cero HTTP público
  (workers.dev apagado; se alcanza SOLO por el binding).
- **Auth y cuota propios** en el worker de correo: sha256 de la key contra `agent_keys`
  (la misma del gateway) + `usage_daily` (100/día, Plus x5) — la ley de la casa intacta.
- **Huérfanos** (correo a direcciones sin dueño): se guardan con `owner=NULL` (nada se
  pierde; el admin los consulta por D1). Nunca se rebota al remitente → no revelamos
  qué buzones existen.

## 2. Datos

`mail/schema.sql` (misma db `neat-agents`, ALTERs aditivos — zero downtime):

| Tabla | Campos clave |
|---|---|
| `mboxes` | `address` PK (nombre@is-so.pro) · `owner` (username Neat) · `created_at` |
| `mail` | `id` (m_…) PK · `address` · `owner` (NULL=huérfano) · `sender` · `subject` · `text_body`/`html_body` (cap 128KB; NULL si raw>10MB) · `size` · `has_attach` · `attach_names` JSON · `is_read` · `created_at` |

Buzones semilla de la casa: `claw@is-so.pro` y `luciano@is-so.pro` → `Penguin`.

## 3. API (agentes/humanos vía gateway)

Base: `https://agents.neat.blue/api/v1/mail` · Auth: `Authorization: Bearer neat_sk_...`
Respuestas `{success,data,tip}` · errores `{error.code,message,fix}` · headers `X-RateLimit-*`.

| Endpoint | Qué hace |
|---|---|
| `GET /mail` | tus buzones + cuenta de no-leídos + últimos 10 (metadatos) |
| `GET /mail/messages` | lista hasta 50 · filtros `?address=` `?since=ISO` `?limit=` |
| `GET /mail/messages/{id}` | cuerpo completo (text+html) · **marca leído** |
| `PATCH /mail/messages/{id}` | `{"is_read":0\|1}` |
| `DELETE /mail/messages/{id}` | borra (solo propios) |
| `GET /mail/claim` | tus direcciones |
| `POST /mail/claim {"address":"tunombre"}` | reclama `tunombre@is-so.pro` si está libre |

### Reclamos (la gracia de is-so… yours)
- Formato: `^[a-z0-9][a-z0-9._-]{0,29}$` (minúsculas automático; sin @ ni dominio).
- **Reservadas** (409 `RESERVED`): infra del correo (admin/postmaster/abuse/…) + familia de la casa (luciano/claw/danna/neat). De momento las concede el admin a mano por D1.
- Ocupada (409 `TAKEN`) con tip de sugerencias.
- Cero moderación en v1 (los claims los hacen dueños Neat verificados; el spam de nombres feos lo cortamos con la reserva y con la propia trazabilidad).

## 4. Parser MIME (mail/mime.js)

Decodificación **byte-fiel** (raw se lee como latin1 → 1 char = 1 byte; base64 y
quoted-printable se reconstruyen byte a byte; charset final vía TextDecoder):

- Headers plegados (unfolding RFC5322) · `parseAddr` con nombre bonito.
- **Encoded-words RFC2047** (`=?UTF-8?B?…?=` / `?Q?`, varias seguidas con join correcto) —
  asuntos Gmail con tildes/emoji probados en tests.
- `multipart/alternative|mixed` con boundary entrecomillado, recursivo.
- Texto plano y HTML; **adjuntos → solo metadatos** (`filename, ctype, size`) en v1.

Tests: `node test/mail-engine.test.mjs` → 20/20 ✅ (parser + handleEmail con D1-spy +
API: claim/inbox/401/RESERVED/BAD_ADDRESS/cuota headers).

## 5. Operación (qué faltaba para tener correo viviendo) 🚦

1. ✅ Worker desplegado (`is-so-pro-mail`, etag en PR) · tablas creadas · buzones semilla.
2. ⏳ **Binding** `MAIL` del gateway → `is-so-pro-mail` (va en el redeploy post-merge;
   metadata: `{"name":"MAIL","type":"service","service":"is-so-pro-mail"}`).
3. ⏳ **Switch del Email Routing** (dashboard, 1 minuto, lo hace el admin):
   Zona is-so.pro → Email → Email Routing → *Editar regla catch-all* (o crear custom rule
   `*@is-so.pro`) → acción **Send to Worker** → `is-so-pro-mail`.
   Las reenviaciones personalizadas existentes (custom addresses) se evalúan ANTES que el
   catch-all: conviven sin drama. Verificación E2E pactada: `claw@is-so.pro` desde lucianopm.com.
4. v1 no responde correo (lectura). Respuestas: roadmap.

## 6. Roadmap

- Página humana `byneat/mail` (proxy cerebro + UI — requiere env del proxy; PR aparte con su 🟢)
- Adjuntos reales en R2 + endpoint de descarga firmada
- Huérfanos: vista admin + auto-buzón al reclamar (correos viejos te esperan)
- Respuesta de correo (MailChannels) — con la regla del tesoro intacta: nada se envía sin firma del jefe
- Sieve-lite: reglas por buzón (etiquetas/archivo automático)

---
*Doc mantenida por Claw 🦞 — claw@is-so.pro (sí, ya tengo buzón propio).*
