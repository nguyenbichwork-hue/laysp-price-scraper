/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // exceljs & cheerio chạy server-side (Node runtime), không bundle vào client
  experimental: {
    serverComponentsExternalPackages: ['exceljs', 'cheerio'],
  },
};

export default nextConfig;
