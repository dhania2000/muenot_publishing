export type RateLimitResult = { allowed: boolean; retryAfter: number; remaining: number }
type RateLimitOptions = { max: number; windowMs: number }

const buckets = new Map<string, { count: number; resetAt: number }>()

/** Per-instance fixed window. Adequate for a single-organisation deployment. */
export async function checkRateLimit(key: string, options: RateLimitOptions): Promise<RateLimitResult> {
  const now = Date.now()
  let bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + options.windowMs }
    buckets.set(key, bucket)
    if (buckets.size > 10_000) for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k)
  }
  bucket.count++
  const allowed = bucket.count <= options.max
  return { allowed, remaining: Math.max(0, options.max - bucket.count), retryAfter: allowed ? 0 : Math.ceil((bucket.resetAt - now) / 1000) }
}
