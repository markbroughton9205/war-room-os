This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Startup

Double-click `start-war-room.bat` to launch War Room.

On a fresh clone, run `pnpm install` first. You can also start the app with `.\start-war-room.ps1` in PowerShell; if scripts are blocked, relax the [execution policy](https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_execution_policies) for your user scope (for example `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`) or run the batch file instead.

Windows may show a **firewall** prompt the first time Node listens on port 3000. If the browser cannot load `http://localhost:3000`, allow Node for your current network profile.

For a public URL when your machine is off, see [docs/deploy-war-room-netlify-vercel.md](docs/deploy-war-room-netlify-vercel.md).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## War Room Environment

The Memory tool reads and writes through server-side API routes. Keep the Supabase service role key server-only; never expose it with a `NEXT_PUBLIC_` prefix.

Add this to `.env.local` for local development:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
FIRECRAWL_API_KEY=
TAVILY_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
RAEL_PHONE_NUMBER=
SUPABASE_FILES_BUCKET=
```

`SUPABASE_SERVICE_ROLE_KEY` is used only by `/api/tools/memory` on the server so the browser never receives it.
`FIRECRAWL_API_KEY` is used only by `/api/income/scout` on the server for Opportunity Scout search.
`TAVILY_API_KEY` is used only by `/api/income/scout` as the primary Opportunity Scout search provider.
Twilio variables are used only by `/api/sms/send` and `/api/sms/inbound` on the server for the SMS Bridge foundation.
`SUPABASE_FILES_BUCKET` is used only by `/api/files/upload` on the server for the Files / Evidence Vault. It must match the Supabase Storage bucket ID exactly, including spaces and capitalization. Current local target: `War Room Files`.

Payment operations should route through secure provider integrations such as Stripe, PayPal, Square, or ACH providers. SMS may notify Ra'el and collect low-risk responses, but financial actions require secure War Room approval and must not store raw routing or account numbers.

If you choose to keep anon-key access instead of the server service-role route, enable RLS policies for local app access in Supabase:

```sql
alter table public.memories enable row level security;

create policy "Allow anon read memories for local War Room"
on public.memories
for select
to anon
using (true);

create policy "Allow anon insert memories for local War Room"
on public.memories
for insert
to anon
with check (true);
```

The preferred development setup is the service-role server route above, not anon writes from the frontend.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
