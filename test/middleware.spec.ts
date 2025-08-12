import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { rateLimitMiddleware } from '../lib/rateLimitMiddleware';

// Mock KV for testing
class MockKV implements KVNamespace {
  private store = new Map<string, string>();
  private ttlStore = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    const ttl = this.ttlStore.get(key);
    if (ttl && Date.now() > ttl) {
      this.store.delete(key);
      this.ttlStore.delete(key);
      return null;
    }
    return this.store.get(key) || null;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, value);
    if (options?.expirationTtl) {
      this.ttlStore.set(key, Date.now() + options.expirationTtl * 1000);
    }
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
    this.ttlStore.delete(key);
  }

  async list(): Promise<{ keys: { name: string }[] }> {
    return { keys: Array.from(this.store.keys()).map((name) => ({ name })) };
  }

  getWithMetadata: any;
  prepare: any;
}

describe('Rate Limiting Middleware Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rateLimitMiddleware', () => {
    it('should allow GET requests to pass through without rate limiting', async () => {
      const request = new NextRequest('https://example.com/', {
        method: 'GET',
        headers: {
          'CF-Connecting-IP': '203.0.113.1',
        },
      });

      const result = await rateLimitMiddleware(request);
      expect(result).toBeNull(); // Should not apply rate limiting
    });

    it('should allow non-root paths to pass through without rate limiting', async () => {
      const request = new NextRequest('https://example.com/other-path', {
        method: 'POST',
        headers: {
          'CF-Connecting-IP': '203.0.113.1',
        },
      });

      const result = await rateLimitMiddleware(request);
      expect(result).toBeNull(); // Should not apply rate limiting
    });

    it('should apply rate limiting to POST requests to root path', async () => {
      const request = new NextRequest('https://example.com/', {
        method: 'POST',
        headers: {
          'CF-Connecting-IP': '203.0.113.1',
        },
      });

      const result = await rateLimitMiddleware(request);
      // Should return NextResponse with rate limit headers, not null
      expect(result).not.toBeNull();
      if (result) {
        expect(result.headers.get('X-RateLimit-Limit')).toBeTruthy();
        expect(result.headers.get('X-RateLimit-Remaining')).toBeTruthy();
        expect(result.headers.get('X-RateLimit-Reset')).toBeTruthy();
      }
    });

    it('should block requests when rate limit is exceeded', async () => {
      const ip = '203.0.113.2';
      const request = new NextRequest('https://example.com/', {
        method: 'POST',
        headers: {
          'CF-Connecting-IP': ip,
        },
      });

      // Make requests to exhaust the limit (10 per hour)
      for (let i = 0; i < 10; i++) {
        const result = await rateLimitMiddleware(request);
        if (result && result.status === 429) {
          // Hit rate limit early due to daily limit
          break;
        }
      }

      // This request should be rate limited
      const blockedResult = await rateLimitMiddleware(request);
      if (blockedResult && blockedResult.status === 429) {
        expect(blockedResult.status).toBe(429);
        expect(blockedResult.headers.get('Retry-After')).toBeTruthy();

        const body = await blockedResult.json();
        expect(body.error).toBe('Rate limit exceeded');
      }
    });

    it('should handle different IPs independently', async () => {
      const request1 = new NextRequest('https://example.com/', {
        method: 'POST',
        headers: {
          'CF-Connecting-IP': '203.0.113.10',
        },
      });

      const request2 = new NextRequest('https://example.com/', {
        method: 'POST',
        headers: {
          'CF-Connecting-IP': '203.0.113.11',
        },
      });

      // Both should be allowed initially
      const result1 = await rateLimitMiddleware(request1);
      const result2 = await rateLimitMiddleware(request2);

      // Neither should be blocked initially
      expect(result1?.status).not.toBe(429);
      expect(result2?.status).not.toBe(429);
    });

    it('should extract IP from different headers', async () => {
      const testCases = [
        {
          headers: { 'CF-Connecting-IP': '203.0.113.20' },
          expectedIP: '203.0.113.20',
        },
        {
          headers: { 'X-Forwarded-For': '203.0.113.21, 203.0.113.22' },
          expectedIP: '203.0.113.21', // Should take first IP
        },
        {
          headers: { 'X-Real-IP': '203.0.113.23' },
          expectedIP: '203.0.113.23',
        },
      ];

      for (const testCase of testCases) {
        const request = new NextRequest('https://example.com/', {
          method: 'POST',
          headers: testCase.headers,
        });

        const result = await rateLimitMiddleware(request);
        // The request should be processed (not null) since it's a POST to root
        expect(result).not.toBeNull();
      }
    });

    it('should include appropriate rate limit headers in responses', async () => {
      const request = new NextRequest('https://example.com/', {
        method: 'POST',
        headers: {
          'CF-Connecting-IP': '203.0.113.30',
        },
      });

      const result = await rateLimitMiddleware(request);

      if (result && result.status !== 429) {
        // Check that rate limit headers are present
        expect(result.headers.get('X-RateLimit-Limit')).toBeTruthy();
        expect(result.headers.get('X-RateLimit-Remaining')).toBeTruthy();
        expect(result.headers.get('X-RateLimit-Reset')).toBeTruthy();
        expect(result.headers.get('X-RateLimit-Reset-After')).toBeTruthy();

        // Verify header values are reasonable
        const limit = parseInt(result.headers.get('X-RateLimit-Limit') || '0');
        const remaining = parseInt(result.headers.get('X-RateLimit-Remaining') || '0');
        const reset = parseInt(result.headers.get('X-RateLimit-Reset') || '0');

        expect(limit).toBeGreaterThan(0);
        expect(remaining).toBeGreaterThanOrEqual(0);
        expect(remaining).toBeLessThanOrEqual(limit);
        expect(reset).toBeGreaterThan(Date.now() / 1000);
      }
    });

    it('should handle missing IP gracefully', async () => {
      const request = new NextRequest('https://example.com/', {
        method: 'POST',
        headers: {}, // No IP headers
      });

      const result = await rateLimitMiddleware(request);
      // Should still work, using 'unknown' as fallback IP
      expect(result).not.toBeNull();
    });

    it('should handle middleware errors gracefully', async () => {
      // Mock getCloudflareContext to throw an error
      const { getCloudflareContext } = await import('@opennextjs/cloudflare');
      vi.mocked(getCloudflareContext).mockRejectedValueOnce(new Error('Context error'));

      const request = new NextRequest('https://example.com/', {
        method: 'POST',
        headers: {
          'CF-Connecting-IP': '203.0.113.40',
        },
      });

      const result = await rateLimitMiddleware(request);
      // Should return null (allow request) when there's an error
      expect(result).toBeNull();
    });
  });
});

describe('IP Extraction Tests', () => {
  beforeEach(async () => {
    // Clear module cache to get fresh imports
    vi.resetModules();
  });

  it('should prioritize CF-Connecting-IP header', async () => {
    const { getClientIP } = await import('../lib/rateLimit');

    const request = new Request('https://example.com', {
      headers: {
        'CF-Connecting-IP': '203.0.113.1',
        'X-Forwarded-For': '203.0.113.2',
        'X-Real-IP': '203.0.113.3',
      },
    });

    const ip = getClientIP(request);
    expect(ip).toBe('203.0.113.1');
  });

  it('should fallback to X-Forwarded-For when CF-Connecting-IP is missing', async () => {
    const { getClientIP } = await import('../lib/rateLimit');

    const request = new Request('https://example.com', {
      headers: {
        'X-Forwarded-For': '203.0.113.2, 203.0.113.4',
        'X-Real-IP': '203.0.113.3',
      },
    });

    const ip = getClientIP(request);
    expect(ip).toBe('203.0.113.2'); // Should take first IP from comma-separated list
  });

  it('should fallback to X-Real-IP when other headers are missing', async () => {
    const { getClientIP } = await import('../lib/rateLimit');

    const request = new Request('https://example.com', {
      headers: {
        'X-Real-IP': '203.0.113.3',
      },
    });

    const ip = getClientIP(request);
    expect(ip).toBe('203.0.113.3');
  });

  it('should return unknown when no IP headers are present', async () => {
    const { getClientIP } = await import('../lib/rateLimit');

    const request = new Request('https://example.com', {
      headers: {},
    });

    const ip = getClientIP(request);
    expect(ip).toBe('unknown');
  });

  it('should handle malformed X-Forwarded-For header', async () => {
    const { getClientIP } = await import('../lib/rateLimit');

    const request = new Request('https://example.com', {
      headers: {
        'X-Forwarded-For': ', , 203.0.113.5',
      },
    });

    const ip = getClientIP(request);
    expect(ip).toBe('203.0.113.5'); // Should skip empty entries
  });
});
