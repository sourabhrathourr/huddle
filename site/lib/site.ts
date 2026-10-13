export const VERSION = "0.1.2";
export const SITE = "https://huddle.top";
export const REPO = "https://github.com/sourabhrathourr/huddle";
// The installer itself lives in the repo; huddle.top/install forwards to it (app/install/route.ts).
export const INSTALL_SCRIPT = "https://raw.githubusercontent.com/sourabhrathourr/huddle/main/install.sh";
export const INSTALL = `curl -fsSL ${SITE}/install | sh`;
