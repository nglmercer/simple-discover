import { Discovery } from '../src';

/**
 * ACTIVE NETWORK SCANNER EXAMPLE
 * 
 * This example demonstrates the active scanning capability of the Discovery library.
 * Useful when services might not be broadcasting multicast, or you are looking for 
 * existing HTTP services across your whole local network.
 */

async function main() {
    console.log("=========================================");
    console.log("🚀 Starting Active Network Discovery Scan");
    console.log("=========================================\n");

    // 1. Initialize discovery (port 0 means we are just a client, not hosting an HTTP service)
    const discovery = new Discovery({ name: 'scanner', version: '1.0.0' }, 0);
    
    // Listen for discoveries (scanning automatically emits 'online' events)
    discovery.on('online', (service) => {
        console.log(`[Event] Found Service: ${service.name} (${service.schema}://${service.ip}:${service.port})`);
    });

    // Start background listeners (optional, but good if you also want multicast)
    await discovery.start();

    console.log("📡 Scanning local network for open ports and HTTP identities...");
    const scanStartTime = Date.now();

    // 2. Perform the scan!
    // This will calculate your local subnet (e.g., 192.168.1.0/24), 
    // run a blazing-fast TCP connect scan across the ports,
    // and then HTTP-probe the open ones for the /.well-known/discover identity.
    const results = await discovery.scan({
        ports: [3000, 3001, 3002, 8080, 5000],
        connectTimeout: 800, // Faster scan across the whole subnet
        probeTimeout: 2000,  // Wait up to 2s for HTTP servers to answer
        concurrency: 128,    // Number of IPs to probe simultaneously
        registerResults: true // Automatically adds found services to our local registry
    });

    const duration = ((Date.now() - scanStartTime) / 1000).toFixed(2);

    console.log(`\n✅ Scan completed in ${duration} seconds.\n`);
    
    // 3. Review the results
    const identifiedServices = results.filter(r => r.identified);
    const unknownServices = results.filter(r => !r.identified);

    console.log(`--- Identified Services (${identifiedServices.length}) ---`);
    for (const r of identifiedServices) {
        console.log(`🎯 ${r.ip}:${r.port}`);
        console.log(`   Name:    ${r.service?.name}`);
        console.log(`   Version: ${r.service?.version}`);
        console.log(`   ID:      ${r.service?.id}\n`);
    }

    if (unknownServices.length > 0) {
        console.log(`--- Open Ports without Identity (${unknownServices.length}) ---`);
        for (const r of unknownServices) {
            let info = r.responseInfo?.title ? `Title: ${r.responseInfo.title}` : `Status: ${r.responseInfo?.statusCode || 'None'}`;
            console.log(`📍 ${r.ip}:${r.port}  (${info})`);
        }
    }

    if (results.length === 0) {
        console.log("❌ No services or open ports found on the network.");
    }

    // Clean up
    discovery.stop();
    process.exit(0);
}

main().catch(console.error);
