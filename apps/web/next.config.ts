import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages export TypeScript source.
  transpilePackages: ['@nabvy/contracts'],
  // Listing photos stay off until the owner decides on Facebook photo URLs (docs/questions.md),
  // so no remote image hosts are allowed.
  images: { remotePatterns: [] },
  // forbidden() and unauthorized() render app/forbidden.tsx (403) and app/unauthorized.tsx (401),
  // so the session helpers' failures get their own pages (task 4.1b).
  experimental: { authInterrupts: true },
}

export default nextConfig
