import dgram from 'dgram';
import os from 'os';
import { EventEmitter } from 'events';
import type { Message, DiscoveryOptions, ServiceInfo } from '../types';
import { logger } from './debug';
export class Network extends EventEmitter {
  private socket: dgram.Socket | null = null;
  private senderSocket: dgram.Socket | null = null;
  private options: Required<DiscoveryOptions>;
  private serviceInfo: ServiceInfo;
  private port: number;

  constructor(serviceInfo: ServiceInfo, port: number, options: Required<DiscoveryOptions>) {
    super();
    this.serviceInfo = serviceInfo;
    this.port = port;
    this.options = options;
  }

  private getLocalInterfaces(): string[] {
    const interfaces = os.networkInterfaces();
    const internalAddresses: string[] = [];
    const externalAddresses: string[] = [];
    
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (!iface) continue;
      
      for (const config of iface) {
        if (config.family === 'IPv4') {
          if (config.internal) {
            internalAddresses.push(config.address);
          } else {
            externalAddresses.push(config.address);
          }
        }
      }
    }
    
    // Return ALL available interfaces so we can add membership to all of them
    const allAddresses = [...externalAddresses, ...internalAddresses];
    return allAddresses.length > 0 ? allAddresses : ['127.0.0.1'];
  }

  async start(): Promise<void> {
    // If multicastInterface is specified, use it directly
    if (this.options.multicastInterface) {
      return this.startWithInterface(this.options.multicastInterface);
    }
    
    // Without a specific interface, bind to 0.0.0.0 so we can receive multicast
    // packets correctly on all interfaces (Standard behavior for Linux/macOS).
    return this.startWithInterface('0.0.0.0');
  }

  private startWithInterface(iface: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Close existing socket if any
      if (this.socket) {
        try { this.socket.close(); } catch (e) {}
      }
      if (this.senderSocket) {
        try { this.senderSocket.close(); } catch (e) {}
      }
      
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.senderSocket = dgram.createSocket({ type: 'udp4' });
      
      let pendingBinds = 2; // Needs to bind both sockets
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

      // Always bind to undefined (0.0.0.0) to allow receiving multicast packets
      // The interface separation is handled by addMembership below.
      this.socket.bind(this.options.multicastPort, undefined, () => {
        if (!this.socket) return;
        
        try {
          this.socket.setBroadcast(true);
          this.socket.setMulticastTTL(64);
          this.socket.setMulticastLoopback(true);
          
          // For 0.0.0.0, we need to add membership to all interfaces
          if (iface === '0.0.0.0') {
            const addresses = this.getLocalInterfaces();
            for (const addr of addresses) {
              try {
                this.socket.addMembership(this.options.multicastAddress, addr);
              } catch(e) {}
            }
          } else {
            try {
              // Add membership to the explicitly requested interface
              this.socket.addMembership(this.options.multicastAddress, iface);
            } catch(e) {}
          }
          
          checkDone();
        } catch (e: any) {
          reject(e);
        }
      });
    });
  }

  broadcastPresence(type: Message['type']): void {
    if (!this.senderSocket) return;

    const message: Message = {
      type,
      service: {
        ...this.serviceInfo,
        id: this.serviceInfo.id!,
        port: this.port
      }
    };

    const buffer = Buffer.from(JSON.stringify(message));
    
    // If we have a specific multicast interface, use it
    if (this.options.multicastInterface) {
        try {
            this.senderSocket.setMulticastInterface(this.options.multicastInterface);
            this.senderSocket.send(buffer, 0, buffer.length, this.options.multicastPort, this.options.multicastAddress);
        } catch(e) {
            logger.log(`[Discovery] Failed to broadcast on specific interface ${this.options.multicastInterface}:`, e);
        }
        return;
    }
    
    // Otherwise, send over all valid interfaces sequentially to avoid async races
    const addresses = this.getLocalInterfaces();
    const sendSequentially = (index: number) => {
        if (index >= addresses.length) return;
        const addr = addresses[index];
        try {
            this.senderSocket!.setMulticastInterface(addr!);
            this.senderSocket!.send(buffer, 0, buffer.length, this.options.multicastPort, this.options.multicastAddress!, (err) => {
                if (err) logger.log(`[Discovery] Broadcast error on ${addr}:`, err);
                sendSequentially(index + 1);
            });
        } catch (e) {
            logger.log(`[Discovery] Failed to broadcast on ${addr}:`, e);
            sendSequentially(index + 1);
        }
    };
    sendSequentially(0);
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
  }
}
