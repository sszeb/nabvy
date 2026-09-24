import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Listing photos stay off until the owner decides on Facebook photo URLs (docs/questions.md),
  // so no remote image hosts are allowed.
  images: { remotePatterns: [] },
}

export default nextConfig
