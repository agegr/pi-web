/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ["@mariozechner/pi-coding-agent", "@mariozechner/pi-ai"],
    outputFileTracingIncludes: {
      '*': ['public/**/*', '.next/static/**/*'],
    },
  },
};

export default nextConfig;
