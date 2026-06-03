import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TS source (no build step); Turbopack transpiles them.
  transpilePackages: [
    "@vhpce/profile-schema",
    "@vhpce/perf-models",
    "@vhpce/explain",
    "@vhpce/viz",
  ],
};

export default nextConfig;
