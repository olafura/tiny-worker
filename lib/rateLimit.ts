interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  keyPrefix: string; // Prefix for KV keys
}

interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetTime: number;
  error?: string;
}

export class RateLimiter {
  private config: RateLimitConfig;
  private kv: KVNamespace;

  constructor(kv: KVNamespace, config: RateLimitConfig) {
    this.kv = kv;
    this.config = config;
  }

  async checkLimit(identifier: string): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = Math.floor(now / this.config.windowMs) * this.config.windowMs;
    const key = `${this.config.keyPrefix}:${identifier}:${windowStart}`;

    try {
      // Get current count for this window
      const currentCountStr = await this.kv.get(key);
      const currentCount = currentCountStr ? parseInt(currentCountStr, 10) : 0;

      if (currentCount >= this.config.maxRequests) {
        return {
          success: false,
          remaining: 0,
          resetTime: windowStart + this.config.windowMs,
          error: 'Rate limit exceeded',
        };
      }

      // Increment counter
      const newCount = currentCount + 1;
      const ttl = Math.ceil((windowStart + this.config.windowMs - now) / 1000);

      await this.kv.put(key, newCount.toString(), { expirationTtl: ttl });

      return {
        success: true,
        remaining: this.config.maxRequests - newCount,
        resetTime: windowStart + this.config.windowMs,
      };
    } catch (error) {
      // If rate limiting fails, allow the request but log the error
      console.error('Rate limiting error:', error);
      return {
        success: true,
        remaining: this.config.maxRequests - 1,
        resetTime: windowStart + this.config.windowMs,
        error: 'Rate limiting service unavailable',
      };
    }
  }
}

// Rate limiting configurations
export const RATE_LIMITS = {
  USER_DAILY: {
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    maxRequests: 100,
    keyPrefix: 'rate_limit_user_daily',
  },
  IP_HOURLY: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 10,
    keyPrefix: 'rate_limit_ip_hourly',
  },
  IP_DAILY: {
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    maxRequests: 50,
    keyPrefix: 'rate_limit_ip_daily',
  },
} as const;

export function getClientIP(request: Request): string {
  // Check various headers for the real IP
  const cfConnectingIP = request.headers.get('CF-Connecting-IP');
  const xForwardedFor = request.headers.get('X-Forwarded-For');
  const xRealIP = request.headers.get('X-Real-IP');

  // Cloudflare provides the real IP in CF-Connecting-IP
  if (cfConnectingIP) {
    return cfConnectingIP;
  }

  // Fallback to other headers
  if (xForwardedFor) {
    // X-Forwarded-For can contain multiple IPs, take the first one
    return xForwardedFor.split(',')[0].trim();
  }

  if (xRealIP) {
    return xRealIP;
  }

  // Fallback to a default (should not happen in Cloudflare Workers)
  return 'unknown';
}
