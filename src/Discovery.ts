import dgram from 'dgram';
import { EventEmitter } from 'events';
import type { 
  DiscoveryOptions, 
  ServiceInfo, 
  DiscoveredService, 
  Message 
} from './types';

export class Discovery extends EventEmitter {
  private serviceInfo: ServiceInfo;
  private port: number;
  private options: Required<DiscoveryOptions>;
  private socket: dgram.Socket | null = null;
  private registry: Map<string, DiscoveredService> = new Map();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private checkOfflineTimer: ReturnType<typeof setInterval> | null = null;
  private processHooksSet = false;
  private onProcessExit: () => void;

  constructor(serviceInfo: ServiceInfo, port: number, options: DiscoveryOptions = {}) {
    super();
    if (!serviceInfo.id) throw new Error('Service id is mandatory');
    
    this.serviceInfo = {
      id: serviceInfo.id,
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

    this.onProcessExit = () => {
      this.stop();
      process.exit();
    };
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      this.socket.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });

      this.socket.on('message', (msg, rinfo) => {
        try {
          const data = JSON.parse(msg.toString()) as Message;
          console.log(`[${this.serviceInfo.id}] Received ${data.type} from ${data.service.id}`);
          this.handleMessage(data, rinfo.address);
        } catch (e) {
          // Ignore invalid messages
        }
      });

      this.socket.bind(this.options.multicastPort, () => {
        if (!this.socket) return;
        this.socket.setBroadcast(true);
        this.socket.setMulticastTTL(128);
        this.socket.setMulticastLoopback(true);
        if (this.options.multicastInterface) {
          this.socket.addMembership(this.options.multicastAddress, this.options.multicastInterface);
        } else {
          this.socket.addMembership(this.options.multicastAddress);
        }
        
        this.broadcastPresence('hello');
        this.startTimers();
        if (this.options.setupHooks && !this.processHooksSet) {
          this.setupProcessHooks();
        }
        
        resolve();
      });
    });
  }

  private handleMessage(msg: Message, senderIp: string) {
    if (msg.service.id === this.serviceInfo.id) return;

    const now = Date.now();
    const existing = this.registry.get(msg.service.id);

    if (msg.type === 'goodbye') {
      if (existing) {
        this.registry.delete(msg.service.id);
        this.emit('offline', existing);
      }
      return;
    }

    const discoveredService: DiscoveredService = {
      ...msg.service,
      ip: senderIp,
      lastSeen: now,
    };

    if (!existing) {
      this.registry.set(msg.service.id, discoveredService);
      this.emit('online', discoveredService);
    } else {
      let changed = false;
      if (existing.ip !== senderIp || existing.port !== msg.service.port || existing.version !== msg.service.version) {
        changed = true;
      }
      this.registry.set(msg.service.id, discoveredService);
      if (changed) {
        this.emit('online', discoveredService);
      }
    }
  }

  private broadcastPresence(type: Message['type']) {
    if (!this.socket) return;

    const message: Message = {
      type,
      service: {
        ...this.serviceInfo,
        port: this.port
      }
    };

    const buffer = Buffer.from(JSON.stringify(message));
    this.socket.send(
      buffer,
      0,
      buffer.length,
      this.options.multicastPort,
      this.options.multicastAddress
    );
  }

  private startTimers() {
    this.heartbeatTimer = setInterval(() => {
      this.broadcastPresence('heartbeat');
    }, this.options.heartbeatInterval);

    this.checkOfflineTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, service] of this.registry.entries()) {
        if (now - service.lastSeen > this.options.offlineTimeout) {
          this.registry.delete(id);
          this.emit('offline', service);
        }
      }
    }, 1000);
  }

  filter(criteria: Partial<ServiceInfo>): DiscoveredService[] {
    const results: DiscoveredService[] = [];
    for (const service of this.registry.values()) {
      let match = true;
      if (criteria.id && criteria.id !== service.id) match = false;
      if (criteria.name && criteria.name !== service.name) match = false;
      if (criteria.version && criteria.version !== service.version) match = false;
      
      if (match) {
        results.push(service);
      }
    }
    return results;
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
    this.broadcastPresence('goodbye');
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.checkOfflineTimer) clearInterval(this.checkOfflineTimer);
    if (this.socket) {
      try {
        if (this.options.setupHooks) {
          this.removeProcessHooks();
        }
        this.socket.close();
      } catch (e) {}
      this.socket = null;
    }
  }

  createClient(nameOrId: string) {
    return {
      get: async (path: string, options?: RequestInit) => this.fetchInternal(nameOrId, path, { ...options, method: 'GET' }),
      post: async (path: string, options?: RequestInit) => this.fetchInternal(nameOrId, path, { ...options, method: 'POST' }),
      put: async (path: string, options?: RequestInit) => this.fetchInternal(nameOrId, path, { ...options, method: 'PUT' }),
      delete: async (path: string, options?: RequestInit) => this.fetchInternal(nameOrId, path, { ...options, method: 'DELETE' }),
    };
  }

  private async fetchInternal(nameOrId: string, path: string, options: RequestInit) {
    let services = this.filter({ name: nameOrId });
    if (services.length === 0) {
      services = this.filter({ id: nameOrId });
    }
    
    if (services.length === 0) {
      throw new Error(`Service ${nameOrId} not found`);
    }

    const target = services[0];
    if (!target) {
      throw new Error(`Service ${nameOrId} not found`);
    }
    const url = `${target.schema}://${target.ip}:${target.port}${path}`;
    return fetch(url, options);
  }
}
