# Neat for Agents — Gateway Worker 🦞

Fachada agent-friendly sobre el ecosistema Neat.
**Worker (Cloudflare) = cara. neat-apps-b (Vercel) = cerebro (datos en Mongo).**

## Qué contiene
| Archivo | Qué es |
|---|---|
| `src/index.js` | El Worker completo: auth de keys (hashes en D1), cuotas diarias, rate-limit headers, proxy fail-closed a Vercel, docs inline, landing + manifiesto JSON por content-negotiation |
| `schema.sql` | D1: `agent_keys`, `usage_daily`, `idem` |
| `wrangler.toml.example` | plantilla (los IDs los pone el deploy) |
| `docs/openapi.yaml` | spec objetivo de la API |
| `patch/` | snippet ADITIVO para neat-apps-b + instrucciones |

## Deploy (ya automatizado por Claw, pero por si acaso)
```bash
wrangler d1 create neat-agents
wrangler d1 execute neat-agents --file=schema.sql
# completar wrangler.toml con account_id + database_id
wrangler secret put NEAT_INTERNAL_SECRET
wrangler deploy
```

## Modelo de seguridad
- El Worker **no conoce ni acepta** JWTs de humanos. Solo `neat_sk_` (sha256 en D1).
- Worker→Vercel viaja con `X-Neat-Internal` (secreto compartido). Vercel es **fail-closed**.
- Las keys las crea un **humano verificado** desde id.neat.qzz.io → se muestran UNA vez.
- Cada request de agente consume cuota diaria visible en headers `X-RateLimit-*`.
- Errores autodescriptivos: siempre `error.code` + `error.message` + `error.fix`.

## Filosofía
> Pull-first: los agentes de hoy viven en sesiones; no les empujes nada,
> dales un buen lugar para consultar cuando despierten.
> — lección aprendida filtrando correos 🦞

## ⚠️ User-Agent obligatorio (anti 403)

Cloudflare rechaza con **403** los User-Agent genéricos de librerías HTTP
(`python-urllib/3.x`, `Java/...`, etc.). Tu agente debe enviar siempre un UA
descriptivo, ej.: `MiAgente/1.0 (+https://tu-web)`. Verificado 2026-07-18.

## v0.3 (propuesta, PR abierto)

- **KV del agente**: `PUT/GET/DELETE /api/v1/kv/{key}` + `GET /kv` — scratch privado en D1
  (100 keys × 2KB). NO es el `/oauth/kv` de Neat (vista perfil); lo visible del humano = Notes.
- **Chatter del agente**: `GET /chats`, `GET /chats/{id}/messages?since=`, `POST /chats/{id}/messages`
  (20 msg/día vía `CHAT_DAILY`). El cerebro (neat-apps-b) marca `via:'agent'` + prefijo 🦞
  y reutiliza `notifyParticipants` → push gratis al otro participante.

## v0.5 R3 Artifacts (propuesta, PR abierto)

Archivos del agente (≤20MB) subidos DIRECTO desde el Worker al storage de Telegram
(sin Vercel de por medio). Metadata en D1 (agent_artifacts).
- POST /api/v1/artifacts (multipart 'file' o JSON {filename,mime,data_b64}) — cuota ART_DAILY=10/día
- GET /api/v1/artifacts (lista metadata) · GET /artifacts/{id} (descarga streameada) · DELETE
- `sendDocument` siempre (byte-exacto; sendPhoto comprime) · file_id persistente de Telegram
- Seguridad: el Worker streamea la descarga — la URL de Telegram lleva el bot token y NUNCA
  se expone al agente (difiere del patrón cerebro-humano a propósito)
- Audit incluye eventos artifact (desde D1). Requiere secrets: TELEGRAM_BOT_TOKEN + TELEGRAM_STORAGE_CHAT_ID
