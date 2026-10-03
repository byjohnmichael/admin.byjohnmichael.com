import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the dev server be tested from other devices on the LAN/Tailscale
  // instead of only localhost.
  allowedDevOrigins: [
    "192.168.86.31",
    "100.88.192.72",
    "admin.byjohnmichael.com",
  ],
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
