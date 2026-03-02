import { Discovery } from '../src';

/**
 * STARTING SERVICE B (PORT 3002)
 * This script demonstrates an API that registers itself and discovers Service A.
 */

// 1. Create Bun HTTP Server with port 0 (auto-assign)
let server: any;
server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/hello') {
      return new Response(JSON.stringify({ message: 'Hello from Service B!', from: server.port.toString() }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Service B is running');
  },
});

console.log(`[Service B] HTTP Server running on http://localhost:${server.port}`);

// 2. Initialize Discovery using the dynamic port
const discovery = new Discovery(
  {
    id: 'service-b-unique-id',
    name: 'service-b',
    version: '1.0.0',
  },
  server.port,
  {
    multicastInterface: '127.0.0.1'
  }
);

// 3. Setup Discovery Events
discovery.on('online', (service) => {
  console.log(`[Service B] New service found: ${service.name} (${service.id}) at ${service.ip}:${service.port}`);
  
  // If we found Service A, let's try to call it!
  if (service.name === 'service-a') {
    callServiceA();
  }
});

discovery.on('offline', (service) => {
  console.log(`[Service B] Service went offline: ${service.name} (${service.id})`);
});

// 4. Start Discovery
await discovery.start();
console.log('[Service B] Discovery started...');

// Helper to call Service A using the built-in HttpClient
async function callServiceA() {
  try {
    console.log('[Service B] Attempting to call Service A via Discovery Client...');
    const client = discovery.createClient('service-a');
    const response = await client.get('/hello');
    const data = await response.json();
    console.log('[Service B] Response from Service A:', data);
  } catch (error) {
    console.error('[Service B] Failed to call Service A:', (error as Error).message);
  }
}

// Keep process alive
process.on('SIGINT', () => {
  console.log('[Service B] Stopping...');
  discovery.stop();
  server.stop();
  process.exit();
});
