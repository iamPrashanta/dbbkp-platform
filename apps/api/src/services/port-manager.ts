import getPort from "get-port";
import { db, sites } from "@dbbkp/db";
import { isNotNull } from "drizzle-orm";

export async function getFreePort(): Promise<number> {
  const usedPorts = await db
    .select({ port: sites.port })
    .from(sites)
    .where(isNotNull(sites.port));
  
  const usedSet = new Set(usedPorts.map(p => p.port));

  // Find first free port in range that is also free on system
  const port = await getPort({
    port: Array.from({ length: 10001 }, (_, i) => 10000 + i).filter(p => !usedSet.has(p)),
  });

  return port;
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    server.listen(port, "127.0.0.1");
  });
}
