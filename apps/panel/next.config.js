/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@dbbkp/api", "@dbbkp/db", "@dbbkp/trpc"],
};

module.exports = nextConfig;
