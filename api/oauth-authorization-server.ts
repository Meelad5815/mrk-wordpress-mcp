export default function handler(_req: any, res: any) {
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).json({
    issuer: "https://mrk-wordpress-mcp.vercel.app",
    authorization_endpoint: "https://public-api.wordpress.com/oauth2-1/authorize",
    token_endpoint: "https://public-api.wordpress.com/oauth2-1/token",
    registration_endpoint: "https://public-api.wordpress.com/oauth2-1/register",
    token_endpoint_auth_methods_supported: ["none"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["global"]
  });
}
