import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the dev server be tested from other devices on the LAN/Tailscale
  // instead of only localhost.
  allowedDevOrigins: ["192.168.86.31", "100.88.192.72"],
};

export default nextConfig;
