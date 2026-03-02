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
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      this.socket.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });

      this.socket.on('message', (msg, rinfo) => {
        try {
          const data = JSON.parse(msg.toString()) as Message;
          // emit valid message
          this.emit('message', data, rinfo.address);
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
          this.socket.setMulticastInterface(this.options.multicastInterface);
        } else {
          this.socket.addMembership(this.options.multicastAddress);
        }

        resolve();
      });
    });
  }

  broadcastPresence(type: Message['type']): void {
    if (!this.socket) return;

    const message: Message = {
      type,
      service: {
        ...this.serviceInfo,
        id: this.serviceInfo.id!, // ID is always set after constructor processes it
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

  stop(): void {
    if (this.socket) {
      try {
        this.socket.close();
      } catch (e) {}
      this.socket = null;
    }
  }
}
