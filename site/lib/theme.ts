export const KEY = "huddle-theme";

// Runs in <head> before the first paint, so the page never flashes the wrong theme.
// Light unless the visitor picked dark.
export const THEME_SCRIPT = `try{document.documentElement.dataset.theme=localStorage.getItem("${KEY}")==="dark"?"dark":"light"}catch(e){}`;
