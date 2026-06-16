/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow maplibre-gl to work with webpack
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      'mapbox-gl': 'maplibre-gl',
    };
    return config;
  },
};

module.exports = nextConfig;
