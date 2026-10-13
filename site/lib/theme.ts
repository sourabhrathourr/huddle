export const KEY = "huddle-theme";
export const DARK = "(prefers-color-scheme: dark)";

// Runs in <head> before the first paint, so the page never flashes the wrong theme.
// No stored choice means "system".
export const THEME_SCRIPT = `try{var c=localStorage.getItem("${KEY}");var d=c==="dark"||(c!=="light"&&matchMedia("${DARK}").matches);document.documentElement.dataset.theme=d?"dark":"light"}catch(e){}`;
