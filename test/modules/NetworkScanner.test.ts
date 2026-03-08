import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { NetworkScanner, IDENTITY_PATH } from "../../src/modules/NetworkScanner";
import net from 'net';
import http from 'http';

describe("NetworkScanner Module", () => {
  let mockServer: http.Server | null = null;
  let mockServerPort: number = 0;

  afterEach(() => {
    if (mockServer) {
      mockServer.close();
      mockServer = null;
    }
  });

  it("should calculate local subnets automatically", () => {
    const subnets = NetworkScanner.getLocalSubnets();
    expect(subnets).toBeInstanceOf(Array);
    expect(subnets.length).toBeGreaterThan(0);
    // e.g., '192.168.1.0/24' or '127.0.0.0/8'
    expect(subnets[0]).toMatch(/\d+\.\d+\.\d+\.\d+\/\d+/);
  });

  it("should parse CIDR subnets correctly", () => {
    // A fast /30 subnet has 2 usable IPs
    const ips = NetworkScanner.parseSubnet("192.168.10.0/30");
    expect(ips).toEqual(["192.168.10.1", "192.168.10.2"]);
  });

  it("should handle invalid CIDRs", () => {
    expect(NetworkScanner.parseSubnet("invalid")).toEqual([]);
    expect(NetworkScanner.parseSubnet("192.168.10/24")).toEqual([]);
  });

  it("should perform fast tcpConnect detection", async () => {
    // Spin up a raw TCP server
    await new Promise<void>((resolve) => {
      mockServer = http.createServer();
      mockServer.listen(0, '127.0.0.1', resolve);
    });
    mockServerPort = (mockServer!.address() as any).port;

    // Should detect open port
    const isOpen = await NetworkScanner.tcpConnect("127.0.0.1", mockServerPort, 500);
    expect(isOpen).toBe(true);

    // Should detect closed port (use a random high port)
    const isClosed = await NetworkScanner.tcpConnect("127.0.0.1", 65534, 50);
    expect(isClosed).toBe(false);
  });

  it("should HTTP probe the identity endpoint successfully", async () => {
    await new Promise<void>((resolve) => {
      mockServer = http.createServer((req, res) => {
        if (req.url === IDENTITY_PATH) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: "sv1", name: "test-svc", port: 3000 }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      mockServer.listen(0, '127.0.0.1', resolve);
    });
    mockServerPort = (mockServer!.address() as any).port;

    const result = await NetworkScanner.httpProbe("127.0.0.1", mockServerPort, 1000);
    
    expect(result.identified).toBe(true);
    expect(result.service?.id).toBe("sv1");
    expect(result.service?.name).toBe("test-svc");
    expect(result.service?.schema).toBe("http");
  });

  it("should fallback to root / path requesting JSON", async () => {
    await new Promise<void>((resolve) => {
      mockServer = http.createServer((req, res) => {
        if (req.url === "/") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ service: "root-svc", port: 2000 }));
        }
      });
      mockServer.listen(0, '127.0.0.1', resolve);
    });
    mockServerPort = (mockServer!.address() as any).port;

    const result = await NetworkScanner.httpProbe("127.0.0.1", mockServerPort, 1000);
    
    expect(result.identified).toBe(true);
    expect(result.service?.name).toBe("root-svc");
  });

  it("should fallback to root / path reading HTML title", async () => {
    await new Promise<void>((resolve) => {
      mockServer = http.createServer((req, res) => {
        if (req.url === "/") {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<html><head><title>My Awesome App</title></head></html>");
        }
      });
      mockServer.listen(0, '127.0.0.1', resolve);
    });
    mockServerPort = (mockServer!.address() as any).port;

    const result = await NetworkScanner.httpProbe("127.0.0.1", mockServerPort, 1000);
    
    expect(result.identified).toBe(true);
    // Lowercase & spaces replaced by dashes
    expect(result.service?.name).toBe("my-awesome-app");
    expect(result.responseInfo?.title).toBe("My Awesome App");
  });

  it("should return false if HTTP probe fails completely", async () => {
    await new Promise<void>((resolve) => {
      mockServer = http.createServer((req, res) => {
        // Drop the connection immediately
        res.destroy();
      });
      mockServer.listen(0, '127.0.0.1', resolve);
    });
    mockServerPort = (mockServer!.address() as any).port;

    const result = await NetworkScanner.httpProbe("127.0.0.1", mockServerPort, 1000);
    
    expect(result.identified).toBe(false);
  });

  it("should perform a full network scan on a small test subnet", async () => {
    await new Promise<void>((resolve) => {
      mockServer = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ name: "scan-svc" }));
      });
      mockServer.listen(0, '127.0.0.1', resolve);
    });
    mockServerPort = (mockServer!.address() as any).port;

    // Scan a tiny subnet matching our local mock IP
    const results = await NetworkScanner.scan({
      subnet: "127.0.0.0/30", // 127.0.0.1, 127.0.0.2
      ports: [mockServerPort, 65535],
      connectTimeout: 200,
      probeTimeout: 500,
      concurrency: 2
    });

    expect(results).toBeInstanceOf(Array);
    const found = results.find(r => r.port === mockServerPort && r.ip === "127.0.0.1");
    expect(found).toBeDefined();
    expect(found?.identified).toBe(true);
    expect(found?.service?.name).toBe("scan-svc");
  });

  it("should safely handle no open ports found during scan", async () => {
    const results = await NetworkScanner.scan({
      subnet: "127.0.0.4/30",
      ports: [65534], // Ensure closed everywhere
      connectTimeout: 50,
      probeTimeout: 50,
      concurrency: 1
    });

    expect(results.length).toBe(0);
  });
});
