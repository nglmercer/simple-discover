import dgram from 'dgram';
import os from 'os';
import { EventEmitter } from 'events';
import type { Message, DiscoveryOptions, ServiceInfo } from '../types';
import { logger } from './debug';

export class Network extends EventEmitter {
  private socket: dgram.Socket | null = null;
  private senderSocket: dgram.Socket | null = null;
  private broadcastSocket: dgram.Socket | null = null;
  private options: Required<Pick<DiscoveryOptions, 
    'multicastAddress' | 'multicastInterface' | 'multicastPort' | 'broadcastPort' |
    'heartbeatInterval' | 'offlineTimeout' | 'setupHooks' | 'enableBroadcast' | 'enableIdentityEndpoint'
  >>;
  private serviceInfo: ServiceInfo;
  private port: number;

  constructor(serviceInfo: ServiceInfo, port: number, options: Network['options']) {
    super();
    this.serviceInfo = serviceInfo;
    this.port = port;
    this.options = options;
  }

  getLocalInterfaces(): { address: string; broadcastAddress: string; internal: boolean }[] {
    const interfaces = os.networkInterfaces();
    const result: { address: string; broadcastAddress: string; internal: boolean }[] = [];
    
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (!iface) continue;
      
      for (const config of iface) {
        if (config.family === 'IPv4') {
          // Calculate broadcast address from address and netmask
          const addrParts = config.address.split('.').map(Number);
          const maskParts = config.netmask.split('.').map(Number);
          const broadcastParts = addrParts.map((a, i) => (a | (~maskParts[i]! & 255)));
          const broadcastAddress = broadcastParts.join('.');
          
          result.push({
            address: config.address,
            broadcastAddress,
            internal: config.internal,
          });
        }
      }
    }
    
    return result.length > 0 ? result : [{ address: '127.0.0.1', broadcastAddress: '127.255.255.255', internal: true }];
  }

  private getLocalAddresses(): string[] {
    return this.getLocalInterfaces().map(i => i.address);
  }

  async start(): Promise<void> {
    const promises: Promise<void>[] = [];
    
    // Start multicast listener + sender
    if (this.options.multicastInterface) {
      promises.push(this.startMulticast(this.options.multicastInterface));
    } else {
      promises.push(this.startMulticast('0.0.0.0'));
    }

    // Start broadcast listener (separate socket) if enabled
    if (this.options.enableBroadcast) {
      promises.push(this.startBroadcast());
    }

    await Promise.all(promises);
  }

  private startMulticast(iface: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket) {
        try { this.socket.close(); } catch (e) {}
      }
      if (this.senderSocket) {
        try { this.senderSocket.close(); } catch (e) {}
      }
      
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.senderSocket = dgram.createSocket({ type: 'udp4' });
      
      let pendingBinds = 2;
      const checkDone = () => {
        pendingBinds--;
        if (pendingBinds === 0) {
          logger.log(`[Discovery] Multicast bound to ${iface}:${this.options.multicastPort}`);
          resolve();
        }
      };
      
      this.senderSocket.bind(0, () => {
        try {
          this.senderSocket!.setMulticastTTL(64);
          this.senderSocket!.setMulticastLoopback(true);
          this.senderSocket!.setBroadcast(true);
        } catch (e) {}
        checkDone();
      });

      this.socket.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });

      this.socket.on('message', (msg, rinfo) => {
        try {
          const data = JSON.parse(msg.toString()) as Message;
          this.emit('message', data, rinfo.address);
        } catch (e) {
          // Ignore invalid messages
        }
      });

      this.socket.bind(this.options.multicastPort, undefined, () => {
        if (!this.socket) return;
        
        try {
          this.socket.setBroadcast(true);
          this.socket.setMulticastTTL(64);
          this.socket.setMulticastLoopback(true);
          
          if (iface === '0.0.0.0') {
            const addresses = this.getLocalAddresses();
            for (const addr of addresses) {
              try {
                this.socket.addMembership(this.options.multicastAddress, addr);
                logger.log(`[Discovery] Added multicast membership on ${addr}`);
              } catch(e) {
                logger.log(`[Discovery] Failed to add multicast membership on ${addr}:`, e);
              }
            }
          } else {
            try {
              this.socket.addMembership(this.options.multicastAddress, iface);
            } catch(e) {
              logger.log(`[Discovery] Failed to add multicast membership on ${iface}:`, e);
            }
          }
          
          checkDone();
        } catch (e: any) {
          reject(e);
        }
      });
    });
  }

  private startBroadcast(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.broadcastSocket) {
        try { this.broadcastSocket.close(); } catch (e) {}
      }
      
      this.broadcastSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      
      this.broadcastSocket.on('error', (err) => {
        logger.log(`[Discovery] Broadcast socket error:`, err.message);
        // Non-fatal: broadcast is a fallback
        resolve();
      });

      this.broadcastSocket.on('message', (msg, rinfo) => {
        try {
          const data = JSON.parse(msg.toString()) as Message;
          this.emit('message', data, rinfo.address);
        } catch (e) {
          // Ignore invalid messages
        }
      });

      this.broadcastSocket.bind(this.options.broadcastPort, undefined, () => {
        if (!this.broadcastSocket) return;
        try {
          this.broadcastSocket.setBroadcast(true);
          logger.log(`[Discovery] Broadcast listener bound on port ${this.options.broadcastPort}`);
        } catch (e) {}
        resolve();
      });
    });
  }

  broadcastPresence(type: Message['type']): void {
    const message: Message = {
      type,
      service: {
        ...this.serviceInfo,
        id: this.serviceInfo.id!,
        port: this.port
      }
    };

    const buffer = Buffer.from(JSON.stringify(message));
    
    // --- Multicast send ---
    if (this.senderSocket) {
      if (this.options.multicastInterface) {
        try {
          this.senderSocket.setMulticastInterface(this.options.multicastInterface);
          this.senderSocket.send(buffer, 0, buffer.length, this.options.multicastPort, this.options.multicastAddress);
        } catch(e) {
          logger.log(`[Discovery] Multicast send error on ${this.options.multicastInterface}:`, e);
        }
      } else {
        const addresses = this.getLocalAddresses();
        const sendSequentially = (index: number) => {
          if (index >= addresses.length) return;
          const addr = addresses[index]!;
          try {
            this.senderSocket!.setMulticastInterface(addr);
            this.senderSocket!.send(buffer, 0, buffer.length, this.options.multicastPort, this.options.multicastAddress!, (err) => {
              if (err) logger.log(`[Discovery] Multicast send error on ${addr}:`, err.message);
              sendSequentially(index + 1);
            });
          } catch (e) {
            logger.log(`[Discovery] Failed to send multicast on ${addr}:`, e);
            sendSequentially(index + 1);
          }
        };
        sendSequentially(0);
      }
    }

    // --- Broadcast send (fallback) ---
    if (this.options.enableBroadcast && this.senderSocket) {
      const ifaces = this.getLocalInterfaces();
      for (const iface of ifaces) {
        if (iface.internal) continue; // Don't broadcast on loopback
        try {
          this.senderSocket.send(buffer, 0, buffer.length, this.options.broadcastPort, iface.broadcastAddress, (err) => {
            if (err) logger.log(`[Discovery] Broadcast send error to ${iface.broadcastAddress}:`, err.message);
          });
        } catch (e) {
          logger.log(`[Discovery] Broadcast send failed to ${iface.broadcastAddress}:`, e);
        }
      }
    }
  }

  stop(): void {
    if (this.socket) {
      try { this.socket.close(); } catch (e) {}
      this.socket = null;
    }
    if (this.senderSocket) {
      try { this.senderSocket.close(); } catch (e) {}
      this.senderSocket = null;
    }
    if (this.broadcastSocket) {
      try { this.broadcastSocket.close(); } catch (e) {}
      this.broadcastSocket = null;
    }
  }
}
