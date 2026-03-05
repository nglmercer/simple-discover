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
    const url = `${target.schema}://${target.ip}:${target.port}${path}`;
    return fetch(url, options);
  }
}
