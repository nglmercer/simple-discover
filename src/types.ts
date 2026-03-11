export interface ServiceInfo {
  id?: string;
  name?: string;
  version?: string;
  schema?: string;
  /** Custom hostname or domain (overrides IP in URLs) */
  host?: string;
  /** Full base URL (overrides all URL generation logic) */
  baseUrl?: string;
}

export interface DiscoveredService extends ServiceInfo {
  ip: string;
  port: number;
  lastSeen: number;
}

export interface DiscoveryOptions {
  multicastAddress?: string;
  multicastInterface?: string;
  multicastPort?: number;
  broadcastPort?: number;
  heartbeatInterval?: number;
  offlineTimeout?: number;
  setupHooks?: boolean;
  /** Enable UDP broadcast as a fallback in addition to multicast. Default: true */
  enableBroadcast?: boolean;
  /** Enable the built-in identity endpoint (GET /.well-known/discover). Default: true */
  enableIdentityEndpoint?: boolean;
}

export interface ScanOptions {
  /** Subnet to scan, e.g. '192.168.1.0/24'. Auto-detected if omitted. */
  subnet?: string;
  /** Ports to scan for services. Default: [3000, 3001, 8080, 8000, 5000] */
  ports?: number[];
  /** TCP connect timeout in ms. Default: 500 */
  connectTimeout?: number;
  /** HTTP identity probe timeout in ms. Default: 2000 */
  probeTimeout?: number;
  /** Max concurrent connections during scan. Default: 100 */
  concurrency?: number;
  /** If true, register found services into the Discovery registry. Default: true */
  registerResults?: boolean;
}

export interface ScanResult {
  ip: string;
  port: number;
  /** Whether an identity endpoint was found */
  identified: boolean;
  service?: DiscoveredService;
  /** Raw response info for unidentified services */
  responseInfo?: {
    statusCode?: number;
    contentType?: string;
    title?: string;
  };
}

export interface Message {
  type: 'hello' | 'heartbeat' | 'goodbye';
  service: ServiceInfo & { id: string; port: number };
}
