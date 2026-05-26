/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
    // `msedge-tts` opens a WebSocket via the `ws` package + Node net
    // primitives. Webpack's default RSC/module-wrapping breaks the
    // WebSocket handshake and `MsEdgeTTS.setMetadata()` hangs forever.
    // Externalising the package tells Next/webpack to leave it as a
    // plain Node require, identical to running it in a standalone script.
    // (Next 15: rename to top-level `serverExternalPackages`.)
    serverComponentsExternalPackages: ['msedge-tts', 'ws']
  }
};

export default nextConfig;
