import { md5 } from "./md5.js";
import { sha256 } from "./sha256.js";

/**
 * HA1 Digest (RFC 2617) : seule cette empreinte est persistée,
 * jamais le mot de passe. Hypothèse projet : realm = domaine SIP
 * (voir docs/CONCEPTION.md §5-6).
 */
export function computeHa1(username: string, realm: string, password: string): string {
  return md5(`${username}:${realm}:${password}`);
}

/**
 * La **même** empreinte, condensée par SHA-256 (RFC 8760). Ce n'est pas un
 * remplacement : un serveur choisit l'algorithme dans son défi, et les deux
 * se rencontrent encore — d'où deux empreintes gardées côte à côte plutôt
 * qu'une seule (`storage/store.ts`, `sip/digest.ts`).
 *
 * Elle se calcule au même moment que l'autre, à la saisie du mot de passe,
 * parce que c'est le seul moment où le mot de passe existe : un compte
 * enregistré avant l'arrivée de SHA-256 n'a que son HA1 MD5, et rien ne
 * peut le lui fabriquer après coup.
 */
export function computeHa1Sha256(username: string, realm: string, password: string): string {
  return sha256(`${username}:${realm}:${password}`);
}
