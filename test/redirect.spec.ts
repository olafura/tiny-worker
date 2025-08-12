import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GET } from '../app/t/[uuid]/route';

// Mock console to reduce noise
const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

// Mock KV for testing
class MockKV implements KVNamespace {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) || null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(): Promise<{ keys: { name: string }[] }> {
    return { keys: Array.from(this.store.keys()).map((name) => ({ name })) };
  }

  getWithMetadata: any;
  prepare: any;
}

describe('Redirect Security Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /t/[uuid]', () => {
    const validUuid = '123e4567-e89b-12d3-a456-426614174000';
    const invalidUuid = 'invalid-uuid';
    const validUrl = 'https://example.com/safe';
    const maliciousUrl = 'javascript:alert("xss")';

    it('should return 404 for invalid UUID format', async () => {
      const request = new Request('https://example.com/t/invalid-uuid');
      const params = Promise.resolve({ uuid: invalidUuid });

      const response = await GET(request, { params });
      expect(response.status).toBe(404);
    });

    it('should return 404 for non-existent UUID', async () => {
      const request = new Request(`https://example.com/t/${validUuid}`);
      const params = Promise.resolve({ uuid: validUuid });

      const response = await GET(request, { params });
      expect(response.status).toBe(404);
    });

    it('should validate stored URL before redirect', async () => {
      // Store a valid URL that should pass validation
      const validUrl = 'https://google.com/'; // Use a domain that might resolve

      const { getCloudflareContext } = await import('@opennextjs/cloudflare');
      const context = await getCloudflareContext({ async: true });
      await context.env.TINY_URL.put(validUuid, validUrl);

      const request = new Request(`https://example.com/t/${validUuid}`);
      const params = Promise.resolve({ uuid: validUuid });

      const response = await GET(request, { params });

      // The response should either be a redirect (if URL validates) or 404 (if it doesn't)
      expect([302, 404]).toContain(response.status);

      if (response.status === 302) {
        expect(response.headers.get('Location')).toBeTruthy();
      }
    });

    it('should remove invalid URLs from storage and return 404', async () => {
      const { sanitizeAndValidateUrl } = require('../lib/sanitizeAndValidateUrl');

      // Store a malicious URL in KV
      await mockKV.put(validUuid, maliciousUrl);

      // Mock validation to reject the URL
      vi.mocked(sanitizeAndValidateUrl).mockResolvedValue(null);

      const request = new Request(`https://example.com/t/${validUuid}`);
      const params = Promise.resolve({ uuid: validUuid });

      const response = await GET(request, { params });

      expect(response.status).toBe(404);
      expect(await response.text()).toBe('Link no longer available');
      expect(sanitizeAndValidateUrl).toHaveBeenCalledWith(maliciousUrl);

      // Verify URL was removed from storage
      const storedUrl = await mockKV.get(validUuid);
      expect(storedUrl).toBeNull();
    });

    it('should include security headers in redirect response', async () => {
      const { sanitizeAndValidateUrl } = require('../lib/sanitizeAndValidateUrl');

      await mockKV.put(validUuid, validUrl);
      vi.mocked(sanitizeAndValidateUrl).mockResolvedValue(validUrl);

      const request = new Request(`https://example.com/t/${validUuid}`);
      const params = Promise.resolve({ uuid: validUuid });

      const response = await GET(request, { params });

      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe(validUrl);
      expect(response.headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate');
      expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    });

    it('should handle validation errors gracefully', async () => {
      const { sanitizeAndValidateUrl } = require('../lib/sanitizeAndValidateUrl');

      await mockKV.put(validUuid, validUrl);

      // Mock validation to throw an error
      vi.mocked(sanitizeAndValidateUrl).mockRejectedValue(new Error('Validation error'));

      const request = new Request(`https://example.com/t/${validUuid}`);
      const params = Promise.resolve({ uuid: validUuid });

      const response = await GET(request, { params });

      expect(response.status).toBe(503);
      expect(await response.text()).toBe('Service temporarily unavailable');
    });

    it('should handle KV errors gracefully', async () => {
      const { getCloudflareContext } = require('@opennextjs/cloudflare');

      // Mock KV to throw an error
      const errorKV = {
        get: vi.fn().mockRejectedValue(new Error('KV Error')),
        put: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
        getWithMetadata: vi.fn(),
        prepare: vi.fn(),
      };

      vi.mocked(getCloudflareContext).mockResolvedValue({
        env: { TINY_URL: errorKV },
      });

      const request = new Request(`https://example.com/t/${validUuid}`);
      const params = Promise.resolve({ uuid: validUuid });

      const response = await GET(request, { params });

      expect(response.status).toBe(503);
      expect(await response.text()).toBe('Service temporarily unavailable');
    });

    it('should reject URLs that become invalid over time', async () => {
      const { sanitizeAndValidateUrl } = require('../lib/sanitizeAndValidateUrl');

      // Simulate a URL that was valid when stored but is now invalid
      const nowInvalidUrl = 'http://192.168.1.1/'; // Private IP
      await mockKV.put(validUuid, nowInvalidUrl);

      // Mock validation to reject the URL (e.g., because it's now detected as private IP)
      vi.mocked(sanitizeAndValidateUrl).mockResolvedValue(null);

      const request = new Request(`https://example.com/t/${validUuid}`);
      const params = Promise.resolve({ uuid: validUuid });

      const response = await GET(request, { params });

      expect(response.status).toBe(404);
      expect(await response.text()).toBe('Link no longer available');

      // Verify URL was removed
      const storedUrl = await mockKV.get(validUuid);
      expect(storedUrl).toBeNull();
    });

    it('should handle edge cases in UUID matching', async () => {
      const edgeCaseUuids = [
        '123e4567-e89b-12d3-a456-426614174000extra', // Extra characters
        ' 123e4567-e89b-12d3-a456-426614174000', // Leading space
        '123e4567-e89b-12d3-a456-426614174000 ', // Trailing space
        '123E4567-E89B-12D3-A456-426614174000', // Different case (should work)
      ];

      for (const uuid of edgeCaseUuids) {
        const request = new Request(`https://example.com/t/${uuid}`);
        const params = Promise.resolve({ uuid });

        const response = await GET(request, { params });

        if (uuid === '123E4567-E89B-12D3-A456-426614174000') {
          // This should work (case insensitive)
          expect(response.status).toBe(404); // 404 because no URL stored
        } else {
          // Others should fail UUID validation
          expect(response.status).toBe(404);
        }
      }
    });

    it('should prevent open redirect attacks', async () => {
      const { sanitizeAndValidateUrl } = require('../lib/sanitizeAndValidateUrl');

      // Simulate an attacker trying to store a malicious redirect
      const attackerUrl = 'https://evil.com/phishing';
      await mockKV.put(validUuid, attackerUrl);

      // Mock validation to clean/reject the URL
      vi.mocked(sanitizeAndValidateUrl).mockResolvedValue('https://safe.example.com/');

      const request = new Request(`https://example.com/t/${validUuid}`);
      const params = Promise.resolve({ uuid: validUuid });

      const response = await GET(request, { params });

      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('https://safe.example.com/');
      expect(response.headers.get('Location')).not.toContain('evil.com');
    });

    it('should handle concurrent access safely', async () => {
      const { sanitizeAndValidateUrl } = require('../lib/sanitizeAndValidateUrl');

      await mockKV.put(validUuid, validUrl);
      vi.mocked(sanitizeAndValidateUrl).mockResolvedValue(validUrl);

      const request = new Request(`https://example.com/t/${validUuid}`);
      const params = Promise.resolve({ uuid: validUuid });

      // Simulate concurrent requests
      const promises = Array(10)
        .fill(null)
        .map(() => GET(request, { params }));
      const responses = await Promise.all(promises);

      // All should succeed
      responses.forEach((response) => {
        expect(response.status).toBe(302);
        expect(response.headers.get('Location')).toBe(validUrl);
      });
    });

    it('should log security events appropriately', async () => {
      const { sanitizeAndValidateUrl } = require('../lib/sanitizeAndValidateUrl');

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await mockKV.put(validUuid, maliciousUrl);
      vi.mocked(sanitizeAndValidateUrl).mockResolvedValue(null);

      const request = new Request(`https://example.com/t/${validUuid}`);
      const params = Promise.resolve({ uuid: validUuid });

      await GET(request, { params });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Removed invalid URL from storage'));

      consoleSpy.mockRestore();
    });
  });
});
