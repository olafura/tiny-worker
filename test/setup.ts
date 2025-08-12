import { vi } from 'vitest';

// Simple MockKV implementation for testing
class MockKV {
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

  async list() {
    return { keys: Array.from(this.store.keys()).map((name) => ({ name })) };
  }
}

// Mock only the Cloudflare context getter with a fresh KV for each test
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: vi.fn().mockResolvedValue({
    env: {
      TINY_URL: new MockKV(),
    },
  }),
}));
