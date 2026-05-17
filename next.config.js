/** @type {import('next').NextConfig} */
const path = require('path');
const fs = require('fs');

const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Copy pdf.js worker to public on every build so it's always up to date
      const src = path.join(__dirname, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs');
      const dest = path.join(__dirname, 'public/pdf.worker.min.mjs');
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
      }
    }
    return config;
  },
};

module.exports = nextConfig;
