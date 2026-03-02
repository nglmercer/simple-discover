import { describe, it, expect } from "bun:test";
import { Network } from "../../src/modules/Network";
import dgram from 'dgram';

// Mock dgram for predictable testing without actually using network ports
describe("Network Module", () => {
    
  it("should initialize successfully", async () => {
    const net = new Network(
        { id: "s1", name: "auth" },
        3000,
        {
          multicastAddress: "239.255.255.250",
          multicastInterface: "127.0.0.1",
          multicastPort: 54330,  // custom port
          heartbeatInterval: 1000,
          offlineTimeout: 2000,
          setupHooks: false
        }
      );
      
      let errorOccurred = false;
      net.on('error', () => { errorOccurred = true; });

      await net.start();
      
      // Let it bind
      await new Promise(r => setTimeout(r, 100));

      expect(errorOccurred).toBe(false);

      net.broadcastPresence('hello');

      net.stop();
  });
});
