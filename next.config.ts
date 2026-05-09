import type { NextConfig } from "next";

// Dev-only: bypass SSL cert verification (antivirus/VPN intercepts HTTPS)
if (process.env.NODE_ENV === 'development') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
}

const nextConfig: NextConfig = {
  /* config options here */
  // reactCompiler: true, // disabled: causes Turbopack FATAL panics
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
