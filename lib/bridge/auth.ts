import { timingSafeEqual } from 'crypto'

export function bridgeTokenConfigured() {
  return Boolean(process.env.WAR_ROOM_BRIDGE_TOKEN?.trim())
}

export function authenticateBridgeRequest(request: Request) {
  const expected = process.env.WAR_ROOM_BRIDGE_TOKEN?.trim()
  if (!expected) {
    return { ok: false as const, status: 503, message: 'Bridge token is not configured.' }
  }

  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
  if (!token) {
    return { ok: false as const, status: 401, message: 'Bridge token required.' }
  }

  const expectedBytes = Buffer.from(expected)
  const receivedBytes = Buffer.from(token)
  const matches = expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes)

  if (!matches) {
    return { ok: false as const, status: 403, message: 'Bridge token rejected.' }
  }

  return { ok: true as const }
}
