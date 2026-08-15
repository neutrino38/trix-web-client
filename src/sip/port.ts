/**
 * Port SIP : la seule frontière entre les machines FSL et JsSIP
 * (docs/CONCEPTION.md §2). Les machines reçoivent des événements
 * `sip:*` et ne voient jamais un type JsSIP ; les tests injectent
 * un port factice.
 */

import JsSIP from "jssip";
import type { AccountConfig } from "../storage/store.js";

export type SipEvent =
  | { type: "sip:connected" }
  | { type: "sip:disconnected" }
  | { type: "sip:registered" }
  | { type: "sip:unregistered" }
  | { type: "sip:registrationFailed"; cause: string; statusCode?: number }
  /** URL de proxy rejetée par JsSIP avant toute tentative réseau (schéma/syntaxe). */
  | { type: "sip:invalidProxy"; detail: string };

export interface SipHandle {
  /**
   * unREGISTER + fermeture du transport. Les événements continuent
   * d'arriver jusqu'à `sip:disconnected`, après quoi le port se détache.
   */
  stop(): void;
}

export interface SipPort {
  start(cfg: AccountConfig, send: (ev: SipEvent) => void): SipHandle;
}

export function createJsSipPort(): SipPort {
  return {
    start(cfg, send) {
      let ua: JsSIP.UA;
      try {
        const socket = new JsSIP.WebSocketInterface(cfg.proxy);
        ua = new JsSIP.UA({
          sockets: [socket],
          uri: `sip:${cfg.username}@${cfg.domain}`,
          display_name: cfg.displayName,
          realm: cfg.domain,
          ha1: cfg.ha1,
          register: true,
          ...(cfg.authUsername ? { authorization_user: cfg.authUsername } : {}),
        });
      } catch (e) {
        // microtask : start() est appelé depuis enter(), l'événement doit
        // arriver une fois la transition vers `connecting` terminée
        queueMicrotask(() =>
          send({ type: "sip:invalidProxy", detail: e instanceof Error ? e.message : String(e) }),
        );
        return { stop() {} };
      }

      let stopped = false;
      ua.on("connected", () => send({ type: "sip:connected" }));
      ua.on("disconnected", () => {
        send({ type: "sip:disconnected" });
        // UA étend EventEmitter au runtime, mais les types JsSIP ne l'exposent pas
        if (stopped) (ua as unknown as { removeAllListeners(): void }).removeAllListeners();
      });
      ua.on("registered", () => send({ type: "sip:registered" }));
      ua.on("unregistered", () => send({ type: "sip:unregistered" }));
      ua.on(
        "registrationFailed",
        (e: { cause?: string; response?: { status_code?: number } | null }) =>
          send({
            type: "sip:registrationFailed",
            cause: e.cause ?? "cause inconnue",
            statusCode: e.response?.status_code,
          }),
      );
      ua.start();

      return {
        stop() {
          stopped = true;
          ua.stop();
        },
      };
    },
  };
}
