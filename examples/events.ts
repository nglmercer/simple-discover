import { Discovery } from '../src';

/**
 * Example demonstrating event handling
 * 
 * This example shows how to:
 * - Handle online/offline events
 * - Handle error events
 * - Track service changes over time
 */

async function eventsExample() {
  console.log('=== Events Example ===\n');

  // Create a discovery instance
  const discovery = new Discovery(
    { id: 'monitor-1', name: 'monitor', version: '1.0.0' },
    9000
  );

  // Track all discovered services
  const knownServices = new Map<string, any>();

  // Online event - triggered when a new service is discovered
  discovery.on('online', (service) => {
    const key = service.id;
    const isNew = !knownServices.has(key);
    
    knownServices.set(key, service);
    
    if (isNew) {
      console.log(`✅ [Online] New service discovered: ${service.name} (${service.id})`);
      console.log(`   Version: ${service.version}`);
      console.log(`   Address: ${service.ip}:${service.port}`);
    } else {
      console.log(`🔄 [Online] Service info changed: ${service.name} (${service.id})`);
    }
    console.log('');
  });

  // Offline event - triggered when a service goes away
  discovery.on('offline', (service) => {
    console.log(`❌ [Offline] Service gone: ${service.name} (${service.id})`);
    knownServices.delete(service.id);
    console.log('');
  });

  // Error event - triggered on network errors
  discovery.on('error', (err) => {
    console.error(`⚠️  [Error] Discovery error: ${err.message}`);
  });

  await discovery.start();
  console.log('Monitor started. Waiting for services...\n');

  // Start a service after 1 second
  setTimeout(async () => {
    console.log('--- Starting auth service ---');
    const auth = new Discovery(
      { id: 'auth-1', name: 'auth', version: '1.0.0' },
      3000
    );
    await auth.start();

    // Stop it after 3 seconds
    setTimeout(() => {
      console.log('\n--- Stopping auth service ---');
      auth.stop();
    }, 3000);
  }, 1000);

  // Start another service after 2 seconds
  setTimeout(async () => {
    console.log('\n--- Starting users service ---');
    const users = new Discovery(
      { id: 'users-1', name: 'users', version: '1.0.0' },
      3001
    );
    await users.start();

    // Stop it after 3 seconds
    setTimeout(() => {
      console.log('\n--- Stopping users service ---');
      users.stop();
    }, 3000);
  }, 2000);

  // Print known services periodically
  const interval = setInterval(() => {
    console.log(`--- Known Services (${knownServices.size}) ---`);
    if (knownServices.size === 0) {
      console.log('  (none)');
    } else {
      knownServices.forEach((service) => {
        const timeSinceLastSeen = Date.now() - service.lastSeen;
        console.log(`  - ${service.name} (${service.id}): ${service.ip}:${service.port} [${timeSinceLastSeen}ms ago]`);
      });
    }
    console.log('');
  }, 1500);

  // Cleanup after 8 seconds
  setTimeout(() => {
    clearInterval(interval);
    console.log('\n--- Cleaning up ---');
    discovery.stop();
    console.log('Done!');
    process.exit(0);
  }, 8000);
}

eventsExample().catch(console.error);
