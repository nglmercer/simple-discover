import { Discovery } from '../src';

/**
 * Example demonstrating service filtering capabilities
 * 
 * This example shows how to filter discovered services by:
 * - Service name
 * - Service ID
 * - Version
 * - Multiple criteria
 */

async function filteringExample() {
  console.log('=== Service Filtering Example ===\n');

  // Start a gateway service that will discover others
  const gateway = new Discovery(
    { id: 'gateway-1', name: 'gateway', version: '1.0.0' },
    8080
  );

  // Start multiple backend services
  const authService = new Discovery(
    { id: 'auth-1', name: 'auth', version: '1.0.0' },
    3000
  );

  const usersService = new Discovery(
    { id: 'users-1', name: 'users', version: '1.0.0' },
    3001
  );

  const usersServiceV2 = new Discovery(
    { id: 'users-2', name: 'users', version: '2.0.0' },
    3002
  );

  const paymentsService = new Discovery(
    { id: 'payments-1', name: 'payments', version: '1.0.0' },
    3003
  );

  // Listen for events
  gateway.on('online', (service) => {
    console.log(`[Gateway] Discovered: ${service.name} (${service.id}) v${service.version}`);
  });

  gateway.on('offline', (service) => {
    console.log(`[Gateway] Offline: ${service.name} (${service.id})`);
  });

  // Start all services
  console.log('Starting services...\n');
  await Promise.all([
    gateway.start(),
    authService.start(),
    usersService.start(),
    usersServiceV2.start(),
    paymentsService.start()
  ]);

  // Wait for discovery (increase timeout for slower networks)
  await new Promise(r => setTimeout(r, 4000));

  console.log('\n--- Filtering Results ---\n');

  // Filter by name
  console.log('Services with name "users":');
  const users = gateway.filter({ name: 'users' });
  users.forEach(s => console.log(`  - ${s.id} v${s.version} at ${s.ip}:${s.port}`));

  // Filter by name and version
  console.log('\nServices with name "users" and version "1.0.0":');
  const usersV1 = gateway.filter({ name: 'users', version: '1.0.0' });
  usersV1.forEach(s => console.log(`  - ${s.id} at ${s.ip}:${s.port}`));

  // Filter by ID
  console.log('\nService with ID "auth-1":');
  const auth = gateway.filter({ id: 'auth-1' });
  auth.forEach(s => console.log(`  - ${s.name} v${s.version} at ${s.ip}:${s.port}`));

  // Filter by version only (finds all v1.0.0 services)
  console.log('\nAll services with version "1.0.0":');
  const v1Services = gateway.filter({ version: '1.0.0' });
  v1Services.forEach(s => console.log(`  - ${s.name} (${s.id})`));

  // Cleanup
  console.log('\nStopping services...');
  gateway.stop();
  authService.stop();
  usersService.stop();
  usersServiceV2.stop();
  paymentsService.stop();
  
  console.log('Done!');
  process.exit(0);
}

filteringExample().catch(console.error);
