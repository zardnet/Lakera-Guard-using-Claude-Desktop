/**
 * Example MCP server (TypeScript) with Lakera Guard pre_call/post_call
 * screening applied to a tool.
 *
 * npm i @modelcontextprotocol/sdk zod dotenv
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { guardContent } from "./guard.js";

const server = new McpServer({
  name: "tldr-guarded",
  version: "1.0.0",
});

// Raw tool logic (no guard) — kept separate so guard wraps only the boundary
//
// NOTE: avoid wrapping the output in an imperative instruction (e.g. "Make TLDR
// of text: ..."). Lakera Guard's prompt-injection detector treats instruction
// phrasing mixed with content as a false-positive trigger (see "Additional
// system instructions mixed with user content" in Lakera's docs), which caused
// legitimate summaries to be flagged. Use a neutral label instead.
async function tldrText(args: { text: string }): Promise<string> {
  return `Summary: ${args.text}`;
}

// Wrap with pre_call (input) + post_call (output) screening
const guardedTldrText = guardContent(tldrText, {
  inputParam: "text",
  outputScreen: true,
});

server.tool(
  "tldr_text",
  "Summarizes the given text (Lakera Guard screened)",
  { text: z.string() },
  async (args) => {
    try {
      const text = await guardedTldrText(args);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      // Surface the rejection to the model as a tool error rather than
      // letting the flagged content through.
      return {
        isError: true,
        content: [{ type: "text", text: `${(err as Error).message}` }],
      };
    }
  }
);

async function main() {
  const lakeraApiKey = process.env.LAKERA_API_KEY;
  if (!lakeraApiKey) {
    throw new Error("LAKERA_API_KEY not set in .env file");
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP server (Lakera Guard enabled) started.");
}

main().catch((err) => {
  console.error("Fatal error starting server:", err);
  process.exit(1);
});
