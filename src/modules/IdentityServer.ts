import http from 'http';
import type { ServiceInfo } from '../types';
import { IDENTITY_PATH } from './NetworkScanner';
import { logger } from './debug';

/**
 * IdentityServer: A tiny HTTP server that exposes a well-known endpoint
 * for active network scanners to identify this service.
 * 
 * GET /.well-known/discover → returns JSON with service info
 * 
 * This can either:
 * 1. Run standalone on a separate port (if no existing HTTP server)
 * 2. Be used as middleware for Express/Koa/Hono/etc.
 */
export class IdentityServer {
  private server: http.Server | null = null;
  private serviceInfo: ServiceInfo;
  private port: number;
  private meta: Record<string, any>;

  constructor(serviceInfo: ServiceInfo, port: number, meta: Record<string, any> = {}) {
    this.serviceInfo = serviceInfo;
    this.port = port;
    this.meta = meta;
  }

  /**
   * Returns the identity payload for this service.
   */
  getIdentity(): Record<string, any> {
    return {
      id: this.serviceInfo.id,
      name: this.serviceInfo.name,
      version: this.serviceInfo.version,
      schema: this.serviceInfo.schema || 'http',
      port: this.port,
      ...this.meta,
    };
  }

  /**
   * Returns a request handler function compatible with Node's http module.
   * Can also be used as Express/Connect middleware.
   */
  middleware() {
    return (req: http.IncomingMessage, res: http.ServerResponse, next?: () => void) => {
      if (req.url === IDENTITY_PATH && req.method === 'GET') {
        const body = JSON.stringify(this.getIdentity());
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Access-Control-Allow-Origin': '*',
        });
        res.end(body);
        return;
      }
      if (next) next();
    };
  }

  /**
   * Start a standalone identity HTTP server on the service's port.
   * Only use this if you don't have an existing HTTP server.
   * The server will ONLY respond to /.well-known/discover.
   */
  async startStandalone(listenPort?: number): Promise<void> {
    const port = listenPort || this.port;
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        if (req.url === IDENTITY_PATH && req.method === 'GET') {
          const body = JSON.stringify(this.getIdentity());
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'Access-Control-Allow-Origin': '*',
          });
          res.end(body);
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
        }
      });

      this.server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          logger.log(`[Identity] Port ${port} already in use, identity endpoint not started`);
          // Non-fatal: the main app is probably using this port
          resolve();
        } else {
          reject(err);
        }
      });

      this.server.listen(port, '0.0.0.0', () => {
        logger.log(`[Identity] Listening on http://0.0.0.0:${port}${IDENTITY_PATH}`);
        resolve();
      });
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
