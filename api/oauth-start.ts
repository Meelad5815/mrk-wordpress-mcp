import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHmac, randomBytes } from "node:crypto";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  const clientId = process.env.WORDPRESS_CLIENT_ID;
  const redirectUri = process.env.WORDPRESS_REDIRECT_URI;
  const stateSecret = process.env.OAUTH_STATE_SECRET;
  if (!clientId || !redirectUri || !stateSecret) {
    return res.status(500).send("Missing WORDPRESS_CLIENT_ID, WORDPRESS_REDIRECT_URI, or OAUTH_STATE_SECRET.");
  }
  const state = randomBytes(24).toString("hex");
  const signature = createHmac("sha256", stateSecret).update(state).digest("hex");
  res.setHeader("Set-Cookie", `mrk_wp_oauth_state=${state}.${signature}; HttpOnly; Secure; SameSite=Lax; Path=/api/oauth-callback; Max-Age=600`);
  const authorize = new URL("https://public-api.wordpress.com/oauth2/authorize");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "global");
  authorize.searchParams.set("state", state);
  return res.redirect(302, authorize.toString());
}
