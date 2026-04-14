import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // reactCompiler: true, // disabled: causes Turbopack FATAL panics
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
