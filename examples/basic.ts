import { Discovery } from '../src';

// Create a service that provides functionality
const authService = new Discovery(
  {
    id: 'auth-service-node-1',
    name: 'auth',
    version: '1.0.0',
    schema: 'http'
  },
  3000 // Port the auth service API is listening on
);

// Listen to discovery events
authService.on('online', (service) => {
  console.log(`[Auth] Discovered new service: ${service.name} (${service.id}) at ${service.ip}:${service.port}`);
});

authService.on('offline', (service) => {
  console.log(`[Auth] Service went offline: ${service.name} (${service.id})`);
});

authService.on('error', (err) => {
  console.error('[Auth] Discovery error:', err);
});

async function main() {
  console.log('Starting auth service discovery...');
  await authService.start();
  
  // Start another service a few seconds later to simulate dynamic scaling
  setTimeout(async () => {
    const userService = new Discovery(
      {
        id: 'user-service-node-1',
        name: 'users',
        version: '1.2.0',
      },
      3001
    );

    console.log('\nStarting user service discovery...');
    await userService.start();

    // Give some time for discovery
    setTimeout(() => {
      // You can manually filter the current registry
      const authFound = userService.filter({ name: 'auth' });
      console.log('\n[Users] Current auth services registered:', authFound.map(s => `${s.id} on port ${s.port}`));
      
      console.log('\nStopping services...');
      userService.stop();
      authService.stop();
      process.exit(0);
    }, 2000);

  }, 1000);
}

main().catch(console.error);
