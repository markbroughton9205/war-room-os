import type { NextConfig } from "next";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url)

function optionalPkg(name: string): string | undefined {
  try {
    return require.resolve(name)
  } catch {
    return undefined
  }
}

const jsfiveEntry = optionalPkg('jsfive')

const nextConfig: NextConfig = {
  experimental: { cpus: 2, webpackMemoryOptimizations: true, turbopackMemoryLimit: 4 * 1024 * 1024 * 1024 },
  // Isolate `next build` from a live `next dev` server on the default `.next` directory.
  ...(process.env.WAR_ROOM_NEXT_DIST_DIR ? { distDir: process.env.WAR_ROOM_NEXT_DIST_DIR } : {}),
  // Installed and local Terra use 127.0.0.1; Next 16 blocks that origin from /_next HMR unless listed.
  allowedDevOrigins: ["127.0.0.1"],
  // Standalone output supports desktop packaging of local Next server artifacts.
  // Does not remove or break `next start` / production web deployment.
  output: "standalone",
  outputFileTracingExcludes: {
    // `*` does not match nested routes, so ephemeral files stayed in those traces
    // and standalone copy failed after the lock or electron temp dir was removed.
    '*': [
      'desktop/dist-release/**',
      'desktop/dist/**',
      'desktop/runtime/**',
      'tmp/**',
      '.tmp/**',
      '.war-room/locks/**',
      '**/linux-unpacked.tmp/**',
    ],
    '**/*': [
      'desktop/dist-release/**',
      'desktop/dist/**',
      'desktop/runtime/**',
      'tmp/**',
      '.tmp/**',
      '.war-room/locks/**',
      '**/linux-unpacked.tmp/**',
    ],
  },
  serverExternalPackages: ['@huggingface/transformers', 'onnxruntime-node', 'jsfive', 'playwright', 'playwright-core', '@playwright/test'],
  ...(jsfiveEntry
    ? {
        turbopack: {
          resolveAlias: {
            jsfive: path.relative(/* turbopackIgnore: true */ process.cwd(), jsfiveEntry),
          },
        },
      }
    : {}),
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
