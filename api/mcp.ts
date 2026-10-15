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
  const normalizedSite = site.replace("https://", "").replace("http://", "");
  return { token: accessToken, site: normalizedSite.endsWith("/") ? normalizedSite.slice(0, -1) : normalizedSite };
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

  server.registerTool("wordpress_publish_post", {
    description: "Publish an existing WordPress.com draft post by numeric post ID. Makes the post publicly visible immediately.",
    inputSchema: { post_id: z.number().describe("Numeric ID of the draft post to publish") },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async ({ post_id }) => {
    const existing = await wp(accessToken, `/posts/${encodeURIComponent(String(post_id))}/`);
    if (existing.status === "publish") {
      return { content: [{ type: "text", text: JSON.stringify({ ID: existing.ID, title: existing.title, status: existing.status, URL: existing.URL, message: "This post is already published." }, null, 2) }] };
    }
    const data = await wp(accessToken, `/posts/${encodeURIComponent(String(post_id))}/`, {
      method: "POST", body: { status: "publish" }
    });
    return { content: [{ type: "text", text: JSON.stringify({
      ID: data.ID, title: data.title, status: data.status, URL: data.URL,
      message: data.status === "publish" ? "Post published successfully." : "WordPress did not confirm publication."
    }, null, 2) }] };
  });


  server.registerTool("wordpress_list_pages", {
    description: "List WordPress.com pages with IDs, titles, URLs, status and modified dates.",
    inputSchema: { number: z.number().int().min(1).max(50).optional().describe("Number of pages, 1–50; default 20") },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async ({ number }) => {
    const data = await wp(accessToken, `/posts/?type=page&number=${number ?? 20}&order_by=date&order=DESC`);
    return { content: [{ type: "text", text: JSON.stringify((data.posts ?? []).map((p: any) => ({
      ID: p.ID, title: p.title, URL: p.URL, status: p.status, modified: p.modified
    })), null, 2) }] };
  });

  server.registerTool("wordpress_get_page", {
    description: "Read a WordPress.com page by its numeric ID, including its full content.",
    inputSchema: { page_id: z.number().int().describe("Numeric page ID") },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async ({ page_id }) => {
    const data = await wp(accessToken, `/posts/${encodeURIComponent(String(page_id))}/`);
    if (data.type !== "page") throw new Error("The supplied ID is not a page.");
    return { content: [{ type: "text", text: JSON.stringify({
      ID: data.ID, title: data.title, content: data.content, excerpt: data.excerpt,
      status: data.status, URL: data.URL, modified: data.modified
    }, null, 2) }] };
  });

  server.registerTool("wordpress_create_draft_page", {
    description: "Create a new WordPress.com page as a draft for review; does not publish it.",
    inputSchema: {
      title: z.string().min(1).describe("Page title"),
      content: z.string().describe("Page body; HTML accepted")
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async ({ title, content }) => {
    const data = await wp(accessToken, "/posts/new", {
      method: "POST", body: { title, content, status: "draft", type: "page" }
    });
    return { content: [{ type: "text", text: JSON.stringify({
      ID: data.ID, title: data.title, status: data.status, URL: data.URL,
      message: "Draft page created; it has not been published."
    }, null, 2) }] };
  });

  server.registerTool("wordpress_update_page", {
    description: "Update the title or content of an existing WordPress.com page by ID.",
    inputSchema: {
      page_id: z.number().int().describe("Numeric page ID"),
      title: z.string().optional().describe("Replacement title"),
      content: z.string().optional().describe("Replacement HTML content")
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async ({ page_id, title, content }) => {
    if (title === undefined && content === undefined) throw new Error("Provide title or content to update.");
    const existing = await wp(accessToken, `/posts/${encodeURIComponent(String(page_id))}/`);
    if (existing.type !== "page") throw new Error("The supplied ID is not a page.");
    const data = await wp(accessToken, `/posts/${encodeURIComponent(String(page_id))}/`, {
      method: "POST", body: { title, content }
    });
    return { content: [{ type: "text", text: JSON.stringify({
      ID: data.ID, title: data.title, status: data.status, URL: data.URL, modified: data.modified
    }, null, 2) }] };
  });

  server.registerTool("wordpress_list_categories", {
    description: "List available WordPress.com post categories and their IDs.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async () => {
    const data = await wp(accessToken, "/categories/?number=100");
    return { content: [{ type: "text", text: JSON.stringify((data.categories ?? []).map((c: any) => ({
      ID: c.ID, name: c.name, slug: c.slug, post_count: c.post_count
    })), null, 2) }] };
  });

  server.registerTool("wordpress_list_tags", {
    description: "List WordPress.com tags and their IDs.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async () => {
    const data = await wp(accessToken, "/tags/?number=100");
    return { content: [{ type: "text", text: JSON.stringify((data.tags ?? []).map((t: any) => ({
      ID: t.ID, name: t.name, slug: t.slug, post_count: t.post_count
    })), null, 2) }] };
  });

  server.registerTool("wordpress_list_media", {
    description: "List recent uploaded WordPress.com media items with IDs, URLs, captions and types.",
    inputSchema: { number: z.number().int().min(1).max(50).optional().describe("Number of media items, 1–50; default 20") },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async ({ number }) => {
    const data = await wp(accessToken, `/media/?number=${number ?? 20}&order_by=date&order=DESC`);
    return { content: [{ type: "text", text: JSON.stringify((data.media ?? []).map((m: any) => ({
      ID: m.ID, URL: m.URL, type: m.type, mime_type: m.mime_type, date: m.date,
      caption: m.caption, title: m.title
    })), null, 2) }] };
  });

  server.registerTool("wordpress_list_comments", {
    description: "List recent comments on the configured WordPress.com site, including approval status.",
    inputSchema: { number: z.number().int().min(1).max(50).optional().describe("Number of comments, 1–50; default 20") },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async ({ number }) => {
    const data = await wp(accessToken, `/comments/?number=${number ?? 20}&order_by=date&order=DESC`);
    return { content: [{ type: "text", text: JSON.stringify((data.comments ?? []).map((c: any) => ({
      ID: c.ID, post_ID: c.post_ID, author: c.author?.name, content: c.content,
      status: c.status, date: c.date, URL: c.URL
    })), null, 2) }] };
  });


  server.registerTool("wordpress_search_posts", {
    description: "Search WordPress.com posts and pages by keyword. Returns matching IDs, titles, URLs, statuses and types.",
    inputSchema: {
      query: z.string().min(1).describe("Keyword or phrase to search"),
      type: z.enum(["post", "page", "any"]).optional().describe("Content type; default any"),
      number: z.number().int().min(1).max(50).optional().describe("Maximum results; default 20")
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async ({ query, type, number }) => {
    const params = new URLSearchParams({ search: query, number: String(number ?? 20), order_by: "date", order: "DESC" });
    if (type && type !== "any") params.set("type", type);
    const data = await wp(accessToken, `/posts/?${params.toString()}`);
    return { content: [{ type: "text", text: JSON.stringify((data.posts ?? []).map((p: any) => ({
      ID: p.ID, title: p.title, URL: p.URL, status: p.status, type: p.type, modified: p.modified
    })), null, 2) }] };
  });

  server.registerTool("wordpress_create_category", {
    description: "Create a post category if the connected WordPress.com account and plan allow it.",
    inputSchema: {
      name: z.string().min(1).describe("Category name"),
      parent: z.number().int().optional().describe("Optional parent category ID")
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async ({ name, parent }) => {
    const data = await wp(accessToken, "/categories/new", { method: "POST", body: { name, parent } });
    return { content: [{ type: "text", text: JSON.stringify({
      ID: data.ID, name: data.name, slug: data.slug, parent: data.parent
    }, null, 2) }] };
  });

  server.registerTool("wordpress_create_tag", {
    description: "Create a post tag if the connected WordPress.com account and plan allow it.",
    inputSchema: { name: z.string().min(1).describe("Tag name") },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async ({ name }) => {
    const data = await wp(accessToken, "/tags/new", { method: "POST", body: { name } });
    return { content: [{ type: "text", text: JSON.stringify({
      ID: data.ID, name: data.name, slug: data.slug
    }, null, 2) }] };
  });

  server.registerTool("wordpress_trash_post", {
    description: "Move a post to trash by ID. This is a destructive content action; verify the ID before calling.",
    inputSchema: { post_id: z.number().int().describe("Numeric ID of the post to move to trash") },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
  }, async ({ post_id }) => {
    const existing = await wp(accessToken, `/posts/${encodeURIComponent(String(post_id))}/`);
    if (existing.type === "page") throw new Error("This ID is a page, not a post. Use wordpress_trash_page.");
    const data = await wp(accessToken, `/posts/${encodeURIComponent(String(post_id))}/`, {
      method: "POST", body: { status: "trash" }
    });
    return { content: [{ type: "text", text: JSON.stringify({
      ID: data.ID, title: data.title, status: data.status, message: "Trash request completed if supported by WordPress.com."
    }, null, 2) }] };
  });

  server.registerTool("wordpress_trash_page", {
    description: "Move a page to trash by ID. This is a destructive content action; verify the ID before calling.",
    inputSchema: { page_id: z.number().int().describe("Numeric ID of the page to move to trash") },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
  }, async ({ page_id }) => {
    const existing = await wp(accessToken, `/posts/${encodeURIComponent(String(page_id))}/`);
    if (existing.type !== "page") throw new Error("The supplied ID is not a page.");
    const data = await wp(accessToken, `/posts/${encodeURIComponent(String(page_id))}/`, {
      method: "POST", body: { status: "trash" }
    });
    return { content: [{ type: "text", text: JSON.stringify({
      ID: data.ID, title: data.title, status: data.status, message: "Trash request completed if supported by WordPress.com."
    }, null, 2) }] };
  });

  server.registerTool("wordpress_update_comment_status", {
    description: "Change a comment's moderation status if WordPress.com API permissions allow it.",
    inputSchema: {
      comment_id: z.number().int().describe("Numeric comment ID"),
      status: z.enum(["approved", "unapproved", "spam", "trash"]).describe("New moderation status")
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
  }, async ({ comment_id, status }) => {
    const data = await wp(accessToken, `/comments/${encodeURIComponent(String(comment_id))}/`, {
      method: "POST", body: { status }
    });
    return { content: [{ type: "text", text: JSON.stringify({
      ID: data.ID, post_ID: data.post_ID, status: data.status, message: "WordPress API response received."
    }, null, 2) }] };
  });

  server.registerTool("wordpress_get_comment", {
    description: "Retrieve one comment by numeric ID, including content, author, post ID and moderation status.",
    inputSchema: { comment_id: z.number().int().describe("Numeric comment ID") },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async ({ comment_id }) => {
    const data = await wp(accessToken, `/comments/${encodeURIComponent(String(comment_id))}/`);
    return { content: [{ type: "text", text: JSON.stringify({
      ID: data.ID, post_ID: data.post_ID, author: data.author?.name,
      content: data.content, status: data.status, date: data.date, URL: data.URL
    }, null, 2) }] };
  });

  server.registerTool("wordpress_get_media_item", {
    description: "Retrieve one media-library item by numeric ID, including its URL, caption, title and MIME type.",
    inputSchema: { media_id: z.number().int().describe("Numeric media ID") },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async ({ media_id }) => {
    const data = await wp(accessToken, `/media/${encodeURIComponent(String(media_id))}/`);
    return { content: [{ type: "text", text: JSON.stringify({
      ID: data.ID, URL: data.URL, type: data.type, mime_type: data.mime_type,
      title: data.title, caption: data.caption, description: data.description, date: data.date
    }, null, 2) }] };
  });

  server.registerTool("wordpress_site_tags_and_categories_summary", {
    description: "Return a compact summary of category and tag counts and names, subject to API access.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async () => {
    const [categories, tags] = await Promise.all([
      wp(accessToken, "/categories/?number=100"),
      wp(accessToken, "/tags/?number=100")
    ]);
    return { content: [{ type: "text", text: JSON.stringify({
      category_count: (categories.categories ?? []).length,
      categories: (categories.categories ?? []).map((c: any) => ({ ID: c.ID, name: c.name, slug: c.slug })),
      tag_count: (tags.tags ?? []).length,
      tags: (tags.tags ?? []).map((t: any) => ({ ID: t.ID, name: t.name, slug: t.slug }))
    }, null, 2) }] };
  });


  server.registerTool("wordpress_list_posts_filtered", {
    description: "List WordPress.com posts using optional status, content type and result limit filters.",
    inputSchema: {
      status: z.enum(["publish", "draft", "pending", "private", "future", "trash", "any"]).optional().describe("Optional post status filter"),
      type: z.enum(["post", "page", "any"]).optional().describe("Optional content type filter"),
      number: z.number().int().min(1).max(50).optional().describe("Maximum results; default 20")
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async ({ status, type, number }) => {
    const params = new URLSearchParams({ number: String(number ?? 20), order_by: "date", order: "DESC" });
    if (status && status !== "any") params.set("status", status);
    if (type && type !== "any") params.set("type", type);
    const data = await wp(accessToken, `/posts/?${params.toString()}`);
    return { content: [{ type: "text", text: JSON.stringify((data.posts ?? []).map((p: any) => ({
      ID: p.ID, title: p.title, URL: p.URL, status: p.status, type: p.type,
      date: p.date, modified: p.modified, excerpt: p.excerpt
    })), null, 2) }] };
  });

  server.registerTool("wordpress_update_post_details", {
    description: "Update supported post fields such as title, content, excerpt, slug or status. Publishing changes visibility immediately.",
    inputSchema: {
      post_id: z.number().int().describe("Numeric post ID"),
      title: z.string().optional().describe("New title"),
      content: z.string().optional().describe("New HTML content"),
      excerpt: z.string().optional().describe("New excerpt"),
      slug: z.string().optional().describe("URL slug"),
      status: z.enum(["draft", "publish", "pending", "private", "future"]).optional().describe("New status; publish makes it public")
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async ({ post_id, title, content, excerpt, slug, status }) => {
    if ([title, content, excerpt, slug, status].every(v => v === undefined)) throw new Error("Provide at least one field to update.");
    const existing = await wp(accessToken, `/posts/${encodeURIComponent(String(post_id))}/`);
    if (existing.type === "page") throw new Error("This ID is a page. Use a page-specific tool.");
    const data = await wp(accessToken, `/posts/${encodeURIComponent(String(post_id))}/`, {
      method: "POST", body: { title, content, excerpt, slug, status }
    });
    return { content: [{ type: "text", text: JSON.stringify({
      ID: data.ID, title: data.title, slug: data.slug, excerpt: data.excerpt,
      status: data.status, URL: data.URL, modified: data.modified
    }, null, 2) }] };
  });

  server.registerTool("wordpress_update_page_details", {
    description: "Update supported page fields such as title, content, excerpt, slug or status.",
    inputSchema: {
      page_id: z.number().int().describe("Numeric page ID"),
      title: z.string().optional().describe("New title"),
      content: z.string().optional().describe("New HTML content"),
      excerpt: z.string().optional().describe("New excerpt"),
      slug: z.string().optional().describe("URL slug"),
      status: z.enum(["draft", "publish", "pending", "private", "future"]).optional().describe("New status")
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async ({ page_id, title, content, excerpt, slug, status }) => {
    if ([title, content, excerpt, slug, status].every(v => v === undefined)) throw new Error("Provide at least one field to update.");
    const existing = await wp(accessToken, `/posts/${encodeURIComponent(String(page_id))}/`);
    if (existing.type !== "page") throw new Error("The supplied ID is not a page.");
    const data = await wp(accessToken, `/posts/${encodeURIComponent(String(page_id))}/`, {
      method: "POST", body: { title, content, excerpt, slug, status }
    });
    return { content: [{ type: "text", text: JSON.stringify({
      ID: data.ID, title: data.title, slug: data.slug, excerpt: data.excerpt,
      status: data.status, URL: data.URL, modified: data.modified
    }, null, 2) }] };
  });

  server.registerTool("wordpress_duplicate_post_as_draft", {
    description: "Copy an existing post's title and content into a new draft for safe editing.",
    inputSchema: { post_id: z.number().int().describe("ID of the post to copy") },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async ({ post_id }) => {
    const original = await wp(accessToken, `/posts/${encodeURIComponent(String(post_id))}/`);
    if (original.type === "page") throw new Error("This ID is a page, not a post.");
    const data = await wp(accessToken, "/posts/new", {
      method: "POST", body: { title: original.title ? `Copy of ${original.title}` : "Copy of post", content: original.content ?? "", excerpt: original.excerpt ?? "", status: "draft" }
    });
    return { content: [{ type: "text", text: JSON.stringify({
      original_ID: original.ID, new_ID: data.ID, title: data.title, status: data.status,
      message: "A separate draft copy was created; the original post was not changed."
    }, null, 2) }] };
  });

  server.registerTool("wordpress_update_media_item", {
    description: "Update a media item's title, caption or description where the WordPress.com API permits it.",
    inputSchema: {
      media_id: z.number().int().describe("Numeric media ID"),
      title: z.string().optional().describe("New media title"),
      caption: z.string().optional().describe("New caption"),
      description: z.string().optional().describe("New description")
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async ({ media_id, title, caption, description }) => {
    if ([title, caption, description].every(v => v === undefined)) throw new Error("Provide title, caption or description.");
    const data = await wp(accessToken, `/media/${encodeURIComponent(String(media_id))}/`, {
      method: "POST", body: { title, caption, description }
    });
    return { content: [{ type: "text", text: JSON.stringify({
      ID: data.ID, URL: data.URL, title: data.title, caption: data.caption,
      description: data.description, mime_type: data.mime_type
    }, null, 2) }] };
  });

  server.registerTool("wordpress_list_post_types", {
    description: "List content types exposed by the configured WordPress.com site, subject to API access.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async () => {
    const data = await wp(accessToken, "/types");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool("wordpress_list_taxonomies", {
    description: "List taxonomies exposed by the configured WordPress.com site, subject to API access.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async () => {
    const data = await wp(accessToken, "/taxonomies");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool("wordpress_create_post_draft_with_excerpt", {
    description: "Create a post draft with title, HTML content and optional excerpt; does not publish.",
    inputSchema: {
      title: z.string().min(1).describe("Post title"),
      content: z.string().describe("Post body; HTML accepted"),
      excerpt: z.string().optional().describe("Optional summary/excerpt")
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async ({ title, content, excerpt }) => {
    const data = await wp(accessToken, "/posts/new", {
      method: "POST", body: { title, content, excerpt, status: "draft", type: "post" }
    });
    return { content: [{ type: "text", text: JSON.stringify({
      ID: data.ID, title: data.title, excerpt: data.excerpt, status: data.status,
      URL: data.URL, message: "Draft created, not published."
    }, null, 2) }] };
  });


  server.registerTool("wordpress_duplicate_page_as_draft", {
    description: "Copy an existing page's title and content into a new draft page for safe editing.",
    inputSchema: { page_id: z.number().int().describe("ID of the page to copy") },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async ({ page_id }) => {
    const original = await wp(accessToken, `/posts/${encodeURIComponent(String(page_id))}/`);
    if (original.type !== "page") throw new Error("The supplied ID is not a page.");
    const data = await wp(accessToken, "/posts/new", {
      method: "POST", body: {
        title: original.title ? `Copy of ${original.title}` : "Copy of page",
        content: original.content ?? "", excerpt: original.excerpt ?? "",
        status: "draft", type: "page"
      }
    });
    return { content: [{ type: "text", text: JSON.stringify({
      original_ID: original.ID, new_ID: data.ID, title: data.title, status: data.status,
      message: "A separate draft page was created; the original page was not changed."
    }, null, 2) }] };
  });

  server.registerTool("wordpress_search_media", {
    description: "Search the site's media library by keyword when supported by the WordPress.com API.",
    inputSchema: {
      query: z.string().min(1).describe("Keyword to search in media titles"),
      number: z.number().int().min(1).max(50).optional().describe("Maximum results; default 20")
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async ({ query, number }) => {
    const params = new URLSearchParams({ search: query, number: String(number ?? 20) });
    const data = await wp(accessToken, `/media/?${params.toString()}`);
    const items = data.media ?? data.files ?? [];
    return { content: [{ type: "text", text: JSON.stringify(items.map((m: any) => ({
      ID: m.ID, title: m.title, URL: m.URL, mime_type: m.mime_type,
      date: m.date, width: m.width, height: m.height
    })), null, 2) }] };
  });

  server.registerTool("wordpress_list_comments_filtered", {
    description: "List comments with an optional moderation status and result limit.",
    inputSchema: {
      status: z.enum(["approved", "unapproved", "spam", "trash", "all"]).optional().describe("Moderation status filter"),
      number: z.number().int().min(1).max(50).optional().describe("Maximum results; default 20")
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async ({ status, number }) => {
    const params = new URLSearchParams({ number: String(number ?? 20) });
    if (status && status !== "all") params.set("status", status);
    const data = await wp(accessToken, `/comments/?${params.toString()}`);
    const comments = data.comments ?? [];
    return { content: [{ type: "text", text: JSON.stringify(comments.map((c: any) => ({
      ID: c.ID, post: c.post, author: c.author, date: c.date,
      content: c.content, status: c.status, URL: c.URL
    })), null, 2) }] };
  });

  server.registerTool("wordpress_get_site_stats_summary", {
    description: "Retrieve a WordPress.com site statistics summary if the account and plan expose stats through the API.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async () => {
    const data = await wp(accessToken, "/stats");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool("wordpress_get_site_stats_visits", {
    description: "Retrieve daily visits statistics for the configured site when available to the connected account.",
    inputSchema: {
      period: z.enum(["day", "week", "month", "year"]).optional().describe("Statistics period; default day"),
      date: z.string().optional().describe("Optional date or period start accepted by WordPress.com stats API")
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async ({ period, date }) => {
    const params = new URLSearchParams();
    if (period) params.set("period", period);
    if (date) params.set("date", date);
    const suffix = params.size ? `?${params.toString()}` : "";
    const data = await wp(accessToken, `/stats/visits${suffix}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool("wordpress_get_top_posts_stats", {
    description: "Retrieve top posts/pages from WordPress.com stats if stats access is available.",
    inputSchema: {
      period: z.enum(["day", "week", "month", "year"]).optional().describe("Statistics period"),
      date: z.string().optional().describe("Optional date accepted by the stats API")
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async ({ period, date }) => {
    const params = new URLSearchParams();
    if (period) params.set("period", period);
    if (date) params.set("date", date);
    const suffix = params.size ? `?${params.toString()}` : "";
    const data = await wp(accessToken, `/stats/top-posts${suffix}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool("wordpress_create_page_draft_with_excerpt", {
    description: "Create a page draft with title, HTML content and optional excerpt; does not publish.",
    inputSchema: {
      title: z.string().min(1).describe("Page title"),
      content: z.string().describe("Page body; HTML accepted"),
      excerpt: z.string().optional().describe("Optional summary/excerpt")
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async ({ title, content, excerpt }) => {
    const data = await wp(accessToken, "/posts/new", {
      method: "POST", body: { title, content, excerpt, status: "draft", type: "page" }
    });
    return { content: [{ type: "text", text: JSON.stringify({
      ID: data.ID, title: data.title, excerpt: data.excerpt, status: data.status,
      URL: data.URL, message: "Draft page created, not published."
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

  const rpcMethod = getRpcMethod(req.body);
  const discoveryMethods = new Set(["initialize", "notifications/initialized", "ping", "tools/list"]);
  const isDiscoveryRequest = discoveryMethods.has(rpcMethod);

  // The inbound bearer authenticates the MCP client to this server; it is NOT a WordPress.com token.
  // Use the server-side WordPress.com access token for all WordPress API calls.
  if (!bearer && !isDiscoveryRequest) {
    res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${RESOURCE_METADATA}"`);
    return res.status(401).json({ error: "OAuth authorization is required to call WordPress tools." });
  }

  const tokenForHandlers = process.env.WORDPRESS_ACCESS_TOKEN ?? "";
  if (!tokenForHandlers && !isDiscoveryRequest) {
    return res.status(500).json({ error: "Missing WORDPRESS_ACCESS_TOKEN environment variable." });
  }

  try {
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
