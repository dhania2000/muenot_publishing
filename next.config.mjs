/** @type {import('next').NextConfig} */
const nextConfig = {
  // Hostinger runs Next.js from .next/standalone/server.js.
  output: 'standalone',
  images: { unoptimized: true },
  // Self-hosted OCR (Phase 3 Task 5): Tesseract.js spawns a worker thread from its own files and loads
  // a WASM core, so it must stay a runtime require, and the worker/core/language files must be traced
  // into the standalone output.
  serverExternalPackages: ['tesseract.js', 'tesseract.js-core', 'pdfjs-dist', '@napi-rs/canvas'],
  outputFileTracingIncludes: {
    '/api/**': ['./scripts/math-ocr-worker.py', './models/math/model-lock.json'],
    '/api/alt-text/**': [
      './scripts/math-ocr-worker.py',
      './models/math/model-lock.json',
      './node_modules/tesseract.js/src/worker-script/**',
      './node_modules/tesseract.js-core/*.{js,wasm}',
      './node_modules/@tesseract.js-data/eng/4.0.0_best_int/**',
      './node_modules/@tesseract.js-data/hin/4.0.0_best_int/**',
      './node_modules/pdfjs-dist/legacy/build/**',
      './node_modules/pdfjs-dist/wasm/**',
      './node_modules/pdfjs-dist/standard_fonts/**',
      './node_modules/pdfjs-dist/cmaps/**',
      './node_modules/@napi-rs/canvas*/**',
      './node_modules/.pnpm/tesseract.js@*/node_modules/tesseract.js/src/worker-script/**',
      './node_modules/.pnpm/tesseract.js-core@*/node_modules/tesseract.js-core/*.{js,wasm}',
      './node_modules/.pnpm/@tesseract.js-data+eng@*/node_modules/@tesseract.js-data/eng/4.0.0_best_int/**',
      './node_modules/.pnpm/@tesseract.js-data+hin@*/node_modules/@tesseract.js-data/hin/4.0.0_best_int/**',
      './node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/{legacy/build,wasm,standard_fonts,cmaps}/**',
      './node_modules/.pnpm/@napi-rs+canvas*@*/node_modules/@napi-rs/canvas*/**',
    ],
  },
  experimental: {
    // Uploads allow up to MAX_UPLOAD_MB (default 50 MB).
    serverActions: { bodySizeLimit: '60mb' },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
        ],
      },
    ]
  },
}

export default nextConfig
