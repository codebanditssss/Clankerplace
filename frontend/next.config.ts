import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  // SQLite is runtime state, never a deploy artifact. Vercel uses an
  // ephemeral /tmp database for the public demo; the VM mounts persistent
  // data separately.
  outputFileTracingExcludes: {
    "/*": ["./data/**/*"],
  },
};

export default nextConfig;
