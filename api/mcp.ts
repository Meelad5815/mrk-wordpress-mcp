import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const API_BASE = "https://public-api.wordpress.com/rest/v1.1";

function config() {
  const token = process.env.WORDPRESS_ACCESS_TOKEN;
  const site = process.env.WORDPRESS_SITE;
  if (!token || !site) {
    throw new Error(
      "Missing WORDPRESS_ACCESS_TOKEN or WORDPRESS_SITE environment variable. See README.md for setup."
    );
  }
  return { token, site: site.replace(/^https?:\/\//, "").replace(/\/$/, "") };
}

async function wp(path: string, options: { method?: string; body?: Record<string, string | number | boolean | undefined> } = {}) {
  const { token, site } = config();
  const url = new URL(`${API_BASE}/sites/${encodeURIComponent(site)}${path}`);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  const init: RequestInit = { method: options.method ?? "GET", headers };
  if (options.body) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(options.body)) {
      if (value !== undefined) form.set(key, String(value));
    }
    init.body = form;
  }
  const response = await fetch(url, init);
  const raw = await response.text();
  let data: any;
  try { data = JSON.parse(raw); } catch { data = { message: raw }; }
  if (!response.ok) {
    const message = data?.message || data?.error_description || `WordPress API returned HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

function createServer() {
  const server = new McpServer({ name: "mrk-wordpress-mcp", version: "1.0.0" });

  server.tool("wordpress_site_info", "Read basic information about the configured WordPress.com site.", async () => {
    const data = await wp("");
    return { content: [{ type: "text", text: JSON.stringify({
      ID: data.ID, name: data.name, URL: data.URL, description: data.description,
      is_private: data.is_private, jetpack: data.jetpack
    }, null, 2) }] };
  });

  server.tool("wordpress_list_posts", "List recent WordPress.com posts. Drafts may be returned when the token has permission.", async () => {
    const data = await wp("/posts/?number=10&order_by=date&order=DESC");
    const posts = (data.posts ?? []).map((p: any) => ({
      ID: p.ID, title: p.title, URL: p.URL, status: p.status, type: p.type,
      date: p.date, modified: p.modified, excerpt: p.excerpt
    }));
    return { content: [{ type: "text", text: JSON.stringify(posts, null, 2) }] };
  });

  server.tool("wordpress_get_post", "Retrieve a WordPress.com post by numeric post ID.", { post_id: { type: "number", description: "Numeric WordPress post ID" } }, async ({ post_id }: { post_id: number }) => {
    const data = await wp(`/posts/${encodeURIComponent(String(post_id))}/`);
    return { content: [{ type: "text", text: JSON.stringify({
      ID: data.ID, title: data.title, content: data.content, excerpt: data.excerpt,
      status: data.status, URL: data.URL, date: data.date, modified: data.modified
    }, null, 2) }] };
  });

  server.tool("wordpress_create_draft", "Create a new WordPress.com post as a draft. Does not publish it.", {
    title: { type: "string", description: "Post title" },
    content: { type: "string", description: "Post content; WordPress.com accepts HTML" }
  }, async ({ title, content }: { title: string; content: string }) => {
    const data = await wp("/posts/new", { method: "POST", body: { title, content, status: "draft" } });
    return { content: [{ type: "text", text: JSON.stringify({
      ID: data.ID, title: data.title, status: data.status, URL: data.URL, message: "Draft created; it has not been published."
    }, null, 2) }] };
  });

  server.tool("wordpress_update_post", "Update the title and/or content of an existing WordPress.com post. Provide the post ID and at least one field to change.", {
    post_id: { type: "number", description: "Numeric WordPress post ID" },
    title: { type: "string", description: "New title (optional)" },
    content: { type: "string", description: "New content (optional; HTML accepted)" }
  }, async ({ post_id, title, content }: { post_id: number; title?: string; content?: string }) => {
    if (title === undefined && content === undefined) throw new Error("Provide title or content to update.");
    const data = await wp(`/posts/${encodeURIComponent(String(post_id))}/`, {
      method: "POST", body: { title, content }
    });
    return { content: [{ type: "text", text: JSON.stringify({
      ID: data.ID, title: data.title, status: data.status, URL: data.URL, modified: data.modified
    }, null, 2) }] };
  });

  return server;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed. Use MCP Streamable HTTP POST requests." });
  }
  try {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    if (!res.headersSent) res.status(500).json({ error: message });
  }
}
