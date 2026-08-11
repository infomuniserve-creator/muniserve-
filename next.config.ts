import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Home directory has other projects' package-lock.json files that
  // Turbopack's workspace-root detection was picking up on. Pinning this
  // explicitly stops it from guessing.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
