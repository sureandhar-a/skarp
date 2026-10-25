// tools may only touch files inside the workspace, and never secret-looking ones.
// limit: name rules only; reading .gitignore is the adapter's job (its file search skips ignored files).
const SECRET = /(^|\/)(\.env(\..*)?|id_rsa|id_ed25519|.*\.(pem|key|p12|pfx)|\.git\/.*)$/i;

export function pathAllowed(path: string): boolean {
  if (path === "" || path.startsWith("/") || /^[a-z]:/i.test(path) || path.includes("\\")) {
    return false;
  }
  if (path.split("/").includes("..")) return false;
  return !SECRET.test(path);
}
