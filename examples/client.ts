import { Discovery } from '../src';

async function clientExample() {
  // Start the 'users' service provider
  const userService = new Discovery(
    {
      id: 'users-node-1',
      name: 'users',
      version: '1.0.0',
    },
    3001
  );

  await userService.start();

  // Create client that wants to consume 'users'
  const consumerService = new Discovery(
    {
      id: 'api-gateway',
      name: 'gateway',
      version: '1.0.0',
    },
    8080
  );

  await consumerService.start();

  // Give discovery time to resolve via UDP broadcast
  await new Promise(r => setTimeout(r, 1000));

  // Consumer uses the ClientFactory embedded in Discovery instance
  const usersClient = consumerService.createClient('users'); // filter by service name

  console.log('Consumer attempting to make a request to "users" service using the dynamic client...');

  try {
    // This internally determines the URI: schema://discovered-ip:discovered-port/api/users
    // Default schema is 'http'
    // This will error since we haven't actually launched an HTTP server on port 3001
    await usersClient.get('/api/users');
  } catch (err: any) {
    if (err.cause?.code === 'ECONNREFUSED') {
      console.log('✅ Client successfully resolved the IP and port of the user service!');
      console.log('   (Connection refused because there is no actual HTTP server listening on port 3001.)');
    } else {
      console.error(err);
    }
  }

  // Cleanup
  userService.stop();
  consumerService.stop();
}

clientExample();
