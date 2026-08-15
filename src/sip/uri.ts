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
