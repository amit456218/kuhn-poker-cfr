/**
 * Static export, for GitHub Pages.
 *
 * The dashboard has no server behind it: the CFR solver is compiled into the
 * bundle and runs in the browser (see lib/solver/). So there is nothing to
 * proxy and nothing to host beyond the static files themselves.
 *
 * Pages serves the site from /<repo>, so the asset prefix has to match. Local
 * dev serves from the root, hence the environment switch.
 */
const isPages = process.env.GITHUB_PAGES === "true";
const repo = "kuhn-poker-cfr";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  basePath: isPages ? `/${repo}` : "",
  assetPrefix: isPages ? `/${repo}/` : "",
  images: { unoptimized: true },
  // Pages serves /foo/ as /foo/index.html; without this the routes 404.
  trailingSlash: true,
};
export default nextConfig;
