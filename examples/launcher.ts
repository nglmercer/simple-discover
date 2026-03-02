/**
 * Spawner Script
 * This script launches both Service A and Service B as subprocesses.
 * Since they use port 0, they will find each other automatically via Multicast.
 */

console.log('--- Launching Multi-Service Discovery Demo ---');

const serviceA = Bun.spawn(['bun', 'run', 'examples/server-3001.ts'], {
  stdout: 'inherit',
  stderr: 'inherit',
});

// Give Service A a moment to start its listener
await new Promise(r => setTimeout(r, 1000));

const serviceB = Bun.spawn(['bun', 'run', 'examples/server-3002.ts'], {
  stdout: 'inherit',
  stderr: 'inherit',
});

console.log('Processes spawned. Waiting for discovery...');

// Handle process termination
process.on('SIGINT', () => {
  console.log('\nShutting down demo...');
  serviceA.kill();
  serviceB.kill();
  process.exit();
});

// Keep the main process alive until subprocesses exit
await Promise.all([serviceA.exited, serviceB.exited]);
