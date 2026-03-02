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
    
    await service1.start();
    await service2.start();
    
    // Wait for online discovery
    await new Promise((resolve) => setTimeout(resolve, 300));
    
    service1.on("offline", (service) => {
      if (service.id === "service-2") {
        offlineTriggered = true;
      }
    });

    service2.stop(); // This sends goodbye message
    
    // Give some time for goodbye message to process
    await new Promise((resolve) => setTimeout(resolve, 200));
    
    expect(offlineTriggered).toBe(true);
    
    const filtered = service1.filter({ id: "service-2" });
    expect(filtered.length).toBe(0);
  });
});
