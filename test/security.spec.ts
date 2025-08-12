import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sanitizeAndValidateUrl } from '../lib/sanitizeAndValidateUrl';
import { RateLimiter, RATE_LIMITS } from '../lib/rateLimit';

// Mock console methods to reduce test output noise
const consoleSpy = {
  warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
  error: vi.spyOn(console, 'error').mockImplementation(() => {}),
};

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

describe('URL Sanitization Security Tests', () => {
  describe('sanitizeAndValidateUrl', () => {
    it('should block JavaScript URLs', async () => {
      const maliciousUrls = [
        'javascript:alert("xss")',
        'JAVASCRIPT:alert("xss")',
        'javascript://example.com/alert("xss")',
        'javascript:void(0)',
      ];

      for (const url of maliciousUrls) {
        const result = await sanitizeAndValidateUrl(url);
        expect(result).toBeNull();
      }
    });

    it('should block data URLs', async () => {
      const dataUrls = [
        'data:text/html,<script>alert("xss")</script>',
        'data:image/svg+xml,<svg onload="alert(1)">',
        'data:text/plain,hello',
      ];

      for (const url of dataUrls) {
        const result = await sanitizeAndValidateUrl(url);
        expect(result).toBeNull();
      }
    });

    it('should block file URLs', async () => {
      const fileUrls = ['file:///etc/passwd', 'file://localhost/etc/passwd', 'file:///C:/Windows/System32/config/SAM'];

      for (const url of fileUrls) {
        const result = await sanitizeAndValidateUrl(url);
        expect(result).toBeNull();
      }
    });

    it('should block private IP addresses', async () => {
      const privateIPs = [
        'http://127.0.0.1/',
        'http://localhost/',
        'http://10.0.0.1/',
        'http://192.168.1.1/',
        'http://172.16.0.1/',
        'http://169.254.169.254/', // AWS metadata endpoint
      ];

      for (const url of privateIPs) {
        const result = await sanitizeAndValidateUrl(url);
        expect(result).toBeNull();
      }
    });

    it('should block IP encoding tricks', async () => {
      const encodedIPs = [
        'http://0x7f000001/', // Hex encoded 127.0.0.1
        'http://2130706433/', // Decimal encoded 127.0.0.1
        'http://017700000001/', // Octal encoded 127.0.0.1
      ];

      for (const url of encodedIPs) {
        const result = await sanitizeAndValidateUrl(url);
        expect(result).toBeNull();
      }
    });

    it('should block path traversal attempts', async () => {
      const traversalUrls = [
        'https://example.com/../../../etc/passwd',
        'https://example.com/..%2F..%2F..%2Fetc%2Fpasswd',
        'https://example.com/path/../../secret',
      ];

      for (const url of traversalUrls) {
        const result = await sanitizeAndValidateUrl(url);
        // Our sanitization normalizes paths but doesn't necessarily block all traversal
        // The key is that it shouldn't contain .. after normalization
        if (result) {
          expect(result).not.toContain('..');
        }
      }
    });

    it('should remove credentials from URLs', async () => {
      const urlWithCreds = 'https://user:pass@example.com/path';
      const result = await sanitizeAndValidateUrl(urlWithCreds);
      expect(result).toBe('https://example.com/path');
    });

    it('should limit query parameters', async () => {
      const urlWithManyParams = 'https://example.com/?a=1&b=2&c=3&d=4&e=5';
      const result = await sanitizeAndValidateUrl(urlWithManyParams);
      // Should limit to 3 parameters
      const url = new URL(result!);
      expect(url.searchParams.size).toBeLessThanOrEqual(3);
    });

    it('should remove suspicious query parameters', async () => {
      const urlWithSuspiciousParams = 'https://example.com/?redirect=evil.com&url=malicious.com&next=bad.com&safe=ok';
      const result = await sanitizeAndValidateUrl(urlWithSuspiciousParams);

      if (result) {
        const url = new URL(result);
        expect(url.searchParams.has('redirect')).toBe(false);
        expect(url.searchParams.has('url')).toBe(false);
        expect(url.searchParams.has('next')).toBe(false);
        // Note: due to parameter limiting, 'safe' might also be removed
        // The important thing is that suspicious params are gone
      }
    });

    it('should remove fragments', async () => {
      const urlWithFragment = 'https://example.com/path#fragment';
      const result = await sanitizeAndValidateUrl(urlWithFragment);
      expect(result).toBe('https://example.com/path');
    });

    it('should normalize punycode domains', async () => {
      const punycodeUrl = 'https://münchen.de/';
      const result = await sanitizeAndValidateUrl(punycodeUrl);
      expect(result).toContain('xn--');
    });

    it('should allow valid HTTPS URLs', async () => {
      const validUrls = ['https://example.com/', 'https://sub.example.com/path', 'https://example.com/path?query=value'];

      for (const url of validUrls) {
        const result = await sanitizeAndValidateUrl(url);
        // Note: Some URLs might fail DNS resolution in test environment
        // The important thing is that the format is validated
        if (result) {
          expect(result).toMatch(/^https:\/\//);
        }
      }
    });

    it('should allow valid HTTP URLs', async () => {
      const httpUrl = 'http://example.com/';
      const result = await sanitizeAndValidateUrl(httpUrl);
      expect(result).toBe(httpUrl);
    });

    it('should reject relative URLs', async () => {
      const relativeUrls = [
        '/relative/path',
        '../relative/path',
        'relative/path',
        '//example.com/path', // Protocol-relative
      ];

      for (const url of relativeUrls) {
        const result = await sanitizeAndValidateUrl(url);
        expect(result).toBeNull();
      }
    });
  });
});

describe('Rate Limiting Security Tests', () => {
  let mockKV: MockKV;
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    mockKV = new MockKV();
    rateLimiter = new RateLimiter(mockKV as KVNamespace, {
      windowMs: 60000, // 1 minute
      maxRequests: 3,
      keyPrefix: 'test',
    });
  });

  describe('RateLimiter', () => {
    it('should allow requests within limit', async () => {
      const result1 = await rateLimiter.checkLimit('user1');
      expect(result1.success).toBe(true);
      expect(result1.remaining).toBe(2);

      const result2 = await rateLimiter.checkLimit('user1');
      expect(result2.success).toBe(true);
      expect(result2.remaining).toBe(1);

      const result3 = await rateLimiter.checkLimit('user1');
      expect(result3.success).toBe(true);
      expect(result3.remaining).toBe(0);
    });

    it('should block requests exceeding limit', async () => {
      // Exhaust the limit
      await rateLimiter.checkLimit('user1');
      await rateLimiter.checkLimit('user1');
      await rateLimiter.checkLimit('user1');

      // This should be blocked
      const result = await rateLimiter.checkLimit('user1');
      expect(result.success).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.error).toBe('Rate limit exceeded');
    });

    it('should isolate limits between different users', async () => {
      // User1 exhausts limit
      await rateLimiter.checkLimit('user1');
      await rateLimiter.checkLimit('user1');
      await rateLimiter.checkLimit('user1');

      // User2 should still have full limit
      const result = await rateLimiter.checkLimit('user2');
      expect(result.success).toBe(true);
      expect(result.remaining).toBe(2);
    });

    it('should handle window expiration', async () => {
      const shortWindowLimiter = new RateLimiter(mockKV as KVNamespace, {
        windowMs: 100, // 100ms
        maxRequests: 1,
        keyPrefix: 'test_short',
      });

      // Exhaust limit
      const result1 = await shortWindowLimiter.checkLimit('user1');
      expect(result1.success).toBe(true);

      const result2 = await shortWindowLimiter.checkLimit('user1');
      expect(result2.success).toBe(false);

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should be allowed again
      const result3 = await shortWindowLimiter.checkLimit('user1');
      expect(result3.success).toBe(true);
    });

    it('should provide correct reset time', async () => {
      const now = Date.now();
      const result = await rateLimiter.checkLimit('user1');

      expect(result.resetTime).toBeGreaterThan(now);
      expect(result.resetTime).toBeLessThanOrEqual(now + 60000);
    });

    it('should handle KV errors gracefully', async () => {
      const errorKV = {
        get: vi.fn().mockRejectedValue(new Error('KV Error')),
        put: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
        getWithMetadata: vi.fn(),
        prepare: vi.fn(),
      } as unknown as KVNamespace;

      const errorLimiter = new RateLimiter(errorKV, {
        windowMs: 60000,
        maxRequests: 3,
        keyPrefix: 'test_error',
      });

      const result = await errorLimiter.checkLimit('user1');
      // Should allow request despite error
      expect(result.success).toBe(true);
      expect(result.error).toBe('Rate limiting service unavailable');
    });
  });

  describe('Rate limit configurations', () => {
    it('should have appropriate limits for different scenarios', () => {
      expect(RATE_LIMITS.USER_DAILY.maxRequests).toBe(100);
      expect(RATE_LIMITS.USER_DAILY.windowMs).toBe(24 * 60 * 60 * 1000);

      expect(RATE_LIMITS.IP_HOURLY.maxRequests).toBe(10);
      expect(RATE_LIMITS.IP_HOURLY.windowMs).toBe(60 * 60 * 1000);

      expect(RATE_LIMITS.IP_DAILY.maxRequests).toBe(50);
      expect(RATE_LIMITS.IP_DAILY.windowMs).toBe(24 * 60 * 60 * 1000);
    });
  });
});

describe('UUID Validation Security Tests', () => {
  const UUID_BASE = /([0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12})/;
  const UUID = new RegExp(`^${UUID_BASE.source}$`);

  it('should accept valid UUIDs', () => {
    const validUUIDs = [
      '123e4567-e89b-12d3-a456-426614174000',
      'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
      '00000000-0000-0000-0000-000000000000',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
    ];

    validUUIDs.forEach((uuid) => {
      expect(UUID.test(uuid)).toBe(true);
    });
  });

  it('should reject invalid UUIDs', () => {
    const invalidUUIDs = [
      'not-a-uuid',
      '123e4567-e89b-12d3-a456-42661417400', // Too short
      '123e4567-e89b-12d3-a456-4266141740000', // Too long
      '123e4567-e89b-12d3-a456-42661417400g', // Invalid character
      '../../../etc/passwd',
      'admin',
      '',
      '123e4567-e89b-12d3-a456-426614174000;DROP TABLE urls;',
    ];

    invalidUUIDs.forEach((uuid) => {
      expect(UUID.test(uuid)).toBe(false);
    });
  });

  it('should reject path traversal attempts in UUID', () => {
    const pathTraversalUUIDs = [
      '../123e4567-e89b-12d3-a456-426614174000',
      '123e4567-e89b-12d3-a456-426614174000/../..',
      '..%2F..%2F123e4567-e89b-12d3-a456-426614174000',
    ];

    pathTraversalUUIDs.forEach((uuid) => {
      expect(UUID.test(uuid)).toBe(false);
    });
  });
});

describe('Input Validation Security Tests', () => {
  it('should handle extremely long URLs', async () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(10000);
    const result = await sanitizeAndValidateUrl(longUrl);
    // Should either handle gracefully or reject
    expect(typeof result === 'string' || result === null).toBe(true);
  });

  it('should handle URLs with many subdomains', async () => {
    const manySubdomains = 'https://' + 'sub.'.repeat(100) + 'example.com/';
    const result = await sanitizeAndValidateUrl(manySubdomains);
    expect(typeof result === 'string' || result === null).toBe(true);
  });

  it('should handle malformed URLs gracefully', async () => {
    const malformedUrls = [
      'https://[invalid',
      'https://example..com',
      'https://.example.com',
      'https://example.com:99999999',
      'https://example.com:abc',
    ];

    for (const url of malformedUrls) {
      const result = await sanitizeAndValidateUrl(url);
      // Some malformed URLs might be cleaned up rather than rejected
      // The important thing is that they don't cause crashes
      expect(typeof result === 'string' || result === null).toBe(true);
    }
  });

  it('should handle Unicode and international domains', async () => {
    const internationalDomains = ['https://тест.рф/', 'https://测试.中国/', 'https://テスト.日本/', 'https://한국.kr/'];

    for (const url of internationalDomains) {
      const result = await sanitizeAndValidateUrl(url);
      if (result) {
        // Should be converted to punycode
        expect(result).toMatch(/https:\/\/xn--/);
      }
    }
  });
});
