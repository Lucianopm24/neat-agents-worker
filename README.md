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
