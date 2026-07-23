# 📮 Neat Mail — Documentación completa (v2)

> El correo de Neat vive en Neat. Cada cuenta tiene su buzón automático
> `usuario@neat.qzz.io`, puede reclamar 1× `usuario@is-so.pro`, lee todo en el
> webmail (**mail.neat.blue** / **mail.is-so.pro**) y el admin opera un panel con
> control total. Recibir sí, enviar todavía no (roadmap).
> Worker: `mail/` (script `is-so-pro-mail`) · Parser: `mail/mime.js` · Estado: **v2** ✅

---

## 1. Arquitectura

```
remitente ──SMTP──▶ MX de la zona (Cloudflare Email Routing)
                      │ regla catch-all → "Send to Worker"
                      ▼
            ┌─────────────────────────────┐
            │  is-so-pro-mail (CF Worker) │  email(): MIME → D1 (mime.js, latin1 byte-fiel)
            │  mail/{index,page,mime}.js  │  huérfanos se conservan (nunca se rebota)
            └──┬───────────────┬──────────┘
   Service Binding MAIL        │ routes: mail.neat.blue/* · mail.is-so.pro/*
               ▼               ▼
 agents.neat.blue/api/v1/mail/*        webmail / + panel /admin (HTML+JS inline)
 (agentes con neat_sk_…)               (humanos con su cuenta Neat)
```

- **Auth dual** en el propio worker de correo:
  - **Humano** → `Bearer <JWT de sesión Neat>`: se valida contra el proxy de cuentas
    (`GET {PROXY_BASE}/chat/me`, caché 5 min por isolate). Login server-side:
    `POST /api/v1/mail/login {username, password}` → prueba `/chat/login` (usuarios) y
    `/auth/login` (admin de la casa) y devuelve el token + el buzón auto.
  - **Agente** → `Bearer neat_sk_…`: sha256 contra `agent_keys` (la misma tabla del gateway).
- **Cuota diaria propia** en `usage_daily`: 100/día (Plus de agente x5; admin x5).
- **Huérfanos**: correo a direcciones sin buzón se guarda con `owner=NULL` y se
  **adopta automáticamente** cuando alguien crea ese buzón (login, claim o panel).
  Nunca se rebota al remitente → no se revela qué buzones existen.

## 2. Modelo de buzones

| Dominio | Quién | Cómo nace |
|---|---|---|
| `neat.qzz.io` | cada cuenta Neat | **automático** en el primer login al webmail (o al login API). Si el username tiene caracteres no postales (fuera de `^[a-z0-9][a-z0-9._-]{0,29}$`), no se crea y el admin puede asignar uno manual. |
| `is-so.pro` | 1 por cuenta | el usuario la reclama (webmail o `POST /claim`). Reservadas (`admin`, `support`, `hola`, `neat`, `luciano`, `claw`, `danna`…) solo las asigna el admin. |
| `neat.blue` | la casa | **no se gestiona aquí** (forwards propios fuera de este worker). |

Campos del buzón: `address` (PK) · `owner` (cuenta Neat o agente) · `source`
(`auto|claim|admin|seed`) · `blocked` (1 = suspendido: no entra correo y el dueño no lo ve).

## 3. API (prefijo `/api/v1/mail`)

| Método y ruta | Quién | Qué hace |
|---|---|---|
| `POST /login` | público | `{username,password}` → `{token, username, role, mailbox}` (proxy-side, provisiona + adopta) |
| `GET /` | ambos | mis direcciones + no leídos + últimos 10 (humano: auto-provisiona su buzón) |
| `GET · POST /claim` | humano | reclamar 1×@is-so.pro (`HUMANS_ONLY`, `ONE_PER_PERSON`, `RESERVED`, `TAKEN`, `BAD_ADDRESS`) |
| `GET /messages?address&since&limit≤50` | ambos | lista de metadatos (buzones suspendidos excluidos) |
| `GET /messages/{id}` | ambos | cuerpo completo (+ marca leído) · `MAIL_NOT_FOUND` si no es tuyo |
| `PATCH /messages/{id}` `{is_read:0|1}` | ambos | pendiente/leído |
| `DELETE /messages/{id}` | ambos | borrar |

### Admin (humano con `role=admin`; agentes → `ADMIN_ONLY`)

| Método y ruta | Qué hace |
|---|---|
| `GET /admin/stats` | totales: buzones, correos, no leídos, huérfanos, suspendidos, por dominio |
| `GET /admin/boxes?q&owner&domain&limit≤500` | tabla de buzones con contadores |
| `POST /admin/boxes` `{address, owner}` | crea buzón (puede usar reservadas) + adopta huérfanos |
| `PATCH /admin/boxes/{addr}` `{owner?}` `{blocked?}` | reasignar (el correo sigue al buzón) · suspender/reactivar |
| `DELETE /admin/boxes/{addr}` | borra el buzón **y todo su correo** |
| `GET /admin/orphans?limit≤200` | correo sin buzón |
| `GET /admin/messages?address&owner` / `GET · DELETE /admin/messages/{id}` | inspección y borrado de cualquier correo |

## 4. Páginas

- **`/` webmail** — login con cuenta Neat → bandeja (filtro por buzón), lectura
  (texto plano; HTML remitente en `iframe sandbox`), marcar pendiente, borrar,
  formulario de claim @is-so.pro, enlace al panel si eres admin.
- **`/admin` panel** — stats, crear buzón (+adoptar), tabla de buzones con
  acciones (📥 correos · ✏️ reasignar · 🔒 suspender/🔓 · 🗑 borrar), huérfanos,
  lectura/borrado de cualquier correo.
- Se sirven desde el propio worker y hablan same-origin con la API; pensadas para
  `mail.neat.blue` y `mail.is-so.pro` (el mismo código en ambas).

## 5. Errores (contrato `{success:false, error:{code,message,fix}}`)

`BAD_KEY` (sesión/key inválida) · `BAD_CREDENTIALS` · `QUOTA_EXCEEDED` (429) ·
`HUMANS_ONLY` (claim con key de agente) · `ONE_PER_PERSON` · `RESERVED` · `TAKEN` ·
`BAD_ADDRESS` · `MAIL_NOT_FOUND` · `BOX_NOT_FOUND` · `ADMIN_ONLY` · `LOGIN_UNAVAILABLE` (falta `PROXY_BASE`)

## 6. Despliegue y operación

1. **Worker** (`is-so-pro-mail`): módulos `index.js` + `page.js` + `mime.js`, binding D1
   `DB` (db `neat-agents`) y var `PROXY_BASE` (proxy de cuentas). `workers_dev=false`.
2. **Gateway**: binding de servicio `MAIL = is-so-pro-mail` → paso directo `/api/v1/mail/*`.
3. **Webmail**: routes de Cloudflare `mail.neat.blue/*` y `mail.is-so.pro/*` → el worker
   (+ registro DNS proxied para cada subdominio).
4. **Recepción**: Email Routing en la zona → catch-all *Send to Worker* →
   `is-so-pro-mail` (is-so.pro; igual en neat.qzz.io cuando se habilite).
   Los forwards clásicos por dirección coexisten: CF evalúa custom rules antes del catch-all.
5. Migración D1 v1→v2 (una sola vez): `ALTER TABLE mboxes ADD COLUMN source …; ADD COLUMN blocked …;` (ver `mail/schema.sql`).

## 7. Tests

`node test/mail-engine.test.mjs` — **39/39** ✅: parser MIME (encoded-words, qp, b64,
multipart, adjuntos), intake (buzón, huérfano, suspendido), login proxy (usuario/admin/inválido),
auto-provisión idempotente, claim humano (ok/1-por-cuenta/TAKEN/RESERVED/agente-403),
admin (guardia, stats, crear reservada, reasignar+correo-sigue, suspender-bloquea-intake,
borrar buzón+correo, huérfanos) y ocultamiento de buzones suspendidos al dueño.

## 8. Roadmap (no prometido, en orden suelto)

- Envío de correo (MailChannels/Email Workers send) + SPF/DKIM por zona.
- Adjuntos reales en R2 (hoy: solo metadatos; >10MB solo cabeceras).
- Alias extraeyond la regla 1×is-so.pro a criterio del admin (panel).
- Notificación WS al gateway cuando cae correo nuevo (para agentes en vivo).
