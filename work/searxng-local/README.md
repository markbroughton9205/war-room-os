# Local SearXNG (War Room Stage 2B)

Private localhost deployment of official `docker.io/searxng/searxng`.
Not part of War Room production. Do not expose publicly.

Pinned image: `docker.io/searxng/searxng:2026.9.8-3fdc6d753`
Compose: official `searxng/searxng` `container/docker-compose.yml`
Bind: `127.0.0.1:8080` only
JSON API: `GET http://127.0.0.1:8080/search?q=test&format=json`

## Commands (from this directory)

```powershell
docker compose up -d
docker compose down
docker compose restart
docker compose ps
docker compose logs -f core
```

Configuration: `core-config/settings.yml`
Secrets/env: `.env` (gitignored via repo `.env*` rule)
