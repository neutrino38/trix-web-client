import { md5 } from "./md5.js";

/**
 * HA1 Digest (RFC 2617) : seule cette empreinte est persistée,
 * jamais le mot de passe. Hypothèse projet : realm = domaine SIP
 * (voir docs/CONCEPTION.md §5-6).
 */
export function computeHa1(username: string, realm: string, password: string): string {
  return md5(`${username}:${realm}:${password}`);
}
