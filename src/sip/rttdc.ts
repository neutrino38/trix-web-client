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
 */

import type { RttWire, RttWireHooks } from "./rtt.js";

/** Label and subprotocol of the channel — both are `t140` (RFC 8865 §5). */
export const T140_CHANNEL = "t140";

/** T.140 session signature, written at the head of the stream. */
const SESSION_BOM = "\uFEFF";

/** Missing text marker, inserted when a lost channel comes back. */
const LOSS_MARKER = "\uFFFD";

/** How many times a lost channel is reopened before giving up for good. */
const MAX_REOPEN = 10;

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
    dc.onclose = () => lost(dc);
    dc.onerror = () => lost(dc);
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
    } catch {
      // connection already gone: the call goes on, without text
      hooks.state("closed");
    }
  };

  const lost = (dc: RTCDataChannel): void => {
    if (closed || !channels.has(dc)) return;
    channels.delete(dc);
    detach(dc);
    if (dc === elected) elected = null;
    interrupted = true;
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
    if (role !== "offer") return; // the answering side never creates one
    if (reopens >= MAX_REOPEN) {
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
    const state = connection.connectionState;
    if (state === "closed") {
      hooks.state("closed");
      return;
    }
    // the association is gone and `onclose` does not always follow
    if (state === "failed") {
      for (const dc of [...channels]) lost(dc);
      return;
    }
    if (state === "connected" && interrupted && elected === null) recover();
  };

  connection.addEventListener("datachannel", onDataChannel);
  connection.addEventListener("connectionstatechange", onConnectionState);
  if (role === "offer") create();

  return {
    send: write,
    close() {
      closed = true;
      clearInterval(beat);
      connection.removeEventListener("datachannel", onDataChannel);
      connection.removeEventListener("connectionstatechange", onConnectionState);
      for (const dc of channels) {
        detach(dc);
        dc.close();
      }
      channels.clear();
      elected = null;
    },
  };
}
