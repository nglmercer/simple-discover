import { EventEmitter } from 'events';
import type { DiscoveredService, ServiceInfo } from '../types';

export class Registry extends EventEmitter {
  private services: Map<string, DiscoveredService> = new Map();

  update(serviceId: string, discoveredService: DiscoveredService): void {
    const existing = this.services.get(serviceId);

    if (!existing) {
      this.services.set(serviceId, discoveredService);
      this.emit('online', discoveredService);
    } else {
      let changed = false;
      if (
        existing.ip !== discoveredService.ip ||
        existing.port !== discoveredService.port ||
        existing.version !== discoveredService.version
      ) {
        changed = true;
      }
      this.services.set(serviceId, discoveredService);
      if (changed) {
        this.emit('online', discoveredService);
      }
    }
  }

  remove(serviceId: string): void {
    const existing = this.services.get(serviceId);
    if (existing) {
      this.services.delete(serviceId);
      this.emit('offline', existing);
    }
  }

  get(serviceId: string): DiscoveredService | undefined {
    return this.services.get(serviceId);
  }

  getAll(): DiscoveredService[] {
    return Array.from(this.services.values());
  }

  checkOffline(timeoutMs: number): void {
    const now = Date.now();
    for (const [id, service] of this.services.entries()) {
      if (now - service.lastSeen > timeoutMs) {
        this.services.delete(id);
        this.emit('offline', service);
      }
    }
  }

  filter(criteria: Partial<ServiceInfo>): DiscoveredService[] {
    const results: DiscoveredService[] = [];
    for (const service of this.services.values()) {
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
}
