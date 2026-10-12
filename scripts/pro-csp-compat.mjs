import fs from "node:fs";

export const PRO_CSP_VERSION = "3.1.15-5";
const tokenOptions = "override: finalToken,\n        cssVar:";

/** The pinned beta forwards nonce for rules but omits it for Pro token variables. */
export function patchProTokenNonce(source, version) {
  if (version !== PRO_CSP_VERSION)
    throw new Error(
      "Review ProComponents CSP compatibility before changing its version",
    );
  if (source.split(tokenOptions).length !== 2)
    throw new Error(
      "ProComponents token registration changed; review the CSP patch",
    );
  return source.replace(
    tokenOptions,
    "override: finalToken,\n        nonce: restConfig.csp?.nonce,\n        cssVar:",
  );
}

/** Authorize at generation time, never by retagging arbitrary DOM style elements. */
export function proCspCompatibility() {
  let patched = false;
  return {
    name: "tome-pro-token-csp",
    apply: "build",
    enforce: "pre",
    buildStart() {
      patched = false;
    },
    transform(source, id) {
      const file = id.split("?")[0].replace(/\\/g, "/");
      const suffix = "@ant-design/pro-components/es/provider/index.js";
      if (!file.endsWith(suffix)) return null;
      const packageFile =
        file.slice(0, -"es/provider/index.js".length) + "package.json";
      const { version } = JSON.parse(fs.readFileSync(packageFile, "utf8"));
      patched = true;
      return { code: patchProTokenNonce(source, version), map: null };
    },
    buildEnd(error) {
      if (!error && !patched)
        this.error("Expected ProComponents CSP registration was not loaded");
    },
  };
}
