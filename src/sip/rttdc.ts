/**
 * Real-time text over a **WebRTC data channel** — RFC 8865.
 *
 * The channel is reliable and ordered, subprotocol `t140`, negotiated
 * in-band through DCEP. Neither `maxRetransmits` nor `maxPacketLifeTime`
 * is ever set — RFC 8865 §4.1 forbids both on a T.140 channel — and no
 * `id` is imposed. Nothing here reads or writes SDP: the channel rides
 * the SCTP association the call already carries, so opening it costs no
 * renegotiation.
 *
 * The offering side creates the channel, the answering side waits for
 * `ondatachannel` (RFC 8865 §5). Should both ends create one anyway, the
 * channel with the lowest `id` wins and the other is dropped: both ends
 * see both ids and reach the same verdict. Until then text is read from
 * every t140 channel, so the tie costs no character — and nothing is ever
 * re-sent (RFC 8865 §5.4).
 *
 * A channel lost mid-call is reopened by the side that created it, and
 * the local stream gets a missing text marker: what the peer wrote during
 * the outage is gone for good.
 *
 * Every one of those failures is **said out loud** — one console line and
 * one line in the call's notebook (`sip/mediaerror.ts`), carrying whatever
 * the browser gave us. Nothing else would show it: the channel rides the
 * SCTP association the call already has, is reopened without any
 * renegotiation, and a text link that dies leaves no SIP trace at all.
 */

import type { RttWire, RttWireHooks } from "./rtt.js";
import { consoleErrorSink, reportTextChannelError, type ErrorSink } from "./mediaerror.js";

/** Label and subprotocol of the channel — both are `t140` (RFC 8865 §5). */
export const T140_CHANNEL = "t140";

/** T.140 session signature, written at the head of the stream. */
const SESSION_BOM = "\uFEFF";

/** Missing text marker, inserted when a lost channel comes back. */
const LOSS_MARKER = "\uFFFD";

/** How many times a lost channel is reopened before giving up for good. */
const MAX_REOPEN = 10;

/**
 * How long the channel may take to open **once the peer connection is up**,
 * before the failure is reported.
 *
 * The clock starts on `connected` and not a moment earlier: the wire is
 * opened with the call, and a call can ring for minutes — a channel still
 * waiting on DTLS is not a channel in trouble. Once the transport is there,
 * DCEP costs one round trip, and ten seconds is far more than any of them.
 *
 * Nothing is reported when the association is missing (`connection.sctp`
 * is null): the far end declined the `m=application` section, which is an
 * answer, not a failure — `sip/rttsip.ts` closes the link on it.
 */
const OPEN_DEADLINE_MS = 10000;

/**
 * How often the session signature is repeated while nothing else is being
 * sent — a keep-alive, and the reason it exists is the return path.
 *
 * SCTP rides DTLS over UDP, and a NAT keeps a mapping open only as long as
 * packets cross it. On a call that is ringing — or playing an early-media
 * announcement, which is exactly when a gateway has text to send us — the
 * local side may write nothing at all for minutes: the mapping lapses, and
 * the subtitles of that announcement reach a closed door.
 *
 * The signature is what we send, because it is the one thing in T.140 that
 * carries no meaning: a receiver consumes it and displays nothing, wherever
 * it appears in the stream (T.140 §6.2). Five seconds is well inside the
 * shortest NAT UDP timeouts in the wild (30 s is the low end).
 */
const KEEPALIVE_MS = 5000;

const isLive = (dc: RTCDataChannel): boolean =>
  dc.readyState === "connecting" || dc.readyState === "open";

/**
 * Opens the wire on the call's peer connection. `role` says who creates
 * the channel: the side that writes the offer establishing the SCTP
 * association, never the other one.
 */
export function openDcWire(
  connection: RTCPeerConnection,
  role: "offer" | "answer",
  hooks: RttWireHooks,
  sink: ErrorSink = consoleErrorSink,
): RttWire {
  /** Every adopted t140 channel: text is read from all, written to one. */
  const channels = new Set<RTCDataChannel>();
  const signed = new WeakSet<RTCDataChannel>();
  let elected: RTCDataChannel | null = null;
  let closed = false;
  let reopens = 0;
  /** A channel was lost: whatever comes next follows a gap in the stream. */
  let interrupted = false;
  /** When something last went out, keep-alive included. */
  let sinceSend = 0;
  /** Armed once the connection is up, disarmed by the first open channel. */
  let deadline: ReturnType<typeof setTimeout> | null = null;
  /** A channel has been open at least once: what fails now is a break. */
  let everOpen = false;

  /**
   * Says a failure — console and notebook, whatever the trace setting says
   * (`sip/mediaerror.ts`). The notes are what the browser's error does not
   * carry, and what one needs to read the line a week later: which side we
   * are, where the connection stands, how many channels are still held, and
   * how many times we have already reopened one.
   */
  const fail = (problem: string, error?: unknown): void => {
    reportTextChannelError(
      {
        problem,
        error,
        notes: {
          "rôle": role,
          connexion: connection.connectionState,
          canaux: channels.size,
          reprises: reopens,
        },
      },
      sink,
    );
  };

  const disarm = (): void => {
    if (deadline === null) return;
    clearTimeout(deadline);
    deadline = null;
  };

  /**
   * The DTLS transport under the association — the one place a browser
   * hands us the **TLS alert** that ended a failed handshake, certificate
   * alerts included (`sip/mediaerror.ts` names them). Watched as soon as
   * `sctp` exists, which is only once the section has been negotiated.
   */
  let dtls: RTCDtlsTransport | null = null;

  const onDtlsError = (ev: Event): void => {
    if (closed) return;
    fail("échec de la poignée de main DTLS", (ev as RTCErrorEvent).error);
  };

  const watchDtls = (): void => {
    const transport = connection.sctp?.transport ?? null;
    if (transport === null || transport === dtls) return;
    dtls = transport;
    transport.addEventListener("error", onDtlsError);
  };

  /**
   * Starts the opening clock. Rearmed on every reconnection: a channel
   * that never comes back after an ICE restart is the same failure as one
   * that never opened.
   */
  const arm = (): void => {
    // an elected channel that is still `connecting` is exactly what this
    // clock is for: only an open one calls the wire established
    if (closed || deadline !== null || elected?.readyState === "open") return;
    deadline = setTimeout(() => {
      deadline = null;
      if (closed || elected?.readyState === "open") return;
      // no association: the far end refused the text section, and that is
      // an answer rather than a failure — `sip/rttsip.ts` acts on it
      if ((connection.sctp ?? null) === null) return;
      const delay = `${OPEN_DEADLINE_MS / 1000} s`;
      fail(
        everOpen
          ? `canal non rétabli ${delay} après la reprise de la connexion`
          : `aucun canal t140 ouvert ${delay} après l'établissement de la connexion`,
      );
    }, OPEN_DEADLINE_MS);
  };

  /** Writes on the elected channel, and remembers that the path was used. */
  const write = (text: string): void => {
    // the wrapping channel's state can be a microtask behind ours
    if (elected?.readyState !== "open") return;
    elected.send(text);
    sinceSend = Date.now();
  };

  /**
   * The keep-alive: a signature every `KEEPALIVE_MS`, and only when nothing
   * else has gone out since — a conversation keeps its own path open, and
   * has no use for a beat on top of it.
   */
  const beat = setInterval(() => {
    if (closed || Date.now() - sinceSend < KEEPALIVE_MS) return;
    write(SESSION_BOM);
  }, KEEPALIVE_MS);

  /**
   * Lets a channel go without mistaking it for a loss. `onmessage` stays
   * on: SCTP still delivers what the peer wrote before it went away.
   */
  const detach = (dc: RTCDataChannel): void => {
    dc.onopen = null;
    dc.onclose = null;
    dc.onerror = null;
  };

  const elect = (): void => {
    if (closed) return;
    const live = [...channels].filter(isLive);
    if (live.length > 1) {
      // an id is only assigned once SCTP is up, and comparing a missing
      // one would split the verdict between the two ends
      if (live.some((dc) => dc.id === null || dc.id === undefined)) return;
      live.sort((a, b) => a.id! - b.id!);
      for (const loser of live.splice(1)) {
        channels.delete(loser);
        detach(loser);
        loser.close();
      }
    }

    elected = live[0] ?? null;
    if (elected === null || elected.readyState !== "open") return;
    everOpen = true;
    disarm();
    if (!signed.has(elected)) {
      signed.add(elected);
      // the signature opens the stream, before any character — and it is
      // the first beat of the keep-alive that follows
      write(SESSION_BOM);
    }
    if (interrupted) {
      interrupted = false;
      hooks.text(LOSS_MARKER);
    }
    hooks.state("open");
  };

  const adopt = (dc: RTCDataChannel): void => {
    channels.add(dc);
    dc.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data === "string") hooks.text(ev.data);
    };
    dc.onopen = elect;
    // the channel goes away on its own: the peer closed it, or the
    // association did — `detach` is what tells our own closings apart
    dc.onclose = () => lost(dc, "canal fermé par le distant ou par le transport");
    dc.onerror = (ev) => lost(dc, "erreur sur le canal", (ev as RTCErrorEvent).error);
    elect();
  };

  const create = (): void => {
    try {
      adopt(
        connection.createDataChannel(T140_CHANNEL, {
          ordered: true,
          protocol: T140_CHANNEL,
        }),
      );
    } catch (error) {
      // connection already gone: the call goes on, without text
      fail("création du canal impossible", error);
      hooks.state("closed");
    }
  };

  const lost = (dc: RTCDataChannel, problem: string, error?: unknown): void => {
    if (closed || !channels.has(dc)) return;
    channels.delete(dc);
    detach(dc);
    if (dc === elected) elected = null;
    interrupted = true;
    // a hung-up call closes its channels on the way out: that is the end of
    // the call, not a break, and it has no business in the notebook
    if (connection.connectionState !== "closed") fail(problem, error);
    recover();
  };

  const recover = (): void => {
    if (closed) return;
    elect();
    if (elected !== null) return;

    hooks.state("lost");
    const state = connection.connectionState;
    if (state === "closed") {
      hooks.state("closed");
      return;
    }
    // `failed` tore the SCTP association down; a channel created now would
    // go nowhere. We wait for the connection to come back — an ICE restart
    // keeps the DTLS transport, and the channel is created again then.
    if (state === "failed") return;
    // whatever happens next, the channel now has a deadline to come back
    // under — the answering side, which creates nothing, included
    arm();
    if (role !== "offer") return; // the answering side never creates one
    if (reopens >= MAX_REOPEN) {
      disarm(); // said here, and there is nothing left to wait for
      fail(`canal irrécupérable, abandon après ${MAX_REOPEN} reprises`);
      hooks.state("closed");
      return;
    }
    reopens++;
    create();
  };

  /** The peer's channel, recognised by its subprotocol (its label failing that). */
  const onDataChannel = (ev: RTCDataChannelEvent): void => {
    const dc = ev.channel;
    if (dc.protocol !== T140_CHANNEL && dc.label !== T140_CHANNEL) return;
    adopt(dc);
  };

  const onConnectionState = (): void => {
    if (closed) return;
    watchDtls(); // l'association peut venir d'apparaître
    const state = connection.connectionState;
    if (state === "closed") {
      hooks.state("closed");
      return;
    }
    // the association is gone and `onclose` does not always follow
    if (state === "failed") {
      const live = [...channels];
      for (const dc of live) lost(dc, "connexion pair-à-pair rompue (failed)");
      // nothing was left to lose, and the failure would go unsaid
      if (live.length === 0 && elected === null) fail("connexion pair-à-pair rompue (failed)");
      return;
    }
    if (state !== "connected") return;
    if (interrupted && elected === null) recover();
    arm();
  };

  connection.addEventListener("datachannel", onDataChannel);
  connection.addEventListener("connectionstatechange", onConnectionState);
  if (role === "offer") create();
  watchDtls();
  // the connection may already be up — an incoming call whose peer
  // connection is handed over after the answer
  if (connection.connectionState === "connected") arm();

  return {
    send: write,
    close() {
      closed = true;
      clearInterval(beat);
      disarm();
      connection.removeEventListener("datachannel", onDataChannel);
      connection.removeEventListener("connectionstatechange", onConnectionState);
      dtls?.removeEventListener("error", onDtlsError);
      dtls = null;
      for (const dc of channels) {
        detach(dc);
        dc.close();
      }
      channels.clear();
      elected = null;
    },
  };
}
