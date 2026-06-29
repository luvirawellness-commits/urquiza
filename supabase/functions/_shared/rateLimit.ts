import { Redis } from 'https://esm.sh/@upstash/redis@1.34.3'

const redis = new Redis({
  url: Deno.env.get('UPSTASH_REDIS_REST_URL')!,
  token: Deno.env.get('UPSTASH_REDIS_REST_TOKEN')!,
})

interface RateLimitOptions {
  key: string
  limit: number
  windowSeconds: number
}

interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetIn: number
}

export async function checkRateLimit(opts: RateLimitOptions): Promise<RateLimitResult> {
  const redisKey = `rl:${opts.key}`

  const current = await redis.incr(redisKey)

  if (current === 1) {
    await redis.expire(redisKey, opts.windowSeconds)
  }

  const ttl = await redis.ttl(redisKey)
  const allowed = current <= opts.limit

  return {
    allowed,
    remaining: Math.max(0, opts.limit - current),
    resetIn: ttl > 0 ? ttl : opts.windowSeconds,
  }
}

export function rateLimitResponse(resetIn: number): Response {
  return new Response(
    JSON.stringify({ error: 'Too many requests', retryAfter: resetIn }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(resetIn),
      },
    },
  )
}
