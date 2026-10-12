import { randomBytes } from "node:crypto";

export const STYLE_NONCE_PLACEHOLDER = "__TOME_STYLE_NONCE__";
const responseNonces = new WeakMap<object, string>();

/** A fresh document authorizes only the styles created by its own UI provider. */
export function createStyleNonce() {
  return randomBytes(24).toString("base64url");
}

/** Helmet and the HTML renderer share one nonce without retaining responses. */
export function styleNonceForResponse(response: object) {
  let nonce = responseNonces.get(response);
  if (!nonce) {
    nonce = createStyleNonce();
    responseNonces.set(response, nonce);
  }
  return nonce;
}

export function contentSecurityPolicy(secure: boolean) {
  return {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: [
        "'self'",
        (_request: unknown, response: object) =>
          `'nonce-${styleNonceForResponse(response)}'`,
      ],
      imgSrc: ["'self'", "blob:", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: secure ? [] : null,
    },
  };
}

export function renderStyleNonce(html: string, nonce: string) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(nonce))
    throw new Error("Invalid document style nonce");
  const marker = `name="tome-style-nonce" content="${STYLE_NONCE_PLACEHOLDER}"`;
  if (html.split(marker).length !== 2)
    throw new Error("Frontend document must contain one style nonce marker");
  return html.replace(marker, `name="tome-style-nonce" content="${nonce}"`);
}
