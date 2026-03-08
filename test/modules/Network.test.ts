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
          setupHooks: false,
          enableBroadcast: false,
          enableIdentityEndpoint: false,
          broadcastPort: 54340
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

  it("should handle error during socket bindings and parsing", async () => {
    // Port 0 auto-assign doesn't practically fail on bind if port 0 is used,
    // but we can simulate error handlers by emitting events directly on the socket
    const net = new Network(
        { id: "s2", name: "bad" },
        3000,
        {
          multicastAddress: "239.255.255.250",
          multicastInterface: "", // test 0.0.0.0 fallback
          multicastPort: 54331,
          broadcastPort: 54332,
          heartbeatInterval: 1000,
          offlineTimeout: 2000,
          setupHooks: false,
          enableBroadcast: true,
          enableIdentityEndpoint: true
        }
      );
      
      let msgReceived = false;
      net.on('message', () => { msgReceived = true; });
      let errReceived = false;
      net.on('error', () => { errReceived = true; });

      await net.start();
      
      // Simulate socket errors and random messages on multicast socket
      if (net['socket']) {
        net['socket'].emit('error', new Error('mock error'));
        // Valid message
        net['socket'].emit('message', Buffer.from(JSON.stringify({ type: 'hello', service: { id: 's3', port: 1234 } })), { address: '127.0.0.1' });
        // Invalid json
        net['socket'].emit('message', Buffer.from("invalid-json"), { address: '127.0.0.1' });
      }

      // Simulate on broadcast socket
      if (net['broadcastSocket']) {
        net['broadcastSocket'].emit('error', new Error('mock broadcast error'));
        // Valid msg
        net['broadcastSocket'].emit('message', Buffer.from(JSON.stringify({ type: 'heartbeat', service: { id: 's4', port: 1234 } })), { address: '127.0.0.1' });
        // Invalid msg
        net['broadcastSocket'].emit('message', Buffer.from("bad-broadcast"), { address: '127.0.0.1' });
      }

      expect(errReceived).toBe(true);
      expect(msgReceived).toBe(true);

      net.broadcastPresence('heartbeat');

      net.stop();
  });
});

