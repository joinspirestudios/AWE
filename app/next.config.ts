import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@app/scene', '@app/ai', '@app/editor', '@app/shared'],
}

export default nextConfig
