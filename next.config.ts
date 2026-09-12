import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output supports desktop packaging of local Next server artifacts.
  // Does not remove or break `next start` / production web deployment.
  output: "standalone",
  serverExternalPackages: ['@huggingface/transformers', 'onnxruntime-node'],
};

export default nextConfig;
