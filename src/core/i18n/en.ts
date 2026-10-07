/**
 * The core's messages — English (ADR 0011, D9). Typed against the French
 * reference: a key missing here fails the build.
 */

import type { CoreDictionary } from "../../i18n/types.js";

const messages: CoreDictionary = {
  // ---------------------------------------------------------------------
  // Errors of the machines and of the SIP port (`errors.last`)
  // ---------------------------------------------------------------------
  "error.invalidUri": "Invalid SIP address (expected user@domain)",
  "error.wrongDomain": "This address must be in the {domain} domain",
  "error.duplicateAccount": "{address} is already saved as the other account",
  "error.passwordRequired": "Password required",
  "error.saveFailed": "Could not save: {detail}",
  "error.vaultUnreadable": "Could not read the accounts: {detail}",
  "error.invalidProxy": "Invalid proxy name — check the WSS address",
  "error.wssRefused": "Cannot reach the proxy (WSS connection refused)",
  "error.wssTimeout": "The proxy is not responding (WebSocket timeout)",
  "error.badCredentials": "Incorrect SIP address, password or authentication username",
  "error.missingSha256":
    "This server asks for SHA-256 authentication, and this account has no such digest. Enter the password again to compute it.",
  "error.regRefused": "Registration refused: {cause}",
  "error.wssLostDuringReg": "Connection lost while registering",
  "error.registrarTimeout": "The registrar is not responding",
  "error.regLost": "Registration lost: {cause}",
  "error.proxyLost": "Connection to the proxy lost",
  "error.offline": "No network — your settings are not the problem",
  "error.proxyLostDuringCall": "Connection to the proxy lost during the call",
  "error.callDropped": "Call dropped — connection to the proxy lost",
  "error.stunInvalid": "Invalid STUN server (expected host or host:port)",
  "error.turnInvalid": "Invalid TURN server (expected host or host:port)",
  "error.turnUserRequired": "TURN username required (the relay always authenticates)",
  "error.turnPasswordRequired": "TURN password required",
  "error.fileStoreInvalid": "Invalid file server (expected an https:// address)",

  // ---------------------------------------------------------------------
  // Why a call ended (`CallLogEntry.reason`, `errors.call`)
  // ---------------------------------------------------------------------
  "reason.hungUp": "rang off",
  "reason.sleep": "System sleep",
  "reason.noAnswer": "No answer",
  "reason.declined": "Call declined",
  "reason.missed": "Missed call",
  "reason.missedNoAnswer": "Missed call (no answer)",
  "reason.setupFailed": "Could not set up the call",
  "reason.offerUnsupported": "Media offer without {detail}: not WebRTC-compatible",
  "reason.callFailed": "Could not place the call: {detail}",
  "reason.sip": "{cause} (SIP {code})",

  // ---------------------------------------------------------------------
  // Why a message did not leave (ADR 0008, D3)
  // ---------------------------------------------------------------------
  "message.reason.noAnswer": "No answer",
  "message.reason.notFound": "Unknown address",
  "message.reason.unreachable": "Unreachable",
  "message.reason.refused": "Refused",
  "message.reason.format": "Format refused",
  "message.reason.unsupported": "The server does not carry messages",
  "message.reason.failed": "Failed (SIP {code})",
  "message.reason.tooLong": "Message too long",
  "message.reason.invalid": "Invalid address",
  "message.reason.interrupted": "Connection lost before the answer",
  "message.reason.fileTooLarge": "File too large for the server",
  "message.reason.fileCredentials": "The file server refuses your credentials",
  "message.reason.fileStore": "The file server did not take it",
  "message.reason.fileLost": "File lost when the page reloaded",

  // ---------------------------------------------------------------------
  // Passing messages of the call (`CallView.notice`)
  // ---------------------------------------------------------------------
  "notice.videoDeclined": "{peer} did not accept video",
  "notice.videoRefused": "{peer} declined to add video to this call",
  "notice.videoAdded": "{peer} added video",
  "notice.videoRemoved": "{peer} removed video",
  "notice.videoDeclinedHere": "Video declined",
  "notice.videoUnavailable": "Video cannot be added right now",
  "notice.shareRefused": "{peer} did not accept screen sharing",
  "notice.shareUnavailable": "Screen sharing cannot start right now",
  "notice.sharePeerStarted": "{peer} is sharing their screen",
  "notice.sharePeerStopped": "{peer} stopped sharing their screen",
  "notice.shareDeclinedHere": "Screen sharing declined",
  "notice.audioDeclined": "{peer} did not accept audio",
  "notice.audioRefused": "{peer} declines adding audio to this call",
  "notice.audioAdded": "{peer} added audio",
  "notice.audioRemoved": "{peer} removed audio",
  "notice.audioDeclinedHere": "Audio declined",
  "notice.audioUnavailable": "Cannot add audio right now",
  "notice.dtmfFailed": "Tone {tone} could not be sent",

  // ---------------------------------------------------------------------
  // Real-time text: the thread's notes and the transcript (`core/conversation.ts`)
  // ---------------------------------------------------------------------
  "chat.you": "You",
  "chat.note.opened": "Realtime text open",
  "chat.note.lost": "Text lost during the outage",
  "chat.note.broken": "Text link broken — recovering",
  "chat.note.closed": "Realtime text closed",
  "chat.note.refused": "This correspondent does not take realtime text",
  "chat.note.alert": "Alert received",
  "chat.log.title": "Conversation — {target}",
  "chat.log.vttBase": "Times counted from the start of the communication — call of {at}.",
  "chat.log.cut": "Start of the conversation not kept",

  // ---------------------------------------------------------------------
  // Reachability (ADR 0006): the sentence of `reachSentence`
  // ---------------------------------------------------------------------
  "reach.none": "You cannot receive calls.",

  // ---------------------------------------------------------------------
  // Raw text
  // ---------------------------------------------------------------------
  /**
   * Technical text with no translation (a JsSIP cause, a history entry
   * older than the i18n): shown as it is, rather than lost.
   */
  "misc.raw": "{text}",
};

export default messages;
