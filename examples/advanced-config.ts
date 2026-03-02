import { Discovery } from '../src';

/**
 * Example demonstrating advanced configuration options
 * 
 * This example shows how to:
 * - Configure custom multicast address and port
 * - Adjust heartbeat interval
 * - Configure offline timeout
 * - Disable automatic process hooks
 */

async function advancedConfigExample() {
  console.log('=== Advanced Configuration Example ===\n');

  // Custom configuration example
  const customDiscovery = new Discovery(
    { id: 'custom-service', name: 'custom', version: '1.0.0' },
    5000,
    {
      // Use default multicast address (can be customized for different networks)
      multicastAddress: '239.255.255.250',
      
      // Multicast port for discovery messages
      multicastPort: 54321,
      
      // Heartbeat interval - how often to broadcast presence (in ms)
      // Lower values = faster discovery but more network traffic
      heartbeatInterval: 2000,
      
      // Offline timeout - how long to wait before marking a service as offline
      // Should be at least 3x the heartbeat interval
      offlineTimeout: 8000,
      
      // Disable automatic SIGINT/SIGTERM handlers
      // Set to false if you want to handle cleanup manually
      setupHooks: false
    }
  );

  // Custom multicast address (for isolated network segments)
  const isolatedDiscovery = new Discovery(
    { id: 'isolated-service', name: 'isolated', version: '1.0.0' },
    5001,
    {
      multicastAddress: '239.255.255.251', // Different multicast group
      multicastPort: 54322,
      heartbeatInterval: 10000,
      offlineTimeout: 35000
    }
  );

  // Event listeners
  customDiscovery.on('online', (service) => {
    console.log(`[Custom] Online: ${service.name} (${service.id})`);
  });

  customDiscovery.on('offline', (service) => {
    console.log(`[Custom] Offline: ${service.name} (${service.id})`);
  });

  customDiscovery.on('error', (err) => {
    console.error('[Custom] Error:', err.message);
  });

  isolatedDiscovery.on('online', (service) => {
    console.log(`[Isolated] Online: ${service.name} (${service.id})`);
  });

  // Start services
  console.log('Starting custom discovery (heartbeat: 2s, offline timeout: 8s)...');
  await customDiscovery.start();

  console.log('Starting isolated discovery (heartbeat: 10s, offline timeout: 35s)...');
  await isolatedDiscovery.start();

  // Start another service to discover
  const targetService = new Discovery(
    { id: 'target-1', name: 'target', version: '2.0.0' },
    4000,
    {
      // Use same config as customDiscovery to be discoverable
      heartbeatInterval: 2000,
      offlineTimeout: 8000
    }
  );

  targetService.on('online', (service) => {
    console.log(`[Target] Discovered: ${service.name}`);
  });

  await targetService.start();

  // Wait for discovery
  await new Promise(r => setTimeout(r, 3000));

  console.log('\n--- Current Discovered Services (Custom Discovery) ---');
  const discovered = customDiscovery.filter({});
  discovered.forEach(s => {
    console.log(`  ${s.name} (${s.id}) v${s.version} at ${s.ip}:${s.port}`);
    console.log(`    Last seen: ${Date.now() - s.lastSeen}ms ago`);
  });

  // Note: isolatedDiscovery won't find targetService because they use different multicast groups

  // Manual cleanup (since setupHooks is false)
  console.log('\nManual cleanup...');
  customDiscovery.stop();
  isolatedDiscovery.stop();
  targetService.stop();

  console.log('Done!');
  process.exit(0);
}

advancedConfigExample().catch(console.error);
