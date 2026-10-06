# HVS local model storage policy

Canonical root (application-data, not git):

```
media-command/models/
  catalog.json
  image/
  voice/
  audio/
```

Catalog fields: `id`, `version`, `license`, `hash`, `sizeBytes`, `backend`, `installedAt`.

Never put weights in git. Never put weights inside `.hvsproj`. Do not copy proprietary license text into the repository.

See `lib/media-command/model-install.ts` and `lib/media-command/paths.ts`.
