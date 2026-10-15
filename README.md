# MRK WordPress MCP

A separate MCP server for a WordPress.com site. This repository is independent of the Blogger MCP project.

## Current tools

- `wordpress_site_info` — read site details
- `wordpress_list_posts` — list recent posts
- `wordpress_get_post` — read one post
- `wordpress_create_draft` — create a draft only; does not publish
- `wordpress_update_post` — update an existing post
- `wordpress_publish_post` — publish an existing draft post
- `wordpress_list_pages` / `wordpress_get_page` — browse and read pages
- `wordpress_create_draft_page` / `wordpress_update_page` — create draft pages and update page content
- `wordpress_list_categories` / `wordpress_list_tags` — inspect categories and tags
- `wordpress_list_media` — list uploaded media and image URLs
- `wordpress_list_comments` — inspect recent comments and moderation status
- `wordpress_search_posts` — search posts and pages by keyword
- `wordpress_create_category` / `wordpress_create_tag` — create categories and tags when permitted
- `wordpress_trash_post` / `wordpress_trash_page` — move content to trash (destructive)
- `wordpress_get_comment` / `wordpress_update_comment_status` — read a comment and moderate its status when permitted
- `wordpress_get_media_item` — inspect a media item by ID
- `wordpress_site_tags_and_categories_summary` — get a combined taxonomy summary
- `wordpress_list_posts_filtered` — filter content by status and type
- `wordpress_update_post_details` / `wordpress_update_page_details` — update excerpt, slug and status in addition to title/content
- `wordpress_duplicate_post_as_draft` — safely copy an existing post into a new draft
- `wordpress_update_media_item` — update media title, caption and description when permitted
- `wordpress_list_post_types` / `wordpress_list_taxonomies` — inspect content types and taxonomies
- `wordpress_create_post_draft_with_excerpt` — create a draft with an excerpt

## Deploy to Vercel

The Vercel project is linked to this repository and deploys automatically from `main`.

Required environment variables:

- `WORDPRESS_SITE` — site address, e.g. `hafizmuhammadmeeladraza.wordpress.com` (no protocol).
- `WORDPRESS_ACCESS_TOKEN` — optional legacy fallback token used only when the old `MCP_SERVER_SECRET` is sent.
- `MCP_SERVER_SECRET` — optional legacy bearer secret for backwards compatibility. ChatGPT's OAuth connection should use a WordPress OAuth access token instead.

Do not commit tokens, app secrets, passwords, or `.env` files to GitHub.

## OAuth discovery for ChatGPT

The server publishes:

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-authorization-server`

The authorization server metadata uses WordPress.com's OAuth 2.1 endpoints with PKCE and dynamic client registration:

- `https://public-api.wordpress.com/oauth2-1/register`
- `https://public-api.wordpress.com/oauth2-1/authorize`
- `https://public-api.wordpress.com/oauth2-1/token`

The MCP endpoint accepts the resulting WordPress OAuth bearer token and uses it for WordPress API calls. No WordPress client secret should be pasted into the MCP endpoint or shared in chat.

## ChatGPT connection

MCP URL:

`https://mrk-wordpress-mcp.vercel.app/api/mcp`

In ChatGPT's custom MCP connection dialog, choose OAuth and let it discover the settings. If discovery was attempted before the latest deployment, close the dialog and add the server again after the deployment is ready.

WordPress.com account permissions and plan/API limitations still apply.

## Security notes

- Keep this repository private if possible.
- Never share OAuth access tokens, client secrets, or server secrets in chat, screenshots, source files, or Git commits.
- The server includes both draft-only creation tools and an explicit publish tool. Review content carefully before publishing; trash and moderation tools can change existing site content.
