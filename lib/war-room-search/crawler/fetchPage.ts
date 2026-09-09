import { WAR_ROOM_BOT_USER_AGENT, type CrawlLimits } from './types'
import {
  evaluateCrawlDestination,
  isAcceptedContentType,
  readDomainPolicy,
  type LookupFn,
} from './policy'
import type { CrawlApproval, DomainPolicy } from './types'

export const DEFAULT_CRAWL_LIMITS: CrawlLimits = {
  timeoutMs: 12_000,
  maxRedirects: 3,
  maxBytes: 1_000_000,
}

export type FetchImpl = typeof fetch

export type FetchedPage = {
  ok: true
  originalUrl: string
  finalUrl: string
  status: number
  contentType: string
  acceptedKind: 'html' | 'plain'
  body: string
  bytesReceived: number
  truncated: boolean
  redirectCount: number
}

export type FetchPageFailure = {
  ok: false
  originalUrl: string
  finalUrl: string | null
  status: number | null
  contentType: string | null
  bytesReceived: number
  errorCategory: string
  error: string
}

export type FetchPageResult = FetchedPage | FetchPageFailure

async function readBodyWithCap(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<{ buf: Uint8Array; truncated: boolean }> {
  if (!body) return { buf: new Uint8Array(), truncated: false }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value?.length) continue
    if (total + value.byteLength > maxBytes) {
      const slice = value.subarray(0, Math.max(0, maxBytes - total))
      if (slice.byteLength) chunks.push(slice)
      total = maxBytes
      truncated = true
      await reader.cancel()
      break
    }
    chunks.push(value)
    total += value.byteLength
  }
  const buf = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    buf.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { buf, truncated }
}

function combineSignals(timeoutMs: number, external?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const timeout = AbortSignal.timeout(timeoutMs)
  if (!external) return { signal: timeout, cleanup: () => undefined }
  if (typeof AbortSignal.any === 'function') {
    return { signal: AbortSignal.any([timeout, external]), cleanup: () => undefined }
  }
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (external.aborted || timeout.aborted) controller.abort()
  else {
    external.addEventListener('abort', onAbort, { once: true })
    timeout.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      external.removeEventListener('abort', onAbort)
    },
  }
}

export async function fetchBoundedPage(args: {
  url: string
  approval: CrawlApproval
  limits?: Partial<CrawlLimits>
  fetchImpl?: FetchImpl
  signal?: AbortSignal
  lookup?: LookupFn
  policy?: DomainPolicy
  userAgent?: string
}): Promise<FetchPageResult> {
  const limits: CrawlLimits = { ...DEFAULT_CRAWL_LIMITS, ...args.limits }
  const fetchImpl = args.fetchImpl ?? fetch
  const policy = args.policy ?? readDomainPolicy()
  const userAgent = args.userAgent ?? WAR_ROOM_BOT_USER_AGENT
  let current = args.url
  let redirectCount = 0
  let lastStatus: number | null = null
  let lastType: string | null = null
  let bytesReceived = 0

  for (let hop = 0; hop <= limits.maxRedirects; hop += 1) {
    const destination = await evaluateCrawlDestination({
      url: current,
      approval: args.approval,
      policy,
      lookup: args.lookup,
    })
    if (!destination.allowed) {
      return {
        ok: false,
        originalUrl: args.url,
        finalUrl: current,
        status: lastStatus,
        contentType: lastType,
        bytesReceived,
        errorCategory: destination.category,
        error: destination.reason,
      }
    }

    const { signal, cleanup } = combineSignals(limits.timeoutMs, args.signal)
    try {
      const response = await fetchImpl(current, {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: {
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.8',
          'user-agent': userAgent,
        },
      })
      lastStatus = response.status
      lastType = response.headers.get('content-type')
      const location = response.headers.get('location')
      if ([301, 302, 303, 307, 308].includes(response.status) && location) {
        redirectCount += 1
        if (redirectCount > limits.maxRedirects) {
          return {
            ok: false,
            originalUrl: args.url,
            finalUrl: current,
            status: response.status,
            contentType: lastType,
            bytesReceived,
            errorCategory: 'REDIRECT_LIMIT',
            error: `Exceeded maximum redirects (${limits.maxRedirects}).`,
          }
        }
        current = new URL(location, current).toString()
        continue
      }

      const declaredLength = Number(response.headers.get('content-length') ?? '')
      if (Number.isFinite(declaredLength) && declaredLength > limits.maxBytes) {
        return {
          ok: false,
          originalUrl: args.url,
          finalUrl: current,
          status: response.status,
          contentType: lastType,
          bytesReceived: 0,
          errorCategory: 'RESPONSE_TOO_LARGE',
          error: `Content-Length ${declaredLength} exceeds ${limits.maxBytes} bytes.`,
        }
      }

      const { buf, truncated } = await readBodyWithCap(response.body, limits.maxBytes)
      bytesReceived = buf.byteLength
      if (truncated) {
        return {
          ok: false,
          originalUrl: args.url,
          finalUrl: current,
          status: response.status,
          contentType: lastType,
          bytesReceived,
          errorCategory: 'RESPONSE_TOO_LARGE',
          error: `Response exceeded ${limits.maxBytes} bytes.`,
        }
      }

      if (response.status < 200 || response.status >= 300) {
        return {
          ok: false,
          originalUrl: args.url,
          finalUrl: current,
          status: response.status,
          contentType: lastType,
          bytesReceived,
          errorCategory: 'HTTP_STATUS',
          error: `Unexpected HTTP status ${response.status}.`,
        }
      }

      const acceptedKind = isAcceptedContentType(lastType)
      if (!acceptedKind) {
        return {
          ok: false,
          originalUrl: args.url,
          finalUrl: current,
          status: response.status,
          contentType: lastType,
          bytesReceived,
          errorCategory: 'UNSUPPORTED_CONTENT_TYPE',
          error: `Unsupported content type: ${lastType ?? 'unknown'}`,
        }
      }

      const body = new TextDecoder('utf-8', { fatal: false }).decode(buf)
      return {
        ok: true,
        originalUrl: args.url,
        finalUrl: current,
        status: response.status,
        contentType: lastType ?? (acceptedKind === 'plain' ? 'text/plain' : 'text/html'),
        acceptedKind,
        body,
        bytesReceived,
        truncated: false,
        redirectCount,
      }
    } catch (error) {
      const aborted = error instanceof Error && (error.name === 'AbortError' || /timeout|abort/i.test(error.message))
      return {
        ok: false,
        originalUrl: args.url,
        finalUrl: current,
        status: lastStatus,
        contentType: lastType,
        bytesReceived,
        errorCategory: aborted ? 'TIMEOUT' : 'FETCH_ERROR',
        error: aborted ? 'Request timed out.' : error instanceof Error ? error.message : 'Fetch failed.',
      }
    } finally {
      cleanup()
    }
  }

  return {
    ok: false,
    originalUrl: args.url,
    finalUrl: current,
    status: lastStatus,
    contentType: lastType,
    bytesReceived,
    errorCategory: 'REDIRECT_LIMIT',
    error: 'Redirect loop or hop limit reached.',
  }
}
