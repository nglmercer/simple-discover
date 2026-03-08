import { describe, it, expect, afterEach } from "bun:test";
import { IdentityServer } from "../../src/modules/IdentityServer";
import { IDENTITY_PATH } from "../../src/modules/NetworkScanner";
import http from 'http';

describe("IdentityServer Module", () => {
  let server: IdentityServer | null = null;

  afterEach(() => {
    if (server) {
      server.stop();
      server = null;
    }
  });

  it("should return the correct identity object", () => {
    server = new IdentityServer(
      { id: "s1", name: "test-svc", version: "1.0.0", schema: "https" },
      8080,
      { custom: "data" }
    );

    const identity = server.getIdentity();
    expect(identity.id).toBe("s1");
    expect(identity.name).toBe("test-svc");
    expect(identity.version).toBe("1.0.0");
    expect(identity.schema).toBe("https");
    expect(identity.port).toBe(8080);
    expect(identity.custom).toBe("data");
  });

  it("should provide middleware that handles the identity route", async () => {
    server = new IdentityServer(
      { id: "s2", name: "mw-svc", version: "2.0.0" },
      8081
    );

    const middleware = server.middleware();

    // Create a generic Node.js server using the middleware
    const httpServer = http.createServer((req, res) => {
      middleware(req, res, () => {
        res.writeHead(404);
        res.end("Not Found");
      });
    });

    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const port = (httpServer.address() as any).port;

    // Test the middleware identity endpoint
    const res = await fetch(`http://127.0.0.1:${port}${IDENTITY_PATH}`);
    expect(res.status).toBe(200);
    const data = await res.json() as { id?: string };
    expect(data.id).toBe("s2");

    // Test fallthrough
    const res2 = await fetch(`http://127.0.0.1:${port}/other`);
    expect(res2.status).toBe(404);

    httpServer.close();
  });

  it("should start a standalone server", async () => {
    server = new IdentityServer(
      { id: "s3", name: "standalone-svc", version: "1.0.0" },
      0 // auto-assign
    );

    await server.startStandalone();
    
    // We don't have direct access to the assigned port from IdentityServer when port=0,
    // so we'll test startStandalone on a specific port.
    server.stop();

    // Try starting on a fixed dynamic port
    const fixedServer = new IdentityServer(
      { id: "s4", name: "fixed-svc", version: "1.0.0" },
      15432
    );
    await fixedServer.startStandalone();
    
    const res = await fetch(`http://127.0.0.1:15432${IDENTITY_PATH}`);
    expect(res.status).toBe(200);
    const data = await res.json() as { id?: string };
    expect(data.id).toBe("s4");

    const res2 = await fetch(`http://127.0.0.1:15432/not-found`);
    expect(res2.status).toBe(404);
    
    fixedServer.stop();
  });

  it("should gracefully handle port already in use", async () => {
    // Occupy port 15433
    const blocker = http.createServer((_req, res) => res.end());
    await new Promise<void>((resolve) => blocker.listen(15433, '0.0.0.0', resolve));

    server = new IdentityServer(
      { id: "s5", name: "conflict-svc", version: "1.0.0" },
      15433
    );

    // This should resolve immediately (non-fatal catch)
    await server.startStandalone();
    // Port is still occupied by blocker
    
    server.stop();
    blocker.close();
  });
});
