import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@fullcalendar/core",
    "@fullcalendar/react",
    "@fullcalendar/timegrid",
    "@fullcalendar/resource",
    "@fullcalendar/resource-timegrid",
    "@fullcalendar/interaction",
    "@fullcalendar/daygrid",
  ],
  webpack: (config) => {
    config.resolve.alias["@fullcalendar/core/preact.js"] =
      require.resolve("@fullcalendar/core/preact.js");
    return config;
  },
  async headers() {
    return [
      // COOP blocks Google Sign-In popup postMessage. Removed to fix "Cross-Origin-Opener-Policy
      // policy would block the window.postMessage call". Re-add only for routes that need it.
      // {
      //   source: "/:path*",
      //   headers: [{ key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" }],
      // },
    ];
  },
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
    return [
      {
        source: "/api/v1/:path*",
        destination: `${apiUrl}/api/v1/:path*`,
      },
      {
        source: "/uploads/:path*",
        destination: `${apiUrl}/uploads/:path*`,
      },
      {
        source: "/socket.io/:path*",
        destination: `${apiUrl}/socket.io/:path*`,
      },
    ];
  },
};

export default nextConfig;
