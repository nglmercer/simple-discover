# Discover - P2P Service Discovery

A lightweight, zero-configuration P2P service discovery library for Node.js using UDP multicast.

## Features

- **Zero Configuration** - Services discover each other automatically on the local network
- **Dual Stack Delivery** - Uses both UDP Multicast (`239.255.255.250`) and dynamic Subnet Broadcast seamlessly to cross most routers and firewalls.
- **Active Network Scanning** - Built-in blazing fast TCP SYN scanner to discover services across the entire LAN segment safely.
- **Auto Identity Endpoint** - Automatically exposes a `GET /.well-known/discover` identity endpoint for JSON metadata identification.
- **Automatic Heartbeat** - Services periodically announce their presence over network.
- **Offline Detection** - Automatically detects when services go offline via timeouts or graceful goodbye signals.
- **HTTP Client Factory** - Built-in client proxy to seamlessly connect and load balance requests to discovered services.
- **Event-Driven** - Emits `online` and `offline` events for your applications to subscribe and map the local network graph dynamically.

## Installation

```bash
# Install dependencies
bun install
# or
npm install
```

## Quick Start

```typescript
import { Discovery } from "./src";

// Create a service
const myService = new Discovery(
  {
    id: "my-service-1",
    name: "my-service",
    version: "1.0.0",
  },
  3000, // Port where your HTTP server is running
);

// Listen for discovered services
myService.on("online", (service) => {
  console.log(
    `Service discovered: ${service.name} at ${service.ip}:${service.port}`,
  );
});

myService.on("offline", (service) => {
  console.log(`Service offline: ${service.name}`);
});

// Start discovery
await myService.start();
```

## API Reference

### `Discovery`

#### Constructor

```typescript
new Discovery(serviceInfo: ServiceInfo, port: number, options?: DiscoveryOptions)
```

**Parameters:**

- `serviceInfo: ServiceInfo` - Information about your service
  - `id: string` (required) - Unique identifier for this service instance
  - `name?: string` - Service name for filtering (e.g., 'users', 'auth')
  - `version?: string` - Service version (e.g., '1.0.0')
  - `schema?: string` - Protocol schema (default: 'http')

- `port: number` - Port where your service's HTTP server is running

- `options?: DiscoveryOptions` - Optional configuration
  - `multicastAddress?: string` - Multicast address (default: '239.255.255.250')
  - `multicastInterface?: string` - Network interface to bind to
  - `multicastPort?: number` - Multicast port (default: 54321)
  - `broadcastPort?: number` - Subnet UDP broadcast port (default: 54322)
  - `enableBroadcast?: boolean` - Enable UDP broadcast fallback (default: true)
  - `enableIdentityEndpoint?: boolean` - Automatically start the identity server endpoint on the specified port. (default: true)
  - `heartbeatInterval?: number` - Heartbeat interval in ms (default: 5000)
  - `offlineTimeout?: number` - Time before marking service offline (default: 15000)
  - `setupHooks?: boolean` - Setup SIGINT/SIGTERM hooks (default: true)

#### Methods

##### `scan(options: ScanOptions): Promise<ScanResult[]>`

Actively scans your local network (LAN) for existing servers.
Unlike traditional multicast which can be arbitrarily blocked by switches/routers, this runs a blazing-fast TCP Connect sequence across your whole subnet, followed by an HTTP probe for the identity endpoint.

```typescript
const discovery = new Discovery({ name: "scanner" }, 0); // 0 = client only
await discovery.start();

const results = await discovery.scan({
  ports: [3000, 3001, 8080],
  connectTimeout: 500, // Ms to wait for TCP connect (lower is faster)
  concurrency: 100, // Max concurrent IPs to probe
  registerResults: true, // Automatically add found services to the filterable registry
});

// Logs discovered open servers on your local network
results.forEach((r) => console.log(r.ip, r.service?.name));
```

##### `getIdentityMiddleware(): Function`

Provides an HTTP handler to inject the `/.well-known/discover` identity endpoint into an existing Node.js HTTP server natively, Express, Hono, or Bun.serve without spinning up a secondary standalone server port.

```typescript
// Example with Bun.serve
Bun.serve({
  port: 3000,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/.well-known/discover") {
      return new Response(
        JSON.stringify(
          discovery.getInternalRegistry().get(discovery.getServiceId()) || {
            id: discovery.getServiceId(),
            name: "my-service",
            version: "1.0.0",
            schema: "http",
            port: 3000,
          },
        ),
        {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    }
    return new Response("My Service is running");
  },
});
```

##### `start(): Promise<void>`

Start the discovery service. Begins broadcasting presence and listening for other services.

##### `stop(): void`

Stop the discovery service. Broadcasts a goodbye message and cleans up resources.

##### `filter(criteria: Partial<ServiceInfo>): DiscoveredService[]`

Filter discovered services by criteria.

```typescript
// Find all 'users' services
const users = discovery.filter({ name: "users" });

// Find specific service by ID
const service = discovery.filter({ id: "auth-service-1" });

// Find by version
const v1Services = discovery.filter({ name: "api", version: "1.0.0" });
```

##### `createClient(criteria: string | Partial<ServiceInfo>, loadBalancer?: 'first' | 'random' | 'round-robin'): HttpClient`

Create an HTTP client for a discovered service. You can pass a string (service name or ID), or an object with specific criteria to select the precise service to proxy. By default, it balances traffic using `round-robin`.

```typescript
// Basic syntax using a name
const client = discovery.createClient("users");

// Targeting a specific version or port across multiple services
const customClient = discovery.createClient({
  name: "users",
  version: "2.0.0",
});

// Choosing a specific load balancer behavior (first, random, round-robin)
const randomClient = discovery.createClient("users", "random");

// Use like a regular fetch client
await client.get("/api/users");
await client.post("/api/users", { body: JSON.stringify(data) });
await client.put("/api/users/1", { body: JSON.stringify(data) });
await client.delete("/api/users/1");
```

#### Events

##### `online`

Emitted when a new service is discovered or a service's info changes.

```typescript
discovery.on("online", (service: DiscoveredService) => {
  console.log(`Discovered: ${service.name} (${service.id})`);
  console.log(`  IP: ${service.ip}`);
  console.log(`  Port: ${service.port}`);
  console.log(`  Version: ${service.version}`);
});
```

##### `offline`

Emitted when a service goes offline (sends goodbye or times out).

```typescript
discovery.on("offline", (service: DiscoveredService) => {
  console.log(`Offline: ${service.name} (${service.id})`);
});
```

##### `error`

Emitted when an error occurs.

```typescript
discovery.on("error", (err: Error) => {
  console.error("Discovery error:", err);
});
```

### Types

#### `ServiceInfo`

```typescript
interface ServiceInfo {
  id: string;
  name?: string;
  version?: string;
  schema?: string;
}
```

#### `DiscoveredService`

```typescript
interface DiscoveredService extends ServiceInfo {
  ip: string;
  port: number;
  lastSeen: number;
}
```

## Examples

### Basic Service Discovery

See [`examples/basic.ts`](examples/basic.ts) for a complete example.

```bash
bun run examples/basic.ts
```

### Creating HTTP Clients

See [`examples/client.ts`](examples/client.ts) for a complete example.

```bash
bun run examples/client.ts
```

### Active Network Scanning & TCP Fallback

Run the scanner to discover all devices and open HTTP servers sitting on your network.

See [`examples/active-scanner.ts`](examples/active-scanner.ts) for a complete example.

```bash
bun run examples/active-scanner.ts
```

### Filtering Services

```typescript
import { Discovery } from "./src";

const discovery = new Discovery(
  { id: "gateway", name: "gateway", version: "1.0.0" },
  8080,
);

await discovery.start();

// Wait for discovery
await new Promise((r) => setTimeout(r, 2000));

// Filter by name
const usersServices = discovery.filter({ name: "users" });

// Filter by multiple criteria
const v1Users = discovery.filter({ name: "users", version: "1.0.0" });

// Filter by ID
const specificService = discovery.filter({ id: "auth-service-node-1" });
```

### Multiple Services with Different Ports

```typescript
// Start multiple instances of the same service type
const userService1 = new Discovery(
  { id: "users-1", name: "users", version: "1.0.0" },
  3001,
);

const userService2 = new Discovery(
  { id: "users-2", name: "users", version: "1.0.0" },
  3002,
);

await Promise.all([userService1.start(), userService2.start()]);

// The client will automatically load balance using 'round-robin' by default
const client = discovery.createClient("users");

// If you want to force specific behavior
const firstOnlyClient = discovery.createClient("users", "first");
const randomizedClient = discovery.createClient("users", "random");

// You can also target specifically by criteria
const specificPortClient = discovery.createClient({
  name: "users",
  port: 3002,
});
```

### Custom Configuration

```typescript
const discovery = new Discovery(
  { id: "custom-service", name: "custom" },
  4000,
  {
    multicastAddress: "239.255.255.250",
    multicastPort: 54321,
    heartbeatInterval: 3000, // Send heartbeat every 3 seconds
    offlineTimeout: 10000, // Mark offline after 10 seconds
    setupHooks: false, // Disable automatic cleanup on SIGINT/SIGTERM
  },
);
```

## How It Works

1. **Active Identity Probe**: When a service calls `.scan()`, it performs extremely high-speed, non-blocking asynchronous TCP Connect scans across your auto-detected subnets (e.g. `192.168.0.0/24`). For ports that open, it sends HTTP `GET /.well-known/discover` JSON payload queries which uniquely identify the network graph immediately, even without UDP support natively.
2. **Dual-Stack Broadcast**: Each service broadcasts its presence via UDP Multicast (`239.255.255.250:54321`) AND Subnet Broadcast (e.g., `192.168.1.255:54322`) ensuring the packets aren't dropped by strict managed routers.
3. **Message Types**:
   - `hello` - Initial announcement when service starts (triggers other machines to reply immediately with heartbeat payloads to quickly assemble connection graphs)
   - `heartbeat` - Periodic presence updates (every 5 seconds by default)
   - `goodbye` - Graceful notification when a service stops manually `discovery.stop()`
4. **Registry**: Services maintain a local JSON registry matrix of all discovered peers.
5. **Offline Detection**: Services are safely swept and marked offline if no heartbeat is received within the offline timeout threshold (15 seconds by default), pruning the network map appropriately.

## Testing

```bash
# Run all tests
bun test

# Run specific test file
bun test test/Discovery.test.ts
```

## License

ISC
