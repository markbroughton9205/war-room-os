import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json({
    tool: 'income-currency-conversion',
    status: 'config_needed',
    message: 'Currency conversion requires a configured exchange-rate provider before War Room can estimate USD values. No conversion is inferred.',
    missingDependency: 'Exchange-rate provider API key or an approved source-backed currency-rate table.',
    implementationRemaining: 'Add a reviewed currency-rate adapter, record source/timestamp for each rate, then wire this route to that adapter.',
    usd_estimate: null,
  }, { status: 503, headers: { 'cache-control': 'no-store' } })
}
