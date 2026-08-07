/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The API base is resolved in lib/api.ts: a remote NEXT_PUBLIC_API_BASE is used
  // verbatim (production), while a loopback or unset value makes the client follow
  // window.location.hostname — that is what lets one build serve localhost and a
  // LAN address at the same time.
  //
  // `next dev` and `next build` otherwise share .next, and dev clobbers BUILD_ID —
  // which made every "This PC" -> "Local WiFi" switch in the launcher pay for a full
  // rebuild. The launcher points dev at its own directory instead.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
