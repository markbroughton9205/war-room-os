# Ascension Phase 11C — Sovereign Offline Commander Identity + Local Ownership

**Roadmap:** #22 CLOSED · **#23:** PENDING / NOT_STARTED  
**Depends on:** Phase 11B local model path (`644947ea…`)

## Acceptance

```
internet / warroomos.com / Cloudflare / Supabase / external AI unavailable
  → Desktop local UI
  → Local Commander authenticates
  → Local conversations persist
  → Local Ollama responds into same conversation
  → Restart → same Commander → conversation still present
```

## Architecture

```
LOCAL_COMMANDER (lcmd_*)
  → LOCAL_SESSION (cookie wr_local_session / bearer)
  → LOCAL owned SQLite (AppData / War Room OS / data)
  → conversations (lcnv_*) + messages (lmsg_*)
  → Phase 11B local model router → Ollama
Optional: LINKED_REMOTE foundation (requires BOTH sessions; never auto-link)
```

## Credential security

- **KDF:** `node:crypto` **scrypt** (N=16384, r=8, p=1, keylen=64)
- **Electron safeStorage:** evaluated; not required for Core — hashed credentials in AppData SQLite
- **Recovery:** `NOT_IMPLEMENTED` (no backdoor / security questions)
- **Import:** `NOT_IMPLEMENTED`
- **Automatic sync:** `NOT_IMPLEMENTED`

## Identity states

`LOCAL_ONLY` · `REMOTE_ONLY` · `LOCAL_AND_REMOTE_UNLINKED` · `LINKED_REMOTE` · `REMOTE_UNAVAILABLE` · `LINK_CONFLICT`

`LOCAL_COMMANDER_SESSION` ≠ `REMOTE_SUPABASE_SESSION`

## APIs (loopback only)

Local Core `:3847`:
- `GET/POST /api/local/auth/{status,bootstrap,login,logout,link}`
- `GET/POST /api/local/ownership/conversations…`
- `POST …/chat` → Phase 11B inference into owned conversation

Next (loopback):
- `/api/sovereign/local-auth/{status,bootstrap,login,logout}`

Public host / non-loopback → **403**.

## Validation

```bash
pnpm run validate:ascension-phase11c
pnpm run validate:ascension-phase11c:live
```

Use `WAR_ROOM_LOCAL_DATA_DIR` for isolated test profiles.
