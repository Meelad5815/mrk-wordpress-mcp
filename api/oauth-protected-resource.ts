export default function handler(_req: any, res: any) {
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).json({
    resource: "https://mrk-wordpress-mcp.vercel.app",
    authorization_servers: ["https://mrk-wordpress-mcp.vercel.app"],
    scopes_supported: ["global"],
    resource_documentation: "https://github.com/Meelad5815/mrk-wordpress-mcp"
  });
}
