/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  assetPrefix: process.env.BASE_PATH || "",
  basePath: process.env.BASE_PATH || "",
  trailingSlash: true,
  publicRuntimeConfig: {
    root: process.env.BASE_PATH || "",
  },
  // Upstream @pixiv/three-vrm-core@1.0.9 publishes incomplete .d.ts files
  // (only types/lookAt/utils/calcAzimuthAltitude.d.ts is included), so the
  // project's imports of VRMExpressionManager/VRMHumanBoneName/etc. fail
  // type-check even though the runtime exports are intact. Tracked in
  // docs/upstream-baseline.md — revisit by upgrading to three-vrm 3.x.
  typescript: { ignoreBuildErrors: true },
};

module.exports = nextConfig;
