import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

export const PLUGIN_NAME = "sprint-orchestrator";

export function buildServer(): McpServer {
  const server = new McpServer({
    name: PLUGIN_NAME,
    version: "0.0.1",
  });

  server.registerTool(
    "ping",
    {
      title: "Ping",
      description: "Smoke-test tool. Echoes back the message you send.",
      inputSchema: { message: z.string().default("pong") },
    },
    async ({ message }) => ({
      content: [{ type: "text", text: `pong: ${message}` }],
    }),
  );

  return server;
}

export async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isEntry = import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  main().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
