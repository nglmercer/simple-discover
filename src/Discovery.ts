import { EventEmitter } from 'events';
import os from 'os';
import crypto from 'crypto';
import type { DiscoveryOptions, ServiceInfo, DiscoveredService, Message } from './types';
import { Registry } from './modules/Registry';
import { Network } from './modules/Network';
import { ClientFactory } from './modules/ClientFactory';

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
  
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private checkOfflineTimer: ReturnType<typeof setInterval> | null = null;
  private processHooksSet = false;
  private onProcessExit: () => void;

  constructor(serviceInfo: ServiceInfo, port: number, options: DiscoveryOptions = {}) {
    super();
    
    // Auto-generate ID if not provided
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
      heartbeatInterval: options.heartbeatInterval || 5000,
      offlineTimeout: options.offlineTimeout || 15000,
      setupHooks: options.setupHooks !== undefined ? options.setupHooks : true
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
    
    this.network.broadcastPresence('hello');
    this.startTimers();
    if (this.options.setupHooks && !this.processHooksSet) {
      this.setupProcessHooks();
    }
  }

  private handleMessage(msg: Message, senderIp: string) {
    if (!msg || !msg.service) return;
    if (msg.service.id === this.serviceInfo.id) return;
    
    // console.log(`[${this.serviceInfo.id}] Receive ${msg.type} from ${msg.service.id}`);
    
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

    // Speed up discovery: if someone says hello, tell them where we are
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
  }

  createClient(nameOrId: string) {
    return this.clientFactory.createClient(nameOrId);
  }

  // Getters for testing
  getInternalRegistry() {
    return this.registry;
  }

  getServiceId(): string {
    return this.serviceInfo.id as string;
  }
}