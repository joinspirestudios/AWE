import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@app/scene', '@app/ai', '@app/editor', '@app/shared'],
  // Konva (used by react-konva on the editor page) has a Node-only entry
  // point that imports the native `canvas` package. Even with 'use client'
  // on the page, webpack still parses the import graph during server
  // bundling and fails when `canvas` can't be resolved. Mark it as
  // external on the server side — the page never actually runs on the
  // server, so the externalization is safe.
  // Ref: https://github.com/konvajs/konva/issues/1458
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals || []), { canvas: 'canvas' }]
    }
    return config
  },
}

export default nextConfig
