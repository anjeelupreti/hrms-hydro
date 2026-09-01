import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tree-shake the big barrel packages (MUI especially) so dev compiles and
  // prod bundles only pull the icons/components actually imported, instead of
  // the whole package. This is a major dev-server compile-time win.
  experimental: {
    optimizePackageImports: [
      "@mui/material",
      "@mui/icons-material",
      "@mui/x-charts",
      "@mui/x-data-grid",
    ],
  },

  async redirects() {
    return [
      // Projects moved out of CRM when the models did — a project is work, and
      // work is not a CRM concern. Anybody with the old page bookmarked, or a
      // link to it in a chat thread, lands on the new one rather than a 404.
      { source: "/crm/projects", destination: "/projects", permanent: true },
      { source: "/crm/projects/:path*", destination: "/projects/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
