import { sanitizeUrl } from '@braintree/sanitize-url';
import { parse as parseDomain } from 'tldts';
import punycode from 'punycode/';
import path from 'path';
import net from 'net';
import dns from 'dns/promises';

interface SanitizeUrlOptions {
  allowedProtocols?: string[];
  allowedDomains?: string[];
  maxQueryParams?: number;
  removeSuspiciousParams?: boolean;
  blockPrivateIPs?: boolean;
}

function isPrivateIP(ip: string): boolean {
  if (net.isIPv4(ip)) {
    return (
      ip.startsWith('10.') ||
      ip.startsWith('127.') ||
      ip.startsWith('192.168.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip) ||
      ip.startsWith('169.254.')
    );
  }
  if (net.isIPv6(ip)) {
    return (
      ip === '::1' ||
      ip.startsWith('fc') || // unique local
      ip.startsWith('fd') || // unique local
      ip.startsWith('fe80') // link-local
    );
  }
  return false;
}

export async function sanitizeAndValidateUrl(
  input: string,
  {
    allowedProtocols = ['http', 'https'],
    allowedDomains = [],
    maxQueryParams = 3,
    removeSuspiciousParams = true,
    blockPrivateIPs = true,
  }: SanitizeUrlOptions = {},
): Promise<string | null> {
  try {
    // Step 1: Strip dangerous schemes
    const sanitized = sanitizeUrl(input.trim());
    if (sanitized === 'about:blank') return null;

    // Step 2: Force absolute URLs
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(sanitized)) return null;

    // Step 3: Parse URL
    const url = new URL(sanitized);

    // Step 4: Check protocol
    const protocol = url.protocol.replace(':', '').toLowerCase();
    if (!allowedProtocols.includes(protocol)) return null;

    // Step 5: Remove credentials
    if (url.username || url.password) {
      url.username = '';
      url.password = '';
    }

    // Step 6: Normalize and check domain
    const asciiHost = punycode.toASCII(url.hostname);
    const domainInfo = parseDomain(asciiHost);
    if (!domainInfo.domain) return null;
    if (allowedDomains.length > 0 && !allowedDomains.includes(domainInfo.domain)) {
      return null;
    }
    url.hostname = asciiHost;

    // Step 7: DNS resolution & private IP blocking
    if (blockPrivateIPs) {
      try {
        const addresses = await dns.lookup(asciiHost, { all: true });
        for (const addr of addresses) {
          if (isPrivateIP(addr.address)) {
            return null; // SSRF prevention
          }
        }
      } catch {
        return null; // DNS resolution failed
      }
    }

    // Step 8: Prevent IP tricks
    if (/^0x[0-9a-f]+$/i.test(asciiHost) || /^[0-9]+$/.test(asciiHost)) {
      return null;
    }

    // Step 9: Normalize and check path traversal
    const decodedPath = decodeURIComponent(url.pathname);
    const normalizedPath = path.posix.normalize(decodedPath);
    if (normalizedPath.includes('..')) return null;
    url.pathname = normalizedPath;

    // Step 10: Limit query parameters
    const params = Array.from(url.searchParams.keys());
    if (params.length > maxQueryParams) {
      const allowedKeys = params.slice(0, maxQueryParams);
      for (const key of params) {
        if (!allowedKeys.includes(key)) {
          url.searchParams.delete(key);
        }
      }
    }

    // Step 11: Remove suspicious query keys
    if (removeSuspiciousParams) {
      const suspiciousKeys = ['redirect', 'url', 'next'];
      for (const key of suspiciousKeys) {
        if (url.searchParams.has(key)) {
          url.searchParams.delete(key);
        }
      }
    }

    // Step 12: Remove fragments
    url.hash = '';

    return url.toString();
  } catch {
    return null;
  }
}
