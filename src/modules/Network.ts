import dgram from 'dgram';
import { EventEmitter } from 'events';
import type { Message, DiscoveryOptions, ServiceInfo } from '../types';

export class Network extends EventEmitter {
  private socket: dgram.Socket | null = null;
  private options: Required<DiscoveryOptions>;
  private serviceInfo: ServiceInfo;
  private port: number;

  constructor(serviceInfo: ServiceInfo, port: number, options: Required<DiscoveryOptions>) {
    super();
    this.serviceInfo = serviceInfo;
    this.port = port;
    this.options = options;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      // reuseAddr is critical for multiple services on same port
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      this.socket.on('error', (err) => {
        console.error(`[${this.serviceInfo.id}] Socket error:`, err);
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

      this.socket.on('listening', () => {
        const address = this.socket!.address();
        console.log(`[${this.serviceInfo.id}] Socket listening on ${address.address}:${address.port}`);
      });

      // Bind to 0.0.0.0 to receive multicast from any interface
      this.socket.bind(this.options.multicastPort, () => {
        if (!this.socket) return;
        
        try {
          this.socket.setBroadcast(true);
          this.socket.setMulticastTTL(128);
          this.socket.setMulticastLoopback(true);
          
          if (this.options.multicastInterface) {
            this.socket.addMembership(this.options.multicastAddress, this.options.multicastInterface);
            this.socket.setMulticastInterface(this.options.multicastInterface);
          } else {
            this.socket.addMembership(this.options.multicastAddress);
          }
          
          console.log(`[${this.serviceInfo.id}] Joined multicast group ${this.options.multicastAddress}:${this.options.multicastPort}`);
          resolve();
        } catch (e: any) {
          console.error(`[${this.serviceInfo.id}] Failed to setup multicast:`, e.message);
          reject(e);
        }
      });
    });
  }

  broadcastPresence(type: Message['type']): void {
    if (!this.socket) return;

    const message: Message = {
      type,
      service: {
        ...this.serviceInfo,
        id: this.serviceInfo.id!,
        port: this.port
      }
    };

    const buffer = Buffer.from(JSON.stringify(message));
    
    // Send to the multicast address and port
    this.socket.send(
      buffer,
      0,
      buffer.length,
      this.options.multicastPort,
      this.options.multicastAddress
    );
  }

  stop(): void {
    if (this.socket) {
      try {
        this.socket.close();
      } catch (e) {}
      this.socket = null;
    }
  }
}
