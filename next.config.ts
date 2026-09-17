import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Installed and local Terra use 127.0.0.1; Next 16 blocks that origin from /_next HMR unless listed.
  allowedDevOrigins: ["127.0.0.1"],
  // Standalone output supports desktop packaging of local Next server artifacts.
  // Does not remove or break `next start` / production web deployment.
  output: "standalone",
  serverExternalPackages: ['@huggingface/transformers', 'onnxruntime-node'],
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
