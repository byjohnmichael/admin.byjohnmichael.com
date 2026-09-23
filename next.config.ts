import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the dev server be tested from other devices on the LAN/Tailscale
  // instead of only localhost.
  allowedDevOrigins: [
    "192.168.86.31",
    "100.88.192.72",
    "admin.byjohnmichael.com",
  ],
  // bob-the-orb is a local sibling package (../bob-the-orb, installed via
  // "file:../bob-the-orb") — its node_modules entry is a symlink pointing
  // outside this project's own directory. Turbopack sandboxes resolution to
  // a project root and refuses to follow a symlink that escapes it
  // ("Symlink [project]/node_modules is invalid, it points out of the
  // filesystem root") unless that root is widened to cover both projects'
  // common parent. Plain Node resolution found the package fine the whole
  // time — this is purely a Turbopack root boundary, not a broken package.
  turbopack: {
    root: path.resolve(process.cwd(), ".."),
  },
  experimental: {
    // proxy.ts (src/proxy.ts) runs on every route, including
    // /api/mc/trailers — Next buffers the request body in memory to let both
    // proxy.ts and the route handler read it, and silently truncates past
    // this limit (no error) rather than rejecting the request. Trailer
    // uploads are full episode videos, so the 10MB default is far too small.
    proxyClientMaxBodySize: "500mb",
  },
};

export default nextConfig;

// byjohnmichael*
