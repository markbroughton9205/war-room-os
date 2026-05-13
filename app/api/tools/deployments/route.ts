import { NextResponse } from 'next/server'

function deploymentProviderConfigured() {
  return Boolean(
    process.env.VERCEL_ACCESS_TOKEN?.trim()
      || process.env.VERCEL_TOKEN?.trim()
      || process.env.VERCEL_OIDC_TOKEN?.trim()
      || process.env.VERCEL_API_TOKEN?.trim(),
  )
}

export async function GET() {
  const connected = deploymentProviderConfigured()
  return NextResponse.json({
    tool: 'deployments',
    connected,
    status: connected ? 'standby' : 'not_connected',
    message: connected
      ? 'Deployment API token detected (standby until invoked).'
      : 'No Vercel or deployment API token env detected (VERCEL_ACCESS_TOKEN, VERCEL_TOKEN, VERCEL_OIDC_TOKEN, or VERCEL_API_TOKEN).',
  })
}
