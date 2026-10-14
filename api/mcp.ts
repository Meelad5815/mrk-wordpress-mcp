import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";

const API_BASE = "https://public-api.wordpress.com/rest/v1.1";
const RESOURCE_METADATA = "https://mrk-wordpress-mcp.vercel.app/.well-known/oauth-protected-resource";
const OAUTH_SCHEMES = [{ type: "oauth2" as const, scopes: ["global"] }];

function config(accessToken: string) {
  const site = process.env.WORDPRESS_SITE;
  if (!site) throw new Error("Missing WORDPRESS_SITE environment variable.");
  if (!accessToken) throw new Error("No WordPress access token is configured for this connection.");
  return { token: accessToken, site: site.replace(/^https?:\\/\\//, "").replace(/\\/$/, "") };
}

async function wp(accessToken: string, path: string, options: { method?: string; body?: Record<string, string | number | boolean | undefined> } = {}) {
  const { token, site } = config(accessToken);
  const url = new URL(`${API_BASE}/sites/${encodeURIComponent(site)}${path}`);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const init: RequestInit = { method: options.method ?? "GET", headers };
  if (options.body) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(options.body)) if (value !== undefined) form.set(key, String(value));
    init.body = form;
  }
  const response = await fetch(url, init);
  const raw = await response.text();
  let data: any;
  try { data = JSON.parse(raw); } catch { data = { message: raw }; }
  if (!response.ok) throw new Error(data?.message || data?.error_description || `WordPress API returned HTTP ${response.status}`);
  return data;
}

function createServer(accessToken: string) {
  const server = new McpServer({ name: "mrk-wordpress-mcp", version: "1.2.0" });

  server.registerTool("wordpress_site_info", {
    description: "Read basic information about the configured WordPress.com site.",
    inputSchema: {},
    securitySchemes: OAUTH_SCHEMES,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async () => {
    const data = await wp(accessToken, "");
    return { content: [{ type: "text", text: JSON.stringify({
      ID: data.ID, name: data.name, URL: data.URL, description: data.description,
      is_private: data.is_private, jetpack: data.jetpack
    }, null, 2) }] };
  });

  server.registerTool("wordpress_list_posts", {
    description: "List recent WordPress.com posts. Drafts may be returned when the token has permission.",
    inputSchema: {},
    securitySchemes: OAUTH_SCHEMES,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async () => {
    const data = await wp(accessToken, "/posts/?number=10&order_by=date&order=DESC");
    const posts = (data.posts ?? []).map((p: any) => ({
      ID: p.ID, title: p.title, URL: p.URL, status: p.status, type: p.type,
      date: p.date, modified: p.modified, excerpt: p.excerpt
    }));
    return { content: [{ type: "text", text: JSON.stringify(posts, null, 2) }] };
  });

  server.registerTool("wordpress_get_post", {
    description: "Retrieve a WordPress.com post by numeric post ID.",
    inputSchema: { post_id: z.number().describe("Numeric WordPress post ID") },
    securitySchemes: OAUTH_SCHEMES,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async ({ post_id }) => {
    const data = await wp(accessToken, `/posts/${encodeURIComponent(String(post_id))}/`);
    return { content: [{ type: "text", text: JSON.stringify({
      ID: data.ID, title: data.title, content: data.content, excerpt: data.excerpt,
      status: data.status, URL: data.URL, date: data.date, modified: data.modified
    }, null, 2) }] };
  });

  server.registerTool("wordpress_create_draft", {
    description: "Create a new WordPress.com post as a draft. Does not publish it.",
    inputSchema: {
      title: z.string().describe("Post title"),
      content: z.string().describe("Post content; WordPress.com accepts HTML")
    },
    securitySchemes: OAUTH_SCHEMES,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async ({ title, content }) => {
    const data = await wp(accessToken, "/posts/new", { method: "POST", body: { title, content, status: "draft" } });
    return { content: [{ type: "text", text: JSON.stringify({
      ID: data.ID, title: data.title, status: data.status, URL: data.URL,
      message: "Draft created; it has not been published."
    }, null, 2) }] };
  });

  server.registerTool("wordpress_update_post", {
    description: "Update the title and/or content of an existing WordPress.com post. Provide the post ID and at least one field to change.",
    inputSchema: {
      post_id: z.number().describe("Numeric WordPress post ID"),
      title: z.string().optional().describe("New title (optional)"),
      content: z.string().optional().describe("New content (optional; HTML accepted)")
    },
    securitySchemes: OAUTH_SCHEMES,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async ({ post_id, title, content }) => {
    if (title === undefined && content === undefined) throw new Error("Provide title or content to update.");
    const data = await wp(accessToken, `/posts/${encodeURIComponent(String(post_id))}/`, {
      method: "POST", body: { title, content }
    });
    return { content: [{ type: "text", text: JSON.stringify({
      ID: data.ID, title: data.title, status: data.status, URL: data.URL, modified: data.modified
    }, null, 2) }] };
  });

  return server;
}

function getRpcMethod(body: unknown): string {
  if (typeof body === "string") {
    try { return String((JSON.parse(body) as { method?: string }).method ?? ""); } catch { return ""; }
  }
  if (body && typeof body === "object" && "method" in body) return String((body as { method?: string }).method ?? "");
  return "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed. Use MCP Streamable HTTP POST requests." });
  }

  const authHeader = req.headers.authorization ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const configuredSecret = process.env.MCP_SERVER_SECRET;
  let wordpressToken = bearer;
  if (configuredSecret && bearer === configuredSecret) wordpressToken = process.env.WORDPRESS_ACCESS_TOKEN ?? "";

  const rpcMethod = getRpcMethod(req.body);
  const discoveryMethods = new Set(["initialize", "notifications/initialized", "ping", "tools/list"]);
  const isDiscoveryRequest = discoveryMethods.has(rpcMethod);

  // ChatGPT must be able to initialize and discover tool schemas before invoking OAuth-protected tools.
  // Every actual tool call still requires a bearer token.
  if (!bearer && !isDiscoveryRequest) {
    res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${RESOURCE_METADATA}"`);
    return res.status(401).json({ error: "OAuth authorization is required to call WordPress tools." });
  }
  if (bearer && !wordpressToken) {
    res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${RESOURCE_METADATA}"`);
    return res.status(401).json({ error: "WordPress OAuth access token required." });
  }

  try {
    const tokenForHandlers = wordpressToken || process.env.WORDPRESS_ACCESS_TOKEN || "";
    const server = createServer(tokenForHandlers);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    if (!res.headersSent) res.status(500).json({ error: message });
  }
}
