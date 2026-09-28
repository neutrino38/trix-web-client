/**
 * Analyse de l'URI SIP saisie au formulaire : `user@domaine`,
 * préfixe `sip:` (ou `sips:`) accepté et ignoré.
 */

export interface SipUriParts {
  username: string;
  domain: string;
}

export function parseSipUri(raw: string): SipUriParts | null {
  const s = raw.trim().replace(/^sips?:/i, "");
  const at = s.indexOf("@");
  if (at <= 0 || at !== s.lastIndexOf("@")) return null;
  const username = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (!domain || /\s/.test(s)) return null;
  return { username, domain };
}

/**
 * Normalisation d'une cible d'appel (docs/CONCEPTION.md §7) :
 * sans `@` le domaine configuré est ajouté, le préfixe `sip:` est
 * garanti en sortie. Retourne null si la saisie est inutilisable.
 */
export function normalizeTarget(input: string, domain: string): string | null {
  const s = input.trim().replace(/^sips?:/i, "");
  if (!s || /\s/.test(s) || s.startsWith("@") || s.endsWith("@")) return null;
  return `sip:${s.includes("@") ? s : `${s}@${domain}`}`;
}

/**
 * La clé qui dit que deux adresses désignent le même correspondant
 * (ADR 0007, D7) : `user@domaine`, sans préfixe `sip:` ni paramètres, le
 * domaine en minuscules — il est insensible à la casse, la partie
 * utilisateur ne l'est pas (RFC 3261 §19.1.4). C'est elle qui rattache une
 * ligne d'historique, écrite sans préfixe, à un contact, gardé avec.
 */
export function addressKey(raw: string): string | null {
  const parts = parseSipUri(raw.split(";")[0] ?? "");
  return parts ? `${parts.username}@${parts.domain.toLowerCase()}` : null;
}
