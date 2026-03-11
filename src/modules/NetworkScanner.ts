import net from 'net';
import os from 'os';
import type { ScanOptions, ScanResult, DiscoveredService } from '../types';
import { logger } from './debug';

/** Well-known identity endpoint path */
export const IDENTITY_PATH = '/.well-known/discover';

/**
 * NetworkScanner: Active LAN scanning with TCP connect + HTTP identity probing.
 * 
 * Strategy:
 * 1. Fast TCP SYN-like connect to detect open ports
 * 2. HTTP probe to /.well-known/discover for identity
 * 3. Fallback: probe root / for JSON or HTML title
 */
export class NetworkScanner {

  /**
   * Detect the local subnet(s) automatically.
   */
  static getLocalSubnets(): string[] {
    const interfaces = os.networkInterfaces();
    const subnets: string[] = [];

    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (!iface) continue;
      for (const config of iface) {
        if (config.family === 'IPv4' && !config.internal) {
          // Calculate network address from IP and netmask
          const addrParts = config.address.split('.').map(Number);
          const maskParts = config.netmask.split('.').map(Number);
          const networkParts = addrParts.map((a, i) => a & maskParts[i]!);
          
          // Calculate prefix length from netmask
          const prefixLen = maskParts.reduce((sum, octet) => {
            let bits = 0;
            let val = octet;
            while (val > 0) { bits += val & 1; val >>= 1; }
            return sum + bits;
          }, 0);
          
          subnets.push(`${networkParts.join('.')}/${prefixLen}`);
        }
      }
    }

    return subnets.length > 0 ? subnets : ['127.0.0.0/8'];
  }

  /**
   * Parse a CIDR subnet into an array of IPs.
   * Supports /24, /16, etc. Caps at 254 hosts for safety.
   */
  static parseSubnet(cidr: string): string[] {
    const [network, prefixStr] = cidr.split('/');
    if (!network || !prefixStr) return [];
    const prefix = parseInt(prefixStr, 10);
    
    const parts = network.split('.').map(Number);
    if (parts.length !== 4) return [];
    
    const networkNum = ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
    const hostBits = 32 - prefix;
    const numHosts = Math.min((1 << hostBits) - 2, 254); // Skip network and broadcast, cap at 254
    
    const ips: string[] = [];
    for (let i = 1; i <= numHosts; i++) {
      const ip = networkNum + i;
      ips.push(`${(ip >>> 24) & 255}.${(ip >>> 16) & 255}.${(ip >>> 8) & 255}.${ip & 255}`);
    }
    return ips;
  }

  /**
   * Fast TCP connect check. Returns true if port is open.
   */
  static tcpConnect(ip: string, port: number, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let resolved = false;

      const done = (result: boolean) => {
        if (resolved) return;
        resolved = true;
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(timeoutMs);
      socket.on('connect', () => done(true));
      socket.on('timeout', () => done(false));
      socket.on('error', () => done(false));
      
      try {
        socket.connect(port, ip);
      } catch {
        done(false);
      }
    });
  }

  /**
   * HTTP identity probe. Tries /.well-known/discover first, then falls back to /.
   */
  static async httpProbe(ip: string, port: number, timeoutMs: number): Promise<ScanResult> {
    const baseResult: ScanResult = { ip, port, identified: false };

    // Phase 1: Try the well-known identity endpoint
    try {
      const res = await fetch(`http://${ip}:${port}${IDENTITY_PATH}`, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'Accept': 'application/json' },
      });

      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const info = await res.json() as any;
          if (info.name || info.id) {
            const service: DiscoveredService = {
              id: info.id || `discovered-${ip}-${port}`,
              name: info.name || 'unknown',
              version: info.version || 'unknown',
              schema: info.schema || 'http',
              host: info.host,
              baseUrl: info.baseUrl,
              ip,
              port: info.port || port,
              lastSeen: Date.now(),
            };
            return { ip, port, identified: true, service };
          }
        }
      }
    } catch {
      // Identity endpoint not available, try fallback
    }

    // Phase 2: Fallback - probe the root URL
    try {
      const res = await fetch(`http://${ip}:${port}/`, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'Accept': 'application/json, text/html' },
      });

      const contentType = res.headers.get('content-type') || '';

      if (contentType.includes('application/json')) {
        const info = await res.json() as any;
        const name = info.name || info.service || info.appName || info.app;
        if (name) {
          const service: DiscoveredService = {
            id: info.id || `discovered-${ip}-${port}`,
            name,
            version: info.version || 'unknown',
            schema: 'http',
            ip,
            port,
            lastSeen: Date.now(),
          };
          return { ip, port, identified: true, service };
        }
        return { ...baseResult, responseInfo: { statusCode: res.status, contentType } };
      }

      if (contentType.includes('text/html')) {
        const html = await res.text();
        const titleMatch = html.match(/<title>(.*?)<\/title>/i);
        const rawTitle = titleMatch?.[1] || '';
        if (rawTitle) {
          const service: DiscoveredService = {
            id: `web-${ip}-${port}`,
            name: rawTitle.toLowerCase().replace(/\s+/g, '-').substring(0, 50),
            version: 'web',
            schema: 'http',
            ip,
            port,
            lastSeen: Date.now(),
          };
          return { ip, port, identified: true, service, responseInfo: { title: rawTitle } };
        }
        return { ...baseResult, responseInfo: { statusCode: res.status, contentType, title: rawTitle || undefined } };
      }

      return { ...baseResult, responseInfo: { statusCode: res.status, contentType } };
    } catch {
      // HTTP probe also failed; port is open but no HTTP
      return baseResult;
    }
  }

  /**
   * Scan a network for services.
   * 
   * Uses a two-phase approach:
   * 1. Fast TCP connect to find open ports
   * 2. HTTP identity probe on open ports only
   * 
   * This is MUCH faster than the naive approach of HTTP-probing every IP.
   */
  static async scan(options: ScanOptions = {}): Promise<ScanResult[]> {
    const {
      ports = [3000, 3001, 8080, 8000, 5000],
      connectTimeout = 500,
      probeTimeout = 2000,
      concurrency = 100,
      registerResults = true,
    } = options;

    // Determine subnet(s)
    let subnets: string[];
    if (options.subnet) {
      subnets = [options.subnet];
    } else {
      subnets = NetworkScanner.getLocalSubnets();
    }

    // Generate all IP+port targets
    const targets: { ip: string; port: number }[] = [];
    for (const subnet of subnets) {
      const ips = NetworkScanner.parseSubnet(subnet);
      for (const ip of ips) {
        for (const port of ports) {
          targets.push({ ip, port });
        }
      }
    }

    logger.log(`[Scanner] Scanning ${targets.length} targets across ${subnets.join(', ')}...`);

    // Phase 1: Fast TCP connect scan with concurrency control
    const openPorts: { ip: string; port: number }[] = [];
    
    for (let i = 0; i < targets.length; i += concurrency) {
      const batch = targets.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map(async ({ ip, port }) => {
          const isOpen = await NetworkScanner.tcpConnect(ip, port, connectTimeout);
          return { ip, port, isOpen };
        })
      );
      
      for (const r of results) {
        if (r.isOpen) {
          openPorts.push({ ip: r.ip, port: r.port });
          logger.log(`[Scanner] Open port found: ${r.ip}:${r.port}`);
        }
      }
    }

    logger.log(`[Scanner] Phase 1 complete: ${openPorts.length} open ports found`);

    if (openPorts.length === 0) return [];

    // Phase 2: HTTP identity probe on open ports (much fewer targets)
    const scanResults: ScanResult[] = [];
    
    for (let i = 0; i < openPorts.length; i += concurrency) {
      const batch = openPorts.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map(({ ip, port }) => NetworkScanner.httpProbe(ip, port, probeTimeout))
      );
      scanResults.push(...results);
    }

    logger.log(`[Scanner] Phase 2 complete: ${scanResults.filter(r => r.identified).length} identified services`);

    return scanResults;
  }
}
