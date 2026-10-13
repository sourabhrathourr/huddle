import path from "node:path";
import { Config } from "@remotion/cli/config";

// The video imports the site's own components (the bench, the logos). They live outside this project, so
// React has to resolve to this project's copy, or the page would load two Reacts.
const here = (name: string) => path.resolve(process.cwd(), "node_modules", name);

Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(95);
Config.overrideWebpackConfig((config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    alias: {
      ...(config.resolve?.alias ?? {}),
      react: here("react"),
      "react-dom": here("react-dom"),
    },
  },
}));
