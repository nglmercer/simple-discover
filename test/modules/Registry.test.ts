import { describe, it, expect } from "bun:test";
import { Registry } from "../../src/modules/Registry";

describe("Registry Module", () => {
  it("should add and retrieve services", () => {
    const registry = new Registry();
    registry.update("s1", { id: "s1", ip: "127.0.0.1", port: 3000, lastSeen: Date.now() });
    
    expect(registry.get("s1")).toBeDefined();
    expect(registry.getAll().length).toBe(1);
  });

  it("should handle online/offline events", () => {
    const registry = new Registry();
    let onlineEmitted = false;
    let offlineEmitted = false;

    registry.on("online", () => { onlineEmitted = true; });
    registry.on("offline", () => { offlineEmitted = true; });

    registry.update("s1", { id: "s1", ip: "127.0.0.1", port: 3000, lastSeen: Date.now() });
    expect(onlineEmitted).toBe(true);

    registry.remove("s1");
    expect(offlineEmitted).toBe(true);
  });

  it("should emit online on change", () => {
    const registry = new Registry();
    registry.update("s1", { id: "s1", ip: "127.0.0.1", port: 3000, lastSeen: Date.now(), version: '1.0' });
    
    let changedEvent = false;
    registry.on("online", () => { changedEvent = true; });

    // Different version triggers change
    registry.update("s1", { id: "s1", ip: "127.0.0.1", port: 3000, lastSeen: Date.now(), version: '2.0' });
    expect(changedEvent).toBe(true);
  });

  it("should check offline based on timeout", () => {
    const registry = new Registry();
    registry.update("s1", { id: "s1", ip: "127.0.0.1", port: 3000, lastSeen: Date.now() - 200 });

    let offlineEmitted = false;
    registry.on("offline", () => { offlineEmitted = true; });

    registry.checkOffline(100);
    expect(offlineEmitted).toBe(true);
    expect(registry.get("s1")).toBeUndefined();
  });

  it("should filter by arbitrary criteria", () => {
    const registry = new Registry();
    registry.update("s1", { id: "s1", ip: "127.0.0.1", port: 3000, lastSeen: Date.now(), name: "auth" });
    registry.update("s2", { id: "s2", ip: "127.0.0.1", port: 3001, lastSeen: Date.now(), name: "users" });

    const results = registry.filter({ name: "auth" });
    expect(results.length).toBe(1);
    expect(results[0]!.id).toBe("s1");
  });
});
