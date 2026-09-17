/**
 * Le lien de partage d'un compte : ce qu'il transporte, ce qu'il refuse, et
 * la forme de l'URL (src/share/link.ts).
 */
import { describe, expect, it } from "vitest";
import {
  SHARE_PAGE,
  decodeAccount,
  encodeAccount,
  linkPayload,
  shareUrl,
} from "../src/share/link.js";
import type { AccountConfig } from "../src/storage/store.js";

const CFG: AccountConfig = {
  proxy: "wss://sip.example.fr:8443/ws",
  domain: "example.fr",
  displayName: "Alice Martin",
  username: "alice",
  authUsername: null,
  ha1: "939e7578ed9e3c518a452acee763bce9",
  ha1Sha256: "3ba6cd94661c5ef34598040c868f13b8775df29109986be50ad35ae537dd3aa4",
  flashAlert: true,
  ice: { stun: null, turn: null },
  rtt: "websocket",
};

/** Un compte décodé, quel qu'il soit — les cas nominaux n'en doutent pas. */
function decoded(data: string): AccountConfig {
  const result = decodeAccount(data);
  if (!result.ok) throw new Error(`décodage refusé : ${result.error}`);
  return result.account;
}

describe("lien de partage — aller-retour", () => {
  it("un compte traverse le lien intact", () => {
    expect(decoded(encodeAccount(CFG))).toEqual(CFG);
  });

  it("les serveurs ICE suivent, mot de passe TURN compris", () => {
    const ice = {
      stun: "stun.example.fr:3478",
      turn: { host: "turn.example.fr:5349", username: "alice", password: "relais", tls: true },
    };
    expect(decoded(encodeAccount({ ...CFG, ice })).ice).toEqual(ice);
  });

  it("l'identifiant d'authentification séparé suit aussi", () => {
    const cfg = { ...CFG, authUsername: "alice-auth" };
    expect(decoded(encodeAccount(cfg)).authUsername).toBe("alice-auth");
  });

  it("la charge n'emploie que l'alphabet base64url, sans remplissage", () => {
    // ni `+`, ni `/`, ni `=` : rien qu'un client de messagerie ait envie de
    // couper ou de réécrire
    expect(encodeAccount(CFG)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("un nom affiché accentué survit au passage en octets", () => {
    const cfg = { ...CFG, displayName: "Amélie Gonçalves 日本" };
    expect(decoded(encodeAccount(cfg)).displayName).toBe("Amélie Gonçalves 日本");
  });
});

describe("lien de partage — forme de l'URL", () => {
  it("la charge est dans le fragment, jamais dans la requête", () => {
    const url = new URL(shareUrl(CFG, "https://trix.example.fr/index.html"));
    expect(url.pathname).toBe(`/${SHARE_PAGE}`);
    expect(url.search).toBe("");
    // le fragment ne part pas au serveur : le HA1 n'entre dans aucun journal
    expect(url.hash.startsWith("#data=")).toBe(true);
  });

  it("le lien vise la page du même déploiement", () => {
    const url = new URL(shareUrl(CFG, "https://trix.example.fr/sous/dossier/"));
    expect(url.origin).toBe("https://trix.example.fr");
    expect(url.pathname).toBe(`/sous/dossier/${SHARE_PAGE}`);
  });

  it("le lien fabriqué se relit", () => {
    const url = new URL(shareUrl(CFG, "https://trix.example.fr/"));
    const data = linkPayload({ hash: url.hash, search: url.search });
    expect(decoded(data!)).toEqual(CFG);
  });

  it("la requête est acceptée en lecture, pour un lien réécrit en chemin", () => {
    expect(linkPayload({ hash: "", search: "?data=abc" })).toBe("abc");
  });

  it("le fragment l'emporte quand les deux sont là", () => {
    expect(linkPayload({ hash: "#data=frag", search: "?data=query" })).toBe("frag");
  });

  it("une page ouverte sans lien ne porte rien", () => {
    expect(linkPayload({ hash: "", search: "" })).toBeNull();
    expect(linkPayload({ hash: "#", search: "" })).toBeNull();
    expect(linkPayload({ hash: "#data=", search: "" })).toBeNull();
  });
});

describe("lien de partage — ce qui vient d'une URL n'est jamais cru", () => {
  /** Une charge fabriquée à la main, telle qu'un lien bricolé l'apporterait. */
  const forge = (account: unknown, v = 1): string =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ v, a: account }))))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  it("base64 illisible", () => {
    expect(decodeAccount("pas du base64 !").ok).toBe(false);
  });

  it("base64 valide mais pas du JSON", () => {
    expect(decodeAccount(btoa("bonjour")).ok).toBe(false);
  });

  it("une version future est reconnue comme telle, pas comme illisible", () => {
    const result = decodeAccount(forge(CFG, 99));
    expect(result).toEqual({ ok: false, error: "version" });
  });

  it("proxy manquant ou qui n'est pas une WebSocket", () => {
    expect(decodeAccount(forge({ ...CFG, proxy: undefined })).ok).toBe(false);
    expect(decodeAccount(forge({ ...CFG, proxy: "https://sip.example.fr" })).ok).toBe(false);
  });

  it("HA1 absent, trop court, ou hors hexadécimal", () => {
    expect(decodeAccount(forge({ ...CFG, ha1: undefined })).ok).toBe(false);
    expect(decodeAccount(forge({ ...CFG, ha1: "abc" })).ok).toBe(false);
    expect(decodeAccount(forge({ ...CFG, ha1: "z".repeat(32) })).ok).toBe(false);
  });

  it("adresse SIP impossible", () => {
    expect(decodeAccount(forge({ ...CFG, domain: "" })).ok).toBe(false);
    expect(decodeAccount(forge({ ...CFG, username: "ali ce" })).ok).toBe(false);
    // un `@` dans le userpart ferait deux adresses d'une seule
    expect(decodeAccount(forge({ ...CFG, username: "alice@ailleurs" })).ok).toBe(false);
  });

  it("les champs facultatifs absents prennent les défauts les plus discrets", () => {
    const account = decoded(
      forge({ proxy: CFG.proxy, domain: CFG.domain, username: CFG.username, ha1: CFG.ha1 }),
    );
    expect(account.displayName).toBe("");
    expect(account.authUsername).toBeNull();
    // le désactiver ne peut être qu'un choix explicite
    expect(account.flashAlert).toBe(true);
    expect(account.ice).toEqual({ stun: null, turn: null });
    // proposer du texte modifie l'offre SDP de tous les appels du compte
    expect(account.rtt).toBe("none");
  });

  it("un transport texte inconnu retombe sur « aucun »", () => {
    expect(decoded(forge({ ...CFG, rtt: "pigeon" })).rtt).toBe("none");
  });

  it("un serveur TURN amputé de ses identifiants est écarté", () => {
    // le mécanisme « long-term credential » n'a pas de mode anonyme : le
    // relais n'échouerait que plus tard, en silence
    const ice = { stun: null, turn: { host: "turn.example.fr", tls: false } };
    expect(decoded(forge({ ...CFG, ice })).ice.turn).toBeNull();
  });

  it("un hôte ICE inexploitable ne passe pas pour un serveur", () => {
    const ice = { stun: "pas un hôte !", turn: null };
    expect(decoded(forge({ ...CFG, ice })).ice.stun).toBeNull();
  });

  it("le HA1 est normalisé en minuscules", () => {
    expect(decoded(forge({ ...CFG, ha1: CFG.ha1.toUpperCase() })).ha1).toBe(CFG.ha1);
    expect(decoded(forge({ ...CFG, ha1Sha256: CFG.ha1Sha256.toUpperCase() })).ha1Sha256).toBe(
      CFG.ha1Sha256,
    );
  });

  it("un lien d'avant SHA-256 reste un lien : le compte arrive sans cette empreinte", () => {
    // le compte s'enregistrera partout où le serveur défie en MD5 ; c'est
    // le défi SHA-256, s'il vient, qui dira ce qui manque
    const account = decoded(forge({ ...CFG, ha1Sha256: undefined }));
    expect(account.ha1Sha256).toBe("");
    expect(account.ha1).toBe(CFG.ha1);
  });

  it("une empreinte SHA-256 illisible vaut absente, et n'emporte pas le compte", () => {
    for (const ha1Sha256 of ["abc", "z".repeat(64), CFG.ha1, 42]) {
      expect(decoded(forge({ ...CFG, ha1Sha256 })).ha1Sha256).toBe("");
    }
  });

  it("aucun champ étranger ne se glisse dans le compte créé", () => {
    const account = decoded(forge({ ...CFG, id: "vole", password: "secret" }));
    expect(account).toEqual(CFG);
  });
});
