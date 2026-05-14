# Deploying War Room (Netlify / Vercel)

Goal: an **always-accessible URL** for the app, not a full CI walkthrough. This project is **Next.js 16** (App Router) with server routes (`app/api/**`), so it behaves like a **Node** app at runtime, not a static-only export.

## Vercel (typical default)

1. Connect the Git repository and import the project.
2. **Build command:** `pnpm build` (install step should run `pnpm install` or use the detected package manager).
3. **Output:** Vercel runs **`next start`** on their platform; you do not configure `output: 'export'` for this app unless you intentionally remove server features.
4. **Environment variables:** copy the same names you use locally from `.env.local` (e.g. `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and any keys required by your engines). Mark server-only secrets as **not** exposed to the browser.
5. Set **`NEXT_PUBLIC_SITE_URL`** to the canonical public URL so the app and probes resolve the correct host.

## Netlify

1. Connect the repo and set the **build command** to `pnpm build`.
2. Use Netlify’s **Next.js runtime** via the official adapter (e.g. **`@netlify/plugin-nextjs`** in `netlify.toml` or the UI’s Next.js preset) so App Router and API routes run on Netlify’s Node-compatible runtime—do not assume a plain static export unless you have deliberately made the app static-only.
3. **Publish directory** is managed by the Next plugin; follow Netlify’s Next.js docs for the current default.
4. Add the same **environment variables** as on Vercel; keep service keys server-side.

## Local vs hosted

- **Local:** `pnpm dev` (or the repo root launchers in the README).
- **Hosted:** `pnpm build` then the host runs **`next start`** (or the platform’s equivalent). Static `next export` is only appropriate if the codebase has no server-only routes you rely on.

## Quick checklist

- [ ] `pnpm build` succeeds locally before relying on the host.
- [ ] All required env vars are set in the host dashboard.
- [ ] `NEXT_PUBLIC_SITE_URL` matches the URL users open in the browser.
