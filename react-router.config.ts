import type { Config } from "@react-router/dev/config";

export default {
  // Let an isolated verification build coexist with a running local preview.
  buildDirectory: process.env.COWRITE_BUILD_DIRECTORY || 'build',
  // Config options...
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: true,
} satisfies Config;
