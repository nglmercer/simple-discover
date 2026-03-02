import { Discovery } from '../src';

/**
 * STARTING SERVICE A (PORT 3001)
 * This script demonstrates an API that registers itself and discovers Service B.
 */

// 1. Create Bun HTTP Server with port 0 (auto-assign)
let server: any;
server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/hello') {
      return new Response(JSON.stringify({ message: 'Hello from Service A!', from: server.port.toString() }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Service A is running');
  },
});

console.log(`[Service A] HTTP Server running on http://localhost:${server.port}`);

// 2. Initialize Discovery using the dynamic port
const discovery = new Discovery(
  {
    id: 'service-a-unique-id',
    name: 'service-a',
    version: '1.0.0',
  },
  server.port,
);

// 3. Setup Discovery Events
discovery.on('online', (service) => {
  console.log(`[Service A] Found: ${service.name} at ${service.ip}:${service.port}`);
  if (service.name === 'service-b') {
    callServiceB();
  }
});

discovery.on('offline', (service) => {
  console.log(`[Service A] Service went offline: ${service.name} (${service.id})`);
});

// 4. Start Discovery
await discovery.start();
console.log('[Service A] Discovery started...');

// Helper to call Service B using the built-in HttpClient
async function callServiceB() {
  try {
    console.log('[Service A] Attempting to call Service B via Discovery Client...');
    const client = discovery.createClient('service-b');
    const response = await client.get('/hello');
    const data = await response.json();
    console.log('[Service A] Response from Service B:', data);
  } catch (error) {
    console.error('[Service A] Failed to call Service B:', error);
  }
}

// Keep process alive
process.on('SIGINT', () => {
  console.log('[Service A] Stopping...');
  discovery.stop();
  server.stop();
  process.exit();
});
