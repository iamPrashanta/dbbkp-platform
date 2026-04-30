/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@dbbkp/api", "@dbbkp/db", "@dbbkp/trpc"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:4000/api/:path*",
      },
      {
        source: "/trpc/:path*",
        destination: "http://localhost:4000/trpc/:path*",
      },
    ];
  },
};

module.exports = nextConfig;
