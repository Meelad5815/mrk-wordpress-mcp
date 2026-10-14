import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHmac, timingSafeEqual } from "node:crypto";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const clientId = process.env.WORDPRESS_CLIENT_ID;
  const clientSecret = process.env.WORDPRESS_CLIENT_SECRET;
  const redirectUri = process.env.WORDPRESS_REDIRECT_URI;
  const stateSecret = process.env.OAUTH_STATE_SECRET;
  if (!clientId || !clientSecret || !redirectUri || !stateSecret) {
    return res.status(500).send("Missing WordPress OAuth environment variables. Check Vercel project settings.");
  }
  if (typeof req.query.error === "string") {
    return res.status(400).send(`WordPress authorization failed: ${escapeHtml(req.query.error)}`);
  }
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const returnedState = typeof req.query.state === "string" ? req.query.state : "";
  const cookieHeader = req.headers.cookie ?? "";
  const cookieMatch = cookieHeader.match(/(?:^|;\\s*)mrk_wp_oauth_state=([^;]+)/);
  const cookieValue = cookieMatch ? decodeURIComponent(cookieMatch[1]) : "";
  const [cookieState, cookieSignature] = cookieValue.split(".");
  if (!code || !returnedState || !cookieState || !cookieSignature || returnedState !== cookieState) {
    return res.status(400).send("OAuth state validation failed. Start again from /api/oauth-start.");
  }
  const expected = createHmac("sha256", stateSecret).update(cookieState).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(cookieSignature, "hex"); } catch { supplied = Buffer.alloc(0); }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return res.status(400).send("OAuth state signature is invalid. Start again from /api/oauth-start.");
  }
  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code
    });
    const response = await fetch("https://public-api.wordpress.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body
    });
    const result: any = await response.json();
    if (!response.ok || !result.access_token) {
      return res.status(502).send(`Token exchange failed: ${escapeHtml(result.error_description || result.error || `HTTP ${response.status}`)}`);
    }
    res.setHeader("Set-Cookie", "mrk_wp_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/oauth-callback; Max-Age=0");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>MRK WordPress OAuth</title></head><body style="font:16px system-ui;max-width:760px;margin:40px auto;padding:0 20px"><h1>WordPress.com authorization successful</h1><p>Copy the access token below and save it in Vercel as <code>WORDPRESS_ACCESS_TOKEN</code>. Do not share it or commit it to GitHub.</p><textarea readonly style="width:100%;height:120px" onclick="this.select()"> ${escapeHtml(result.access_token)} </textarea><p>After saving the token, redeploy the Vercel project. You can then close this page.</p></body></html>`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).send(`OAuth token exchange error: ${escapeHtml(message)}`);
  }
}
