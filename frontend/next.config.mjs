/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    // Proxy API calls to the FastAPI backend so the browser sees one origin.
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.BACKEND_URL ?? "http://127.0.0.1:8000"}/api/:path*`,
      },
    ];
  },
};
export default nextConfig;
