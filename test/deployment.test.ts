/**
 * `config.json`, the file an operator drops next to `index.html`.
 *
 * What is checked here is what the type system cannot say: that a
 * malformed file is indistinguishable from no file at all, that each key
 * stands on its own, and that a stored account is realigned on what the
 * deployment pins — or dropped when its SIP domain contradicts it.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OPEN_DEPLOYMENT,
  loadDeployment,
  parseDeployment,
  pinAccount,
  setDeployment,
  type Deployment,
} from "../src/deployment.js";
import type { AccountConfig } from "../src/storage/store.js";
import { computeHa1, computeHa1Sha256 } from "../src/storage/ha1.js";
import { NO_ICE } from "../src/sip/ice.js";

const ACCOUNT: AccountConfig = {
  proxy: "wss://old.example.fr:8443/ws",
  domain: "example.fr",
  displayName: "Alice Martin",
  username: "alice",
  authUsername: null,
  ha1: computeHa1("alice", "example.fr", "secret123"),
  ha1Sha256: computeHa1Sha256("alice", "example.fr", "secret123"),
  flashAlert: true,
  ice: NO_ICE,
  rtt: "none",
};

afterEach(() => {
  setDeployment(OPEN_DEPLOYMENT);
  vi.unstubAllGlobals();
});

describe("parseDeployment — nothing usable means nothing pinned", () => {
  it("falls back to the open deployment on anything that is not an object", () => {
    for (const raw of [null, undefined, 42, "wss://x", [], [{ sip_server: "wss://x" }]]) {
      expect(parseDeployment(raw)).toEqual(OPEN_DEPLOYMENT);
    }
  });

  it("an empty object pins nothing — an operator may state one key only", () => {
    expect(parseDeployment({})).toEqual(OPEN_DEPLOYMENT);
  });

  it("ignores keys it cannot use, and keeps the ones it can", () => {
    expect(parseDeployment({ sip_server: "sip.example.fr", sip_domain: "example.fr" })).toEqual({
      ...OPEN_DEPLOYMENT,
      // no ws:// scheme: the proxy field stays, rather than hiding a value
      // that no call could ever reach
      domain: "example.fr",
    });
    expect(parseDeployment({ sip_domain: "alice@example.fr" })).toEqual(OPEN_DEPLOYMENT);
    expect(parseDeployment({ sip_domain: "" })).toEqual(OPEN_DEPLOYMENT);
  });
});

describe("parseDeployment — the SIP server and domain", () => {
  it("accepts ws:// and wss://, and trims what surrounds them", () => {
    expect(parseDeployment({ sip_server: " wss://sip.example.fr:8443/ws " }).proxy).toBe(
      "wss://sip.example.fr:8443/ws",
    );
    expect(parseDeployment({ sip_server: "ws://sip.example.fr/ws" }).proxy).toBe(
      "ws://sip.example.fr/ws",
    );
    expect(parseDeployment({ sip_server: "https://sip.example.fr" }).proxy).toBeNull();
  });

  it("takes a hostname as a domain, port included", () => {
    expect(parseDeployment({ sip_domain: "example.fr" }).domain).toBe("example.fr");
    expect(parseDeployment({ sip_domain: "sip.example.fr:5060" }).domain).toBe(
      "sip.example.fr:5060",
    );
    expect(parseDeployment({ sip_domain: "deux domaines" }).domain).toBeNull();
  });
});

describe("parseDeployment — the NAT servers", () => {
  it("pins the whole section as soon as either server is named", () => {
    expect(parseDeployment({ stun_server: "stun.example.fr" }).ice).toEqual({
      stun: "stun.example.fr",
      turn: null,
    });
    // stated empty: no server at all, and no field to add one either
    expect(parseDeployment({ stun_server: "" }).ice).toEqual({ stun: null, turn: null });
  });

  it("strips a scheme pasted from an operator's documentation", () => {
    expect(parseDeployment({ stun_server: "stun:stun.example.fr:3478" }).ice).toEqual({
      stun: "stun.example.fr:3478",
      turn: null,
    });
  });

  it("keeps a TURN server only with both credentials", () => {
    const full = {
      stun_server: "stun.example.fr",
      turn_server: "turn.example.fr:5349",
      turn_username: "alice",
      turn_password: "s3cret",
      turn_tls: true,
    };
    expect(parseDeployment(full).ice).toEqual({
      stun: "stun.example.fr",
      turn: { host: "turn.example.fr:5349", username: "alice", password: "s3cret", tls: true },
    });
    // a relay has no anonymous mode: without a password it would only fail later
    const { turn_password: _, ...noPassword } = full;
    expect(parseDeployment(noPassword).ice).toEqual({ stun: "stun.example.fr", turn: null });
  });
});

describe("parseDeployment — real-time text and the SIP trace", () => {
  it("pins a transport, and leaves the menu on user_choice", () => {
    expect(parseDeployment({ realtime_text: "datachannel" }).rtt).toBe("datachannel");
    expect(parseDeployment({ realtime_text: "none" }).rtt).toBe("none");
    expect(parseDeployment({ realtime_text: "user_choice" }).rtt).toBeNull();
    expect(parseDeployment({ realtime_text: "carrier pigeon" }).rtt).toBeNull();
  });

  it('only "no" takes the trace away', () => {
    expect(parseDeployment({ debug_activated: "no" }).debug).toBe(false);
    expect(parseDeployment({ debug_activated: "NO" }).debug).toBe(false);
    expect(parseDeployment({ debug_activated: "yes" }).debug).toBe(true);
    expect(parseDeployment({}).debug).toBe(true);
  });
});

describe("loadDeployment", () => {
  function fetchReturning(status: number, body: string): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: status >= 200 && status < 300, text: async () => body })),
    );
  }

  it("reads the file when it is there", async () => {
    fetchReturning(200, JSON.stringify({ sip_domain: "example.fr", debug_activated: "no" }));
    expect(await loadDeployment()).toEqual({
      ...OPEN_DEPLOYMENT,
      domain: "example.fr",
      debug: false,
    });
  });

  it("stays open when the file is missing, unreadable, or is the index page", async () => {
    fetchReturning(404, "not found");
    expect(await loadDeployment()).toEqual(OPEN_DEPLOYMENT);

    // a server with an SPA fallback answers index.html to an absent file
    fetchReturning(200, "<!doctype html><html></html>");
    expect(await loadDeployment()).toEqual(OPEN_DEPLOYMENT);

    fetchReturning(200, '{ "sip_domain": "example.fr"');
    expect(await loadDeployment()).toEqual(OPEN_DEPLOYMENT);
  });

  it("stays open when the network refuses — offline, blocked, whatever", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await loadDeployment()).toEqual(OPEN_DEPLOYMENT);
  });
});

describe("pinAccount", () => {
  const pinned: Deployment = {
    proxy: "wss://sip.example.fr:8443/ws",
    domain: "example.fr",
    ice: { stun: "stun.example.fr", turn: null },
    rtt: "datachannel",
    debug: false,
  };

  it("realigns a stored account on what the deployment pins", () => {
    expect(pinAccount(ACCOUNT, pinned)).toEqual({
      ...ACCOUNT,
      proxy: "wss://sip.example.fr:8443/ws",
      ice: { stun: "stun.example.fr", turn: null },
      rtt: "datachannel",
    });
  });

  it("leaves untouched what the deployment says nothing about", () => {
    expect(pinAccount(ACCOUNT, OPEN_DEPLOYMENT)).toEqual(ACCOUNT);
  });

  it("drops an account from another SIP domain — its HA1 cannot follow", () => {
    expect(pinAccount({ ...ACCOUNT, domain: "elsewhere.fr" }, pinned)).toBeNull();
    // no pinned domain, no conflict
    expect(pinAccount({ ...ACCOUNT, domain: "elsewhere.fr" }, { ...pinned, domain: null })).not.toBeNull();
  });
});
