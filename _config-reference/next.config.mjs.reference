/** @type {import('next').NextConfig} */
const nextConfig = {
  // NOTE: Do NOT add "mysql2" to serverExternalPackages.
  // When mysql2 is treated as an external package, Next.js copies it into
  // .next/node_modules and relies on file tracing to bring along its transitive
  // deps. On some hosts (e.g. Hostinger/LiteSpeed) the tracer misses a nested
  // dependency — "sql-escaper" — and every DB route crashes at load with
  // "Cannot find module 'sql-escaper'". Letting Turbopack bundle mysql2 (pure JS,
  // no native bindings) inlines all of its dependencies and avoids the issue.
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  experimental: {
    // Run Turbopack's PostCSS/loader plugins in worker threads instead of
    // spawned `node` child processes. Shared hosts with process limits
    // (Hostinger/CloudLinux) kill those children, failing app/globals.css with
    // "node process exited before we could connect to it".
    turbopackPluginRuntimeStrategy: 'workerThreads',
    // proxy.ts matches /api/:path*, so request bodies are buffered through
    // the proxy. The 10 MB default truncated uploads that the UI allows (20 MB).
    proxyClientMaxBodySize: '25mb',
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
          // The ERP is an authenticated app; it must never be framed off-origin
          // (clickjacking). Same-origin framing stays allowed for in-app previews.
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          // Deny powerful APIs the app does not use. Microphone stays available
          // to the same origin for the Twilio voice (calls) module.
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(self), payment=(), usb=()' },
          // Content-Security-Policy is NOT set here: it needs a per-request
          // script nonce, which proxy.ts generates (see lib/security/csp.ts).
          // Setting it in both places would send two policies and the browser
          // would enforce the intersection.
        ],
      },
    ]
  },
}

export default nextConfig
