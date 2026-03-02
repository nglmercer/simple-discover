import { describe, it, expect } from "bun:test";
import { ClientFactory } from "../../src/modules/ClientFactory";

describe("ClientFactory Module", () => {
  it("should create HTTP verbs", () => {
    const factory = new ClientFactory(() => [{ id: "s1", ip: "127.0.0.1", port: 3000, schema: "http", lastSeen: Date.now() }]);
    const client = factory.createClient("s1");
    
    expect(client).toBeDefined();
    expect(client.get).toBeDefined();
    expect(client.post).toBeDefined();
    expect(client.put).toBeDefined();
    expect(client.delete).toBeDefined();
  });

  it("should throw if service not found", async () => {
    const factory = new ClientFactory(() => []);
    const client = factory.createClient("unknown");

    let err: Error | null = null;
    try {
      await client.get("/foo");
    } catch (e: any) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err?.message).toMatch(/not found/);
  });
});
