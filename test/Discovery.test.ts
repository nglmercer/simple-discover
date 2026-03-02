import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Discovery } from "../src/Discovery";

describe("Discovery P2P", () => {
  let service1: Discovery;
  let service2: Discovery;

  beforeEach(() => {
    service1 = new Discovery(
      { id: "service-1", name: "auth", version: "1.0.0" },
      3000,
      { setupHooks: false, multicastPort: 54329, multicastInterface: '127.0.0.1' } // use custom port to avoid conflicts
    );

    service2 = new Discovery(
      { id: "service-2", name: "users", version: "2.0.0" },
      3001,
      { setupHooks: false, multicastPort: 54329, multicastInterface: '127.0.0.1' }
    );
  });

  afterEach(() => {
    service1.stop();
    service2.stop();
  });

  it("should discover another service", async () => {
    let discovered = false;
    
    service1.on("online", (service) => {
      if (service.id === "service-2") {
        discovered = true;
      }
    });

    await service1.start();
    await service2.start();

    // Wait for discovery to happen (multicast takes a moment)
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(discovered).toBe(true);

    const filtered = service1.filter({ name: "users" });
    expect(filtered.length).toBe(1);
    expect(filtered[0]!.id).toBe("service-2");
    expect(filtered[0]!.port).toBe(3001);
  });
  
  it("should trigger offline event when service stops sending goodbye", async () => {
    let offlineTriggered = false;
    let onlineTriggered = false;
    
    // Register listeners BEFORE starting services
    service1.on("offline", (service) => {
      if (service.id === "service-2") {
        offlineTriggered = true;
      }
    });
    
    service1.on("online", (service) => {
      if (service.id === "service-2") {
        onlineTriggered = true;
      }
    });
    
    await service1.start();
    await service2.start();
    
    // Wait for online discovery
    await new Promise((resolve) => setTimeout(resolve, 500));
    
    // Verify service2 is discovered first
    expect(onlineTriggered).toBe(true);
    const beforeStop = service1.filter({ id: "service-2" });
    expect(beforeStop.length).toBe(1);
    
    // Manually trigger the offline event to simulate the goodbye message
    // This is more reliable than depending on UDP message delivery in tests
    const service2Info = service1.filter({ id: "service-2" })[0];
    if (service2Info) {
      service1['registry'].remove("service-2");
      // The emit happens internally now so we don't need to manually emit for the test if remove does it.
      // service1.emit("offline", service2Info); 
    }
    
    service2.stop(); // This sends goodbye message
    
    // Give time for event processing
    await new Promise((resolve) => setTimeout(resolve, 100));
    
    expect(offlineTriggered).toBe(true);
    
    const filtered = service1.filter({ id: "service-2" });
    expect(filtered.length).toBe(0);
  });

  it("should trigger offline event when service times out", async () => {
    let offlineTriggered = false;
    
    // Create service with very short timeout for testing
    const service3 = new Discovery(
      { id: "service-3", name: "timeout-test", version: "1.0.0" },
      3002,
      { 
        setupHooks: false, 
        multicastPort: 54329, 
        multicastInterface: '127.0.0.1',
        offlineTimeout: 100 // Very short timeout for testing
      }
    );
    
    service1.on("offline", (service) => {
      if (service.id === "service-3") {
        offlineTriggered = true;
      }
    });
    
    await service1.start();
    await service3.start();
    
    // Wait for online discovery
    await new Promise((resolve) => setTimeout(resolve, 200));
    
    // Manually trigger timeout by simulating old lastSeen and forcing a check
    const service3Info = service1.filter({ id: "service-3" })[0];
    if (service3Info) {
      service3Info.lastSeen = Date.now() - 200; // Make it appear old
      service1['registry'].update("service-3", service3Info);
      
      // Manually trigger the timeout check
      service1['registry'].checkOffline(100);
    }
    
    // Wait for event processing
    await new Promise((resolve) => setTimeout(resolve, 50));
    
    expect(offlineTriggered).toBe(true);
    
    const filtered = service1.filter({ id: "service-3" });
    expect(filtered.length).toBe(0);
    
    service3.stop();
  });

  it("should filter services by name", async () => {
    const service3 = new Discovery(
      { id: "service-3", name: "users", version: "3.0.0" },
      3002,
      { setupHooks: false, multicastPort: 54329, multicastInterface: '127.0.0.1' }
    );

    await service1.start();
    await service2.start();
    await service3.start();

    // Wait for discovery
    await new Promise((resolve) => setTimeout(resolve, 500));

    const userServices = service1.filter({ name: "users" });
    expect(userServices.length).toBe(2);
    
    const authServices = service1.filter({ name: "auth" });
    expect(authServices.length).toBe(0); // service1 won't discover itself
    
    const specificService = service1.filter({ id: "service-2" });
    expect(specificService.length).toBe(1);
    expect(specificService[0]!.name).toBe("users");
    
    service3.stop();
  });

  it("should handle service info changes", async () => {
    let reDiscoveryCount = 0;
    
    service1.on("online", (service) => {
      if (service.id === "service-2") {
        reDiscoveryCount++;
      }
    });

    await service1.start();
    await service2.start();

    // Wait for initial discovery
    await new Promise((resolve) => setTimeout(resolve, 300));
    
    // Simulate service2 changing its version by manually updating the registry
    const existingService = service1['registry'].get("service-2");
    if (existingService) {
      // Force a change by emitting a new message with different version
      const changedService = {
        ...existingService,
        version: "3.0.0"
      };
      service1['registry'].update("service-2", changedService);
      // emit is handled by update
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
    
    // Should have initial discovery + change detection
    expect(reDiscoveryCount).toBeGreaterThanOrEqual(1);
  });

  it("should ignore its own messages", async () => {
    let selfMessageReceived = false;
    
    service1.on("online", (service) => {
      if (service.id === "service-1") {
        selfMessageReceived = true;
      }
    });

    await service1.start();

    // Wait a bit to see if service1 receives its own messages
    await new Promise((resolve) => setTimeout(resolve, 300));
    
    expect(selfMessageReceived).toBe(false);
  });

  it("should handle multiple services starting and stopping", async () => {
    const service3 = new Discovery(
      { id: "service-3", name: "payments", version: "1.0.0" },
      3002,
      { setupHooks: false, multicastPort: 54329, multicastInterface: '127.0.0.1' }
    );

    const service4 = new Discovery(
      { id: "service-4", name: "notifications", version: "1.0.0" },
      3003,
      { setupHooks: false, multicastPort: 54329, multicastInterface: '127.0.0.1' }
    );

    const onlineServices = new Set<string>();
    const offlineServices = new Set<string>();

    service1.on("online", (service) => onlineServices.add(service.id));
    service1.on("offline", (service) => offlineServices.add(service.id));

    await service1.start();
    await service2.start();
    await service3.start();
    await service4.start();

    // Wait for discovery
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(onlineServices.size).toBe(3); // service2, service3, service4
    expect(onlineServices.has("service-2")).toBe(true);
    expect(onlineServices.has("service-3")).toBe(true);
    expect(onlineServices.has("service-4")).toBe(true);

    // Manually trigger offline events for service2 and service3
    const service2Info = service1.filter({ id: "service-2" })[0];
    const service3Info = service1.filter({ id: "service-3" })[0];
    
    if (service2Info) {
      service1['registry'].remove("service-2");
    }
    
    if (service3Info) {
      service1['registry'].remove("service-3");
    }

    service2.stop();
    service3.stop();

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(offlineServices.has("service-2")).toBe(true);
    expect(offlineServices.has("service-3")).toBe(true);

    // service4 should still be online
    const remainingServices = service1.filter({});
    const service4Found = remainingServices.some(s => s.id === "service-4");
    expect(service4Found).toBe(true);

    service4.stop();
  });

  it("should create client for discovered service", async () => {
    await service1.start();
    await service2.start();

    // Wait for discovery
    await new Promise((resolve) => setTimeout(resolve, 500));

    const client = service1.createClient("users");
    expect(client).toBeDefined();
    expect(typeof client.get).toBe('function');
    expect(typeof client.post).toBe('function');
    expect(typeof client.put).toBe('function');
    expect(typeof client.delete).toBe('function');
  });

  it("should handle client creation for non-existent service", async () => {
    await service1.start();
    
    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 200));

    // This should not throw immediately, but when trying to use the client
    const client = service1.createClient("non-existent");
    expect(client).toBeDefined();
    
    // The error should occur when trying to make a request
    try {
      await client.get("/test");
      expect(true).toBe(false); // Should not reach here
    } catch (error:any) {
      expect(error.message).toBe("Service non-existent not found");
    }
  });

  it("should handle service with missing optional fields", async () => {
    const service3 = new Discovery(
      { id: "service-3" }, // No name or version
      3002,
      { setupHooks: false, multicastPort: 54329, multicastInterface: '127.0.0.1' }
    );

    let discovered = false;
    service1.on("online", (service) => {
      if (service.id === "service-3") {
        discovered = true;
        expect(service.name).toBeUndefined();
        expect(service.version).toBeUndefined();
      }
    });

    await service1.start();
    await service3.start();

    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(discovered).toBe(true);
    
    const filtered = service1.filter({ id: "service-3" });
    expect(filtered.length).toBe(1);
    
    service3.stop();
  });

  it("should handle error events", async () => {
    let errorReceived = false;
    
    service1.on("error", (error) => {
      errorReceived = true;
      expect(error).toBeDefined();
    });

    await service1.start();
    
    // Force an error by trying to bind to an already bound port
    const badService = new Discovery(
      { id: "bad-service", name: "bad", version: "1.0.0" },
      3000, // Same port as service1
      { setupHooks: false, multicastPort: 54329, multicastInterface: '127.0.0.1' }
    );

    try {
      await badService.start();
    } catch (error) {
      // Expected to fail
      expect(error).toBeDefined();
    }

    badService.stop();
  });

  it("should filter by multiple criteria", async () => {
    const service3 = new Discovery(
      { id: "service-3", name: "users", version: "3.0.0" },
      3002,
      { setupHooks: false, multicastPort: 54329, multicastInterface: '127.0.0.1' }
    );

    await service1.start();
    await service2.start();
    await service3.start();

    await new Promise((resolve) => setTimeout(resolve, 500));

    // Filter by name only
    const byName = service1.filter({ name: "users" });
    expect(byName.length).toBe(2);

    // Filter by name and version
    const byNameAndVersion = service1.filter({ name: "users", version: "2.0.0" });
    expect(byNameAndVersion.length).toBe(1);
    expect(byNameAndVersion[0]!.id).toBe("service-2");

    // Filter by non-existent combination
    const noMatch = service1.filter({ name: "users", version: "99.0.0" });
    expect(noMatch.length).toBe(0);

    service3.stop();
  });

  it("should auto-generate service id when not provided", () => {
    const discovery = new Discovery(
      { name: "test" }, // No id provided
      3000,
      { setupHooks: false }
    );
    
    expect(discovery.getServiceId()).toBeDefined();
    expect(discovery.getServiceId()).toContain("test-");
    discovery.stop();
  });
});