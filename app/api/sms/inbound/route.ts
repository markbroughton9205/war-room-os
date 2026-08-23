function twiml(message: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`
}

function cleanCommand(value: FormDataEntryValue | null) {
  return String(value ?? '').trim().toUpperCase()
}

export async function POST(req: Request) {
  return new Response(twiml('War Room legacy SMS endpoint is deprecated.'), { status: 410, headers: { 'Content-Type': 'text/xml' } })
  /* const form = await req.formData()
  const command = cleanCommand(form.get('Body'))
  const from = String(form.get('From') ?? '').trim()
  const raelPhone = process.env.RAEL_PHONE_NUMBER

  if (raelPhone && from && from !== raelPhone) {
    return new Response(twiml('War Room SMS Bridge: sender not authorized.'), {
      headers: { 'Content-Type': 'text/xml' },
    })
  }

  const responses: Record<string, string> = {
    YES: 'War Room received YES. Low-risk approval replies will connect to the action queue in the next SMS phase.',
    NO: 'War Room received NO. No action executed by SMS.',
    STATUS: 'War Room status request received. SMS status summaries are not connected yet.',
    PAUSE: 'War Room pause request received. Council pause by SMS is not connected yet.',
    RESUME: 'War Room resume request received. Council resume by SMS is not connected yet.',
    SCOUT: 'War Room received SCOUT. Opportunity Scout by SMS is not connected yet.',
  }

  return new Response(twiml(responses[command] ?? 'War Room SMS Bridge commands: YES, NO, STATUS, PAUSE, RESUME, SCOUT.'), {
    headers: { 'Content-Type': 'text/xml' },
  }) */
}
