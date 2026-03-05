# Discover - P2P Service Discovery

A lightweight, zero-configuration P2P service discovery library for Node.js using UDP multicast.

## Features

- **Zero Configuration** - Services discover each other automatically on the local network
- **UDP Multicast** - Uses `239.255.255.250:54321` for service advertisement and discovery
- **Automatic Heartbeat** - Services periodically announce their presence
- **Offline Detection** - Automatically detects when services go offline
- **HTTP Client Factory** - Built-in client to make HTTP requests to discovered services
- **Event-Driven** - Emits `online` and `offline` events for dynamic service tracking

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
  - `heartbeatInterval?: number` - Heartbeat interval in ms (default: 5000)
  - `offlineTimeout?: number` - Time before marking service offline (default: 15000)
  - `setupHooks?: boolean` - Setup SIGINT/SIGTERM hooks (default: true)

#### Methods

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

1. **Broadcast**: Each service broadcasts its presence via UDP multicast to `239.255.255.250:54321`
2. **Message Types**:
   - `hello` - Initial announcement when service starts
   - `heartbeat` - Periodic presence updates (every 5 seconds by default)
   - `goodbye` - Notification when service stops
3. **Registry**: Services maintain a local registry of discovered services
4. **Offline Detection**: Services are marked offline if no heartbeat is received within the offline timeout (15 seconds by default)

## Testing

```bash
# Run all tests
bun test

# Run specific test file
bun test test/Discovery.test.ts
```

## License

ISC
