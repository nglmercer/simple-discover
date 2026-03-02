import type { DiscoveredService, ServiceInfo } from '../types';

export class ClientFactory {
  // Pass a filter function so that the Factory does not depend strongly on Registry
  constructor(private filterServices: (criteria: Partial<ServiceInfo>) => DiscoveredService[]) {}

  createClient(nameOrId: string) {
    return {
      get: async (path: string, options?: RequestInit) => this.fetchInternal(nameOrId, path, { ...options, method: 'GET' }),
      post: async (path: string, options?: RequestInit) => this.fetchInternal(nameOrId, path, { ...options, method: 'POST' }),
      put: async (path: string, options?: RequestInit) => this.fetchInternal(nameOrId, path, { ...options, method: 'PUT' }),
      delete: async (path: string, options?: RequestInit) => this.fetchInternal(nameOrId, path, { ...options, method: 'DELETE' }),
    };
  }

  private async fetchInternal(nameOrId: string, path: string, options: RequestInit) {
    let services = this.filterServices({ name: nameOrId });
    if (services.length === 0) {
      services = this.filterServices({ id: nameOrId });
    }

    if (services.length === 0) {
      throw new Error(`Service ${nameOrId} not found`);
    }

    // simplistic load balancing (could pick random or round robin)
    const target = services[0];
    if (!target) {
      throw new Error(`Service ${nameOrId} not found`);
    }
    const url = `${target.schema}://${target.ip}:${target.port}${path}`;
    return fetch(url, options);
  }
}
