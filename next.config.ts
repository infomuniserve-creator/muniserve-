import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Home directory has other projects' package-lock.json files that
  // Turbopack's workspace-root detection was picking up on. Pinning this
  // explicitly stops it from guessing.
  turbopack: {
    root: path.join(__dirname),
  },

  /**
   * frame-ancestors (CLAUDE.md 7o follow-up) -- until now, no page in
   * this app set any framing policy at all, meaning /dashboard, /admin,
   * and /login were all embeddable by any external site with zero
   * restriction (a real clickjacking exposure on authenticated staff
   * pages, not previously noticed because nothing needed embedding
   * before). Adding the iframe-embed feature for /apply was the moment
   * to fix that properly rather than leave everything else wide open:
   *
   * - Default (every route): frame-ancestors 'self' -- nothing needs to
   *   be framed by a third-party site except /apply.
   * - /apply specifically: frame-ancestors * -- the whole point of this
   *   feature is letting any client LGU embed their own form on their
   *   own website, and there's no fixed allowlist of client domains to
   *   restrict this to (see src/lib/embed.ts).
   *
   * X-Frame-Options is deliberately not set here -- it's been superseded
   * by CSP's frame-ancestors (better browser support per Next's own
   * headers doc), and setting both risks inconsistent enforcement across
   * browsers when they disagree on which one to honor.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self'" }],
      },
      {
        source: "/apply",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }],
      },
    ];
  },
};

export default nextConfig;
