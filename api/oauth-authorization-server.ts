export default function handler(_req: any, res: any) {
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).json({
    issuer: "https://mrk-wordpress-mcp.vercel.app",
    authorization_endpoint: "https://public-api.wordpress.com/oauth2/authorize",
    token_endpoint: "https://public-api.wordpress.com/oauth2/token",
    token_endpoint_auth_methods_supported: ["client_secret_post"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["global"]
  });
}
