import type { DiscoveredService, ServiceInfo } from '../types';

export class ClientFactory {
  // Pass a filter function so that the Factory does not depend strongly on Registry
  constructor(private filterServices: (criteria: Partial<ServiceInfo>) => DiscoveredService[]) {}

  createClient(criteria: string | Partial<ServiceInfo>, loadBalancer: 'first' | 'random' | 'round-robin' = 'round-robin') {
    let rrIndex = 0;
    
    return {
      get: async (path: string, options?: RequestInit) => this.fetchInternal(criteria, path, { ...options, method: 'GET' }, loadBalancer, () => rrIndex++),
      post: async (path: string, options?: RequestInit) => this.fetchInternal(criteria, path, { ...options, method: 'POST' }, loadBalancer, () => rrIndex++),
      put: async (path: string, options?: RequestInit) => this.fetchInternal(criteria, path, { ...options, method: 'PUT' }, loadBalancer, () => rrIndex++),
      delete: async (path: string, options?: RequestInit) => this.fetchInternal(criteria, path, { ...options, method: 'DELETE' }, loadBalancer, () => rrIndex++),
    };
  }

  private async fetchInternal(
    criteria: string | Partial<ServiceInfo>, 
    path: string, 
    options: RequestInit, 
    loadBalancer: 'first' | 'random' | 'round-robin',
    getRrIndex: () => number
  ) {
    let services: DiscoveredService[] = [];
    
    if (typeof criteria === 'string') {
      services = this.filterServices({ name: criteria });
      if (services.length === 0) {
        services = this.filterServices({ id: criteria });
      }
    } else {
      services = this.filterServices(criteria);
    }

    if (services.length === 0) {
      const name = typeof criteria === 'string' ? criteria : JSON.stringify(criteria);
      throw new Error(`Service ${name} not found`);
    }

    let target = services[0];
    
    if (services.length > 1) {
      if (loadBalancer === 'random') {
        target = services[Math.floor(Math.random() * services.length)];
      } else if (loadBalancer === 'round-robin') {
        target = services[getRrIndex() % services.length];
      }
    }

    if (!target) {
      const name = typeof criteria === 'string' ? criteria : JSON.stringify(criteria);
      throw new Error(`Service ${name} not found`);
    }

    const url = this.buildUrl(target, path);
    return fetch(url, options);
  }

  private buildUrl(service: DiscoveredService, path: string): string {
    // 1. Full Base URL (precedence)
    if (service.baseUrl) {
      // Avoid double slashes if path starts with /
      const base = service.baseUrl.endsWith('/') ? service.baseUrl.slice(0, -1) : service.baseUrl;
      const cleanPath = path.startsWith('/') ? path : `/${path}`;
      return `${base}${cleanPath}`;
    }

    // 2. Build from Host/IP and Port
    const schema = service.schema || 'http';
    const host = service.host || service.ip;
    const port = service.port;

    // Check for standard ports to omit them
    const isStandardPort = 
      (schema === 'http' && port === 80) || 
      (schema === 'https' && port === 443);

    const portSuffix = isStandardPort ? '' : `:${port}`;
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    
    return `${schema}://${host}${portSuffix}${cleanPath}`;
  }
}
