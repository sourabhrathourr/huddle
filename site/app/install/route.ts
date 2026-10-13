import { INSTALL_SCRIPT } from "@/lib/site";

// `curl -fsSL <this site>/install | sh` follows this to the installer in the repo.
export function GET() {
  return Response.redirect(INSTALL_SCRIPT, 302);
}
