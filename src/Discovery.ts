import { EventEmitter } from 'events';
import os from 'os';
import crypto from 'crypto';
import type { DiscoveryOptions, ServiceInfo, DiscoveredService, Message, ScanOptions, ScanResult } from './types';
import { Registry } from './modules/Registry';
import { Network } from './modules/Network';
import { ClientFactory } from './modules/ClientFactory';
import { NetworkScanner } from './modules/NetworkScanner';
import { IdentityServer } from './modules/IdentityServer';

function generateServiceId(name?: string): string {
  const random = crypto.randomBytes(4).toString('hex');
  const hostname = os.hostname().replace(/[^a-zA-Z0-9]/g, '-').substring(0, 8);
  const prefix = name ? `${name}-` : 'service';
  return `${prefix}-${hostname}-${random}`;
}

export class Discovery extends EventEmitter {
  private serviceInfo: ServiceInfo;
  private port: number;
  private options: Required<DiscoveryOptions>;
  
  private registry: Registry;
  private network: Network;
  private clientFactory: ClientFactory;
  private identityServer: IdentityServer | null = null;
  
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private checkOfflineTimer: ReturnType<typeof setInterval> | null = null;
  private processHooksSet = false;
  private onProcessExit: () => void;

  constructor(serviceInfo: ServiceInfo, port: number, options: DiscoveryOptions = {}) {
    super();
    
    const serviceId = serviceInfo.id || generateServiceId(serviceInfo.name);
    
    this.serviceInfo = {
      id: serviceId,
      name: serviceInfo.name,
      version: serviceInfo.version,
      schema: serviceInfo.schema || 'http'
    };
    this.port = port;
    
    this.options = {
      multicastAddress: options.multicastAddress || '239.255.255.250',
      multicastInterface: options.multicastInterface || '',
      multicastPort: options.multicastPort || 54321,
      broadcastPort: options.broadcastPort || 54322,
      heartbeatInterval: options.heartbeatInterval || 5000,
      offlineTimeout: options.offlineTimeout || 15000,
      setupHooks: options.setupHooks !== undefined ? options.setupHooks : true,
      enableBroadcast: options.enableBroadcast !== undefined ? options.enableBroadcast : true,
      enableIdentityEndpoint: options.enableIdentityEndpoint !== undefined ? options.enableIdentityEndpoint : true,
    };

    this.registry = new Registry();
    this.network = new Network(this.serviceInfo, this.port, this.options);
    this.clientFactory = new ClientFactory(this.filter.bind(this));

    this.onProcessExit = () => {
      this.stop();
      process.exit();
    };

    this.setupEvents();
  }

  private setupEvents() {
    this.registry.on('online', (service: DiscoveredService) => this.emit('online', service));
    this.registry.on('offline', (service: DiscoveredService) => this.emit('offline', service));

    this.network.on('error', (err: Error) => this.emit('error', err));
    this.network.on('message', (msg: Message, senderIp: string) => this.handleMessage(msg, senderIp));
  }

  async start(): Promise<void> {
    await this.network.start();
    
    // Start the identity HTTP endpoint if enabled and port > 0
    if (this.options.enableIdentityEndpoint && this.port > 0) {
      this.identityServer = new IdentityServer(this.serviceInfo, this.port);
      // Try to start standalone; if port is in use (e.g. your app is already on it), 
      // this will silently skip. Use middleware() instead in that case.
      await this.identityServer.startStandalone();
    }
    
    this.network.broadcastPresence('hello');
    this.startTimers();
    if (this.options.setupHooks && !this.processHooksSet) {
      this.setupProcessHooks();
    }
  }

  private handleMessage(msg: Message, senderIp: string) {
    if (!msg || !msg.service) return;
    if (msg.service.id === this.serviceInfo.id) return;
    
    if (msg.type === 'goodbye') {
      this.registry.remove(msg.service.id);
      return;
    }

    const discoveredService: DiscoveredService = {
      ...msg.service,
      ip: senderIp,
      lastSeen: Date.now(),
    };

    this.registry.update(msg.service.id, discoveredService);

    if (msg.type === 'hello') {
      this.network.broadcastPresence('heartbeat');
    }
  }

  private startTimers() {
    this.heartbeatTimer = setInterval(() => {
      this.network.broadcastPresence('heartbeat');
    }, this.options.heartbeatInterval);

    this.checkOfflineTimer = setInterval(() => {
      this.registry.checkOffline(this.options.offlineTimeout);
    }, 1000);
  }

  // ─── Scanning API ─────────────────────────────────────────────

  /**
   * Actively scan the local network for services.
   * Uses TCP connect probing + HTTP identity detection.
   * 
   * Results are automatically registered in the internal registry.
   * 
   * @example
   * const results = await discovery.scan({ ports: [3000, 3001, 8080] });
   * results.forEach(r => console.log(`${r.ip}:${r.port} → ${r.service?.name}`));
   */
  async scan(options: ScanOptions = {}): Promise<ScanResult[]> {
    const results = await NetworkScanner.scan(options);
    
    const registerResults = options.registerResults !== false;
    if (registerResults) {
      for (const result of results) {
        if (result.service) {
          this.registry.update(result.service.id!, result.service);
        } else {
          // Register unidentified open ports too
          const service: DiscoveredService = {
            id: `scan-${result.ip}-${result.port}`,
            name: 'unknown',
            ip: result.ip,
            port: result.port,
            schema: 'http',
            lastSeen: Date.now(),
          };
          this.registry.update(service.id!, service);
        }
      }
    }
    
    return results;
  }

  // ─── Existing API ─────────────────────────────────────────────

  filter(criteria: Partial<ServiceInfo>): DiscoveredService[] {
    return this.registry.filter(criteria);
  }

  private setupProcessHooks() {
    process.on('SIGINT', this.onProcessExit);
    process.on('SIGTERM', this.onProcessExit);
    this.processHooksSet = true;
  }

  private removeProcessHooks() {
    if (this.processHooksSet) {
      process.removeListener('SIGINT', this.onProcessExit);
      process.removeListener('SIGTERM', this.onProcessExit);
      this.processHooksSet = false;
    }
  }

  stop() {
    this.network.broadcastPresence('goodbye');
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.checkOfflineTimer) clearInterval(this.checkOfflineTimer);
    
    if (this.options.setupHooks) {
      this.removeProcessHooks();
    }
    
    this.network.stop();
    
    if (this.identityServer) {
      this.identityServer.stop();
      this.identityServer = null;
    }
  }

  createClient(criteria: string | Partial<ServiceInfo>, loadBalancer?: 'first' | 'random' | 'round-robin') {
    return this.clientFactory.createClient(criteria, loadBalancer);
  }

  /**
   * Get the identity server instance for middleware integration.
   * Use this with Express/Hono/etc:
   * 
   * @example
   * const app = express();
   * app.use(discovery.getIdentityMiddleware());
   */
  getIdentityMiddleware() {
    if (!this.identityServer) {
      this.identityServer = new IdentityServer(this.serviceInfo, this.port);
    }
    return this.identityServer.middleware();
  }

  // Getters for testing
  getInternalRegistry() {
    return this.registry;
  }

  getServiceId(): string {
    return this.serviceInfo.id as string;
  }
}