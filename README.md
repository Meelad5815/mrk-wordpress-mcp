# MRK WordPress MCP

A separate MCP server for a WordPress.com site. This repository is independent of the Blogger MCP project.

## Current tools

- `wordpress_site_info` — read site details
- `wordpress_list_posts` — list recent posts
- `wordpress_get_post` — read one post
- `wordpress_create_draft` — create a draft only; does not publish
- `wordpress_update_post` — update an existing post

## Deploy to Vercel

1. Import this repository into Vercel.
2. Use the project root as-is. Vercel detects the Node.js function in `api/mcp.ts`.
3. Add the environment variables below in Vercel Project Settings → Environment Variables.
4. Redeploy after adding or changing environment variables.

Required environment variables:

- `WORDPRESS_ACCESS_TOKEN` — OAuth access token for the WordPress.com account that owns or can edit the site.
- `WORDPRESS_SITE` — site address, e.g. `hafizmuhammadmeeladraza.wordpress.com` (no protocol).
- `MCP_SERVER_SECRET` — a long, random secret used to protect the MCP endpoint.

Do not commit tokens, app secrets, passwords, or `.env` files to GitHub.

## WordPress.com API authorization

Create/register an application at https://developer.wordpress.com/apps/ and set its Redirect URL to:

`https://YOUR-VERCEL-PROJECT.vercel.app/api/oauth-callback`

Add these Vercel Environment Variables: `WORDPRESS_CLIENT_ID`, `WORDPRESS_CLIENT_SECRET`, `WORDPRESS_REDIRECT_URI` (the exact callback URL above), and `OAUTH_STATE_SECRET` (a long random secret). Keep all credentials encrypted/sensitive. After deploying, visit `https://YOUR-VERCEL-PROJECT.vercel.app/api/oauth-start`, sign in to WordPress.com, and authorize the app. The callback displays the access token once. Copy it directly into Vercel as `WORDPRESS_ACCESS_TOKEN`, then redeploy. The account must grant the access required for the site.

WordPress.com plan/API limitations still apply. A custom MCP server does not bypass WordPress.com permissions or paid-plan restrictions.

## ChatGPT connection

After deployment, configure a custom remote MCP connector using:

`https://YOUR-VERCEL-PROJECT.vercel.app/api/mcp`

Configure HTTP Bearer authentication using the same value as `MCP_SERVER_SECRET`. If your ChatGPT plan or workspace does not offer custom MCP connectors, the server can still be deployed, but it cannot be added through that unavailable feature.

## Security notes

- Keep this repository private if possible.
- Never share the OAuth access token or MCP server secret in chat, screenshots, source files, or Git commits.
- The MCP endpoint must be protected by Bearer authentication before connecting it to ChatGPT.
- Draft creation is the default publishing workflow. Review drafts before publishing them.
