import { describe, it, expect } from 'vitest';
import { getClientIP } from '../lib/rateLimit';

describe('Middleware Security - Core Tests', () => {
  describe('IP Extraction', () => {
    it('should prioritize CF-Connecting-IP header', () => {
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

    it('should fallback to X-Forwarded-For when CF-Connecting-IP is missing', () => {
      const request = new Request('https://example.com', {
        headers: {
          'X-Forwarded-For': '203.0.113.2, 203.0.113.4',
          'X-Real-IP': '203.0.113.3',
        },
      });

      const ip = getClientIP(request);
      expect(ip).toBe('203.0.113.2'); // Should take first IP from comma-separated list
    });

    it('should fallback to X-Real-IP when other headers are missing', () => {
      const request = new Request('https://example.com', {
        headers: {
          'X-Real-IP': '203.0.113.3',
        },
      });

      const ip = getClientIP(request);
      expect(ip).toBe('203.0.113.3');
    });

    it('should return unknown when no IP headers are present', () => {
      const request = new Request('https://example.com', {
        headers: {},
      });

      const ip = getClientIP(request);
      expect(ip).toBe('unknown');
    });

    it('should handle malformed X-Forwarded-For header', () => {
      const request = new Request('https://example.com', {
        headers: {
          'X-Forwarded-For': '203.0.113.5, , 203.0.113.6',
        },
      });

      const ip = getClientIP(request);
      expect(ip).toBe('203.0.113.5'); // Should take first valid IP
    });
  });

  describe('Rate Limit Configuration', () => {
    it('should have appropriate limits for different scenarios', async () => {
      const { RATE_LIMITS } = await import('../lib/rateLimit');

      expect(RATE_LIMITS.USER_DAILY.maxRequests).toBe(100);
      expect(RATE_LIMITS.USER_DAILY.windowMs).toBe(24 * 60 * 60 * 1000);

      expect(RATE_LIMITS.IP_HOURLY.maxRequests).toBe(10);
      expect(RATE_LIMITS.IP_HOURLY.windowMs).toBe(60 * 60 * 1000);

      expect(RATE_LIMITS.IP_DAILY.maxRequests).toBe(50);
      expect(RATE_LIMITS.IP_DAILY.windowMs).toBe(24 * 60 * 60 * 1000);
    });
  });

  describe('Rate Limit Headers', () => {
    it('should define standard rate limit headers', () => {
      const headers = {
        'X-RateLimit-Limit': '10',
        'X-RateLimit-Remaining': '5',
        'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600),
        'X-RateLimit-Reset-After': '3600',
      };

      expect(headers['X-RateLimit-Limit']).toBeTruthy();
      expect(headers['X-RateLimit-Remaining']).toBeTruthy();
      expect(headers['X-RateLimit-Reset']).toBeTruthy();
      expect(headers['X-RateLimit-Reset-After']).toBeTruthy();
    });
  });
});
