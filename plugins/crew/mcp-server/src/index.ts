import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

/**
 * Stdio entrypoint referenced by `.claude-plugin/plugin.json#mcpServers`.
 *
 * Kept thin: instantiate the server, connect a stdio transport, exit
 * on error. All wiring lives in `createServer()` so it can be
 * exercised by tests without forking a transport.
 */
async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
