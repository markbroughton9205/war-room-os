/**
 * In-process request throttle for providers that publish an explicit fair-use cap
 * (511NY: 10 requests / 60 seconds). In-memory only — resets on redeploy.
 */
type Bucket = { timestamps: number[] }

const buckets = new Map<string, Bucket>()

export function allowThrottledRequest(id: string, maxRequests: number, windowMs: number, now = Date.now()): boolean {
  const bucket = buckets.get(id) ?? { timestamps: [] }
  bucket.timestamps = bucket.timestamps.filter(ts => now - ts < windowMs)
  if (bucket.timestamps.length >= maxRequests) {
    buckets.set(id, bucket)
    return false
  }
  bucket.timestamps.push(now)
  buckets.set(id, bucket)
  return true
}

export function __resetProviderRequestThrottleForTests(): void {
  buckets.clear()
}
