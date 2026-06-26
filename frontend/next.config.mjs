/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The API base is read client-side from NEXT_PUBLIC_API_BASE. In dev it points
  // at the FastAPI backend (http://127.0.0.1:8001); in prod at the Railway/Render URL.
};

export default nextConfig;
