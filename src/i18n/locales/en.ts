/**
 * English dictionary.
 *
 * Typed against the French reference (`Dictionary`): the compiler rejects a
 * missing or misspelled key, so this file cannot silently drift away from
 * `fr.ts` as the application grows.
 *
 * This is a rewrite, not a word-for-word translation: English interface
 * strings drop the definite article ("Mute microphone", not "Mute the
 * microphone") and prefer the idiom over the French turn of phrase.
 * Spelling is British throughout ("minimised", "Cancelled"), and so is the
 * tone.
 *
 * British humour is understatement, so the restraint *is* the joke: a
 * dozen dry asides, no more, and only where reading them sideways costs
 * nothing — the empty history, the hints, the line describing how a call
 * ended, an apology for a refused copy. Never in an error message, never
 * on a button an ongoing call depends on. "Ring off" for hanging up is not
 * a joke at all, only the British way to say it.
 *
 * Deliberately left untranslated: "Trix", "Powered by FSL", technical codes
 * (SIP 486, WSS_LOST) and the raw causes JsSIP reports — a searchable error
 * code stops being searchable once it is translated.
 */

import type { Translation } from "../types.js";

const messages: Translation = {
  // ---------------------------------------------------------------------
  // Language picker
  // ---------------------------------------------------------------------
  "lang.label": "Interface language",
  "lang.auto": "Automatic (browser language)",
  "lang.autoDetected": "Automatic — {name}",
  "lang.hint": "“Automatic” uses your browser's language.",

  // ---------------------------------------------------------------------
  // Tab titles for screens without a phone state
  // ---------------------------------------------------------------------
  "screen.settings": "Settings",
  "screen.saving": "Saving…",
  "screen.deleting": "Deleting…",

  // ---------------------------------------------------------------------
  // Home screen
  // ---------------------------------------------------------------------
  "home.tagline": "Total Conversation webphone",
  "home.useAccount": "Use this account",
  "home.newAccount": "Set up a new account",
  "home.addAccount": "Add an account",
  "home.editAccount": "Edit",
  "home.version": "Version {version}",
  "fsl.aria": "Powered by FSL — finite-state-language on GitHub (new window)",

  // ---------------------------------------------------------------------
  // Configuration screen
  // ---------------------------------------------------------------------
  "config.title": "Settings",
  "config.titleNew": "New account",
  "config.section.account": "SIP account",
  "config.proxy": "SIP server",
  "config.proxyPlaceholder": "wss://sip.example.com:8443/ws",
  "config.uri": "SIP address",
  "config.uriPlaceholder": "sip:alice@example.com",
  "config.uriHint":
    "With or without the “sip:” prefix. The domain doubles as the authentication realm.",
  /** Domain pinned by the deployment (`config.json`): the only one accepted. */
  "config.uriHintDomain":
    "Only addresses in the {domain} domain are accepted here. That domain doubles as the authentication realm.",
  "config.displayName": "Your name",
  "config.authToggle": "Authentication username (if different from {user})",
  "config.authUserDefault": "the user part of the address",
  "config.password": "Password",
  "config.passwordSet": "•••••• (already set)",
  "config.passwordKeep": "Leave blank to keep the current password.",
  "config.ha1Note":
    "The password itself is never stored — only its digests (HA1 in MD5 and SHA-256), encrypted, in this browser.",
  "config.share": "Account sharing",
  "config.shareCopy": "Copy sharing link",
  "config.shareWarn":
    "This link carries everything needed to authenticate on this account: it is worth the password. Only pass it to whoever must use it, and over a safe channel.",
  "config.shareCopied": "Sharing link copied",
  "config.shareManual": "Sharing link, to copy",

  "config.section.nat": "NAT traversal",
  "config.natHint":
    "Servers supplied by your SIP provider. Without them, a call between two private networks can connect perfectly well while nobody hears a thing.",
  "config.stun": "STUN server",
  "config.stunPlaceholder": "stun.example.com:3478",
  "config.stunHint": "Optional. Host on its own or host:port — with no port, 3478 is used.",
  "config.turn": "TURN server",
  "config.turnPlaceholder": "turn.example.com:3478",
  "config.turnHint":
    "Optional — relays the media streams when a direct connection fails. Leave blank if you have none.",
  "config.turnUser": "TURN username",
  "config.turnPass": "TURN password",
  "config.turnPassKeep": "Leave blank to keep the current password.",
  "config.turnTlsLabel": "TURN over TLS",
  "config.turnTlsDesc":
    " — encrypted relay (“turns:”), which still gets through where only TLS traffic is allowed",
  "config.turnTlsHint": "With no port given, 5349 is then used instead of 3478.",
  "config.turnNote":
    "The TURN password, by contrast, is stored (encrypted): the relay asks for the secret itself on every call, so a digest would not do.",

  "config.section.rtt": "Real-time text",
  "config.rttHint":
    "Text is written and read character by character during the call. Which path it takes depends on the platform you are calling.",
  "config.rttTransport": "Transport",
  "config.rttNone": "None",
  "config.rttNoneDesc": " — the call goes as before: nothing is added to what is negotiated",
  "config.rttWs": "Over WebSocket",
  "config.rttWsDesc":
    " — the non-standard format of gateways already deployed: what services in place understand",
  "config.rttDc": "Over data channel",
  "config.rttDcDesc":
    " — the standard (RFC 8865), the one to pick when talking to a standard real-time text client",
  "config.rttNote":
    "Saved with the account. When in doubt, leave it on “None”: offering text changes the offer of every call you make, and a server that is not expecting it may take it badly.",

  "config.section.alerts": "Alerts and display",
  "config.alertsHint":
    "These settings take effect straight away, without waiting for registration — except the flash, which follows the account.",
  "config.flashLabel": "Visual flash on incoming call",
  "config.flashDesc":
    " — the screen flashes while ringing, so you are alerted with the sound off",
  "config.flashHint": "Saved with the account, so it follows you from one device to the next.",
  "config.notifications": "System notifications",
  "config.notifEnable": "Enable notifications",
  "config.notifHint":
    "Without them, Trix cannot alert you while the window is hidden or minimised — it will simply wait, politely.",
  "config.notifOn": "Notifications enabled",
  "config.notifBlocked": "Notifications blocked by the browser",
  "config.notifBlockedHint":
    "Re-enable them in the browser's site settings — Trix cannot ask for permission again itself.",
  "config.theme": "Theme",
  "config.themeHint": "“System” follows your device's light/dark setting.",
  "theme.system": "System",
  "theme.light": "Light",
  "theme.dark": "Dark",

  // Diagnostics — local settings, never saved with the account
  "config.section.diag": "Diagnostics",
  "config.traceLabel": "Trace SIP messages",
  "config.traceDesc":
    " — every packet sent and received, and the states a call goes through, are printed to the browser console",
  "config.traceHint":
    "Takes effect at once, even mid-call: open the console (F12) to read the packets. Each call also keeps its own with its history entry, encrypted, until you clear it. They carry your SIP address and your correspondents' — do strip them from a public bug report.",
  "config.save": "Save and connect",
  "config.saving": "Saving…",
  "config.cancel": "Cancel",
  "config.delete": "Delete this account",
  "config.deleteConfirm": "Confirm: delete {address} and its history",

  // ---------------------------------------------------------------------
  // Phone state
  // ---------------------------------------------------------------------
  "status.connecting": "Connecting…",
  "status.registering": "Registering…",
  "status.ready": "Registered",
  "status.reconnecting": "Reconnecting…",
  "status.sleeping": "Asleep",
  "status.regFailed": "Registration failed",
  "status.unregistering": "Signing out…",
  "status.switching": "Switching account…",

  // ---------------------------------------------------------------------
  // Call state
  // ---------------------------------------------------------------------
  "call.dialing": "Calling",
  "call.ringing": "Ringing",
  "call.earlyMedia": "Network message",
  "call.ringingIn": "Incoming call",
  "call.answering": "Connecting…",
  "call.connected": "In call",
  "call.hangingup": "Ending call",

  // ---------------------------------------------------------------------
  // Call screen
  // ---------------------------------------------------------------------
  "call.targetLabel": "SIP address",
  "call.callerLabel": "Caller",
  "call.domainHint": "Without “@”: calls &lt;address&gt;@{domain}",
  "call.idle": "No call in progress — enter a SIP address",
  "call.sleeping": "Asleep — registration resumes when the device wakes",
  "call.sleepingShort": "Asleep — resumes on wake",
  "call.retryIn": "Reconnecting in 10 s — do bear with us…",
  "call.chooseMode": "Choose call type",
  "mode.audio.label": "Audio call",
  "mode.audio.button": "Start audio call",
  "mode.video.label": "Video call",
  "mode.video.button": "Start video call",
  "mode.text.label": "Text call",
  "mode.text.button": "Start text call",
  "chat.strip": "Chat opens with the call",
  "chat.stripRefused": "Real-time text not accepted by the correspondent",
  // ---------------------------------------------------------------------
  // Real-time text chat (T.140)
  // ---------------------------------------------------------------------
  "chat.tab": "Chat",
  "chat.aria": "Conversation with {peer}",
  "chat.you": "You",
  "chat.typing": "typing",
  "chat.announce": "{who}: {text}",
  "chat.jump.one": "Jump down — {n} message",
  "chat.jump.other": "Jump down — {n} messages",
  "chat.composerAria": "Real-time text message",
  "chat.placeholder": "Type — the text leaves as you write",
  "chat.placeholderClosed": "Text unavailable on this call",
  "chat.placeholderEarly": "Read-only until the call is answered",
  "chat.enterHint": "Enter freezes the bubble",
  "chat.state.open": "Leaving as you type",
  "chat.state.connecting": "Opening real-time text…",
  "chat.state.lost": "Link broken — recovering",
  "chat.state.closed": "Real-time text closed",
  "chat.state.refused": "This correspondent does not take real-time text",
  "chat.state.pending": "Correction in {s} s",
  "chat.note.opened": "Real-time text open",
  "chat.note.lost": "Text lost during the outage",
  "chat.note.broken": "Text link broken — recovering",
  "chat.note.closed": "Real-time text closed",
  "chat.note.refused": "This correspondent does not take real-time text",
  "chat.note.alert": "Alert received",

  /** Reading a past conversation back from the call log (§4.9). */
  "chat.log.open": "Read this call's conversation",
  "chat.log.title": "Conversation — {target}",
  "chat.log.count.one": "{n} message",
  "chat.log.count.other": "{n} messages",
  "chat.log.copy": "Copy",
  "chat.log.copied": "Copied",
  "chat.log.copyFailed": "Copy refused. Sorry about that",
  "chat.log.export": "Export",
  "chat.log.exportFailed": "Export refused",
  "chat.log.close": "Close",
  "chat.log.vttBase": "Times counted from the start of the communication — call of {at}.",
  "chat.log.cut": "Start of the conversation not kept",

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------
  "action.settings": "Settings",
  "action.logout": "Sign out",
  "action.retry": "Try again",
  "action.retryNow": "Try again now",
  "action.fixSettings": "Fix settings",
  "action.unavailableInCall": " (unavailable during a call)",
  "action.switchAccount": "Switch to {address}",

  // ---------------------------------------------------------------------
  // Media controls
  // ---------------------------------------------------------------------
  "ctrl.mic.aria": "Audio",
  "ctrl.mic.add": "Add audio",
  "ctrl.mic.remove": "Remove audio",
  "ctrl.cam.aria": "Video",
  "ctrl.cam.add": "Add video",
  "ctrl.cam.remove": "Remove video",
  "ctrl.share.aria": "Screen sharing",
  "ctrl.share.start": "Share your screen",
  "ctrl.share.stop": "Stop sharing",
  "ctrl.share.busy": "Your correspondent is already sharing their screen",
  "ctrl.media.pending": "Media change in progress…",
  "ctrl.media.last": "Not possible: the call would carry nothing at all",
  "ctrl.selfview.aria": "Self-view",
  "ctrl.selfview.hide": "Hide self-view",
  "ctrl.selfview.show": "Show self-view",
  "share.stageAria": "Screen shared by {peer}",
  "share.zoomGroup": "Zoom on the shared screen",
  "share.zoomIn": "Enlarge the shared screen",
  "share.zoomOut": "Shrink the shared screen",
  "share.zoomReset": "Back to original size",
  "share.zoomLevel": "{n}%",
  "share.zoomHint": "Pinch to zoom; arrow keys to move around",
  "ctrl.swap.aria": "Swap screen and face",
  "ctrl.swap.screen": "Enlarge the shared screen",
  "ctrl.swap.face": "Enlarge the video",
  "ctrl.speaker.aria": "Listening on this device",
  "ctrl.speaker.mute": "Stop listening",
  "ctrl.speaker.unmute": "Resume listening",
  "ctrl.dtmf.aria": "DTMF keypad",
  "ctrl.dtmf.show": "Show the DTMF keypad",
  "ctrl.dtmf.hide": "Hide the DTMF keypad",
  "ctrl.chat.aria": "Chat",
  "ctrl.chat.show": "Show chat",
  "ctrl.chat.hide": "Hide chat",
  "ctrl.chat.unavailable": "Real-time text not accepted by the correspondent",
  "ctrl.fullscreen": "Full screen",
  "ctrl.hangup": "Hang up",
  "ctrl.pause": "Pause",
  "ctrl.pause.aria": "Pause",
  "ctrl.resume": "Resume",
  "pause.banner": "You are paused",
  "pause.hint": "Your microphone and image are stopped. Text keeps flowing.",
  "pause.resume": "Resume",
  "pause.peer": "{peer} is paused",
  "ctrl.group.call": "Call media",
  "ctrl.group.device": "This device",
  "ctrl.more": "More controls",
  "sheet.title": "More call controls",

  // ---------------------------------------------------------------------
  // Clavier DTMF
  // ---------------------------------------------------------------------
  "dtmf.aria": "DTMF keypad",
  "dtmf.sent": "Tones sent",
  "dtmf.hint": "Dial with the keys or your keyboard",
  "dtmf.keyAria": "Key {key}",
  "dtmf.star": "star",
  "dtmf.hash": "hash",

  // ---------------------------------------------------------------------
  // Video requested mid-call
  // ---------------------------------------------------------------------
  "mediaask.video.title": "{peer} would like to add video",
  "mediaask.video.body": "Accepting will turn on your camera.",
  "mediaask.video.accept": "Accept video",
  "mediaask.audio.title": "{peer} would like to add audio",
  "mediaask.audio.body": "Accepting will turn on your microphone.",
  "mediaask.audio.accept": "Accept audio",
  "mediaask.both.title": "{peer} would like to add audio and video",
  "mediaask.both.body": "Accepting will turn on your microphone and camera.",
  "mediaask.both.accept": "Accept both",
  "mediaask.share.title": "{peer} would like to share their screen",
  "mediaask.share.body": "Their screen will take the main surface, and their video will move to a thumbnail. Declining changes nothing to the call.",
  "mediaask.share.accept": "View the screen",
  "mediaask.reject": "Decline",

  // ---------------------------------------------------------------------
  // Passing call messages
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
  // Side panel
  // ---------------------------------------------------------------------
  "panel.aria": "Side panel",
  "panel.showChat": "Show chat",
  "panel.show": "Show side panel",
  "panel.hide": "Hide side panel",
  "panel.handleAria": "Panel width",
  "panel.handleTitle": "Drag to widen the panel — 33% of the width, and not a pixel more",

  // ---------------------------------------------------------------------
  // Display preferences during a call
  // ---------------------------------------------------------------------
  "prefs.fontSize": "Text size",
  "prefs.fontDown": "Decrease text size",
  "prefs.fontUp": "Increase text size",

  // ---------------------------------------------------------------------
  // Incoming call (modal popup)
  // ---------------------------------------------------------------------
  "incoming.kicker.video": "INCOMING VIDEO CALL",
  "incoming.kicker.audio": "INCOMING AUDIO CALL",
  "incoming.kicker.audioText": "INCOMING AUDIO + TEXT CALL",
  "incoming.kicker.videoText": "INCOMING VIDEO + TEXT CALL",
  "incoming.kicker.text": "INCOMING TEXT CALL",
  "incoming.answerVideo": "Answer with video",
  "incoming.answerAudio": "Answer with audio",
  "incoming.answerText": "Answer with text",
  "incoming.reject": "Decline",

  // ---------------------------------------------------------------------
  // Incoming call alert (tab title, system notification)
  // ---------------------------------------------------------------------
  "alert.title": "📞 Incoming call — {caller}",
  "alert.notifTitle": "Incoming call",
  "alert.notifVideo": "{caller} — video call",
  "alert.notifAudio": "{caller} — audio call",
  "alert.notifText": "{caller} — text call",

  // ---------------------------------------------------------------------
  // Screen reader announcements
  // ---------------------------------------------------------------------
  "announce.inCall.one": "In call for {n} minute",
  "announce.inCall.other": "In call for {n} minutes",

  // ---------------------------------------------------------------------
  // Call history
  // ---------------------------------------------------------------------
  "history.title": "History",
  "history.clear": "Clear",
  "history.empty": "No calls yet. Blissfully quiet",
  "history.entryTitle": "{target} — {outcome}",

  // A call's notebook: the SIP packets kept while tracing was on
  "trace.open": "View this call's SIP trace",
  "trace.title": "SIP trace — {target}",
  "trace.count.one": "{n} packet",
  "trace.count.other": "{n} packets",
  "trace.sent": "sent",
  "trace.received": "received",
  "trace.error": "WebRTC error",
  "trace.copy": "Copy",
  "trace.copied": "Copied",
  // S'excuser d'un échec qui n'est pas le sien : rien de plus britannique.
  "trace.copyFailed": "Copy refused. Sorry about that",
  "trace.close": "Close",
  "trace.clipped": "… (packet truncated)",
  "trace.truncated": "Trace cut short: the call went past what is kept per call.",
  "outcome.answered": "Answered",
  "outcome.missed": "Missed",
  "outcome.failed": "Failed",
  "outcome.canceled": "Cancelled",
  "outcome.dropped": "Dropped",
  "endedBy.local": "you rang off",
  "endedBy.remote": "the other party rang off",
  "endedBy.network": "the network gave up",
  "duration.minSec": "{m} min {s} s",
  "duration.sec": "{s} s",

  // ---------------------------------------------------------------------
  // Media statistics (hovering the "In call" pill)
  // ---------------------------------------------------------------------
  "stats.hint": "Media statistics for this call",
  "stats.title": "Media statistics",
  "stats.window": "{s} s average",
  "stats.recv": "Received",
  "stats.sent": "Sent",
  "stats.audio": "Audio",
  "stats.video": "Video",
  "stats.share": "Shared screen",
  "stats.text": "Text",
  "stats.missing": "Missing text",
  "stats.codec": "Codec",
  "stats.bitrate": "Bitrate",
  "stats.loss": "Loss",
  "stats.rtt": "Round trip",
  "stats.sync": "Audio / video skew",
  "stats.syncHint": "Below {n} ms, lip-reading and sign language stay comfortable (F.703 §5.2.2).",
  "stats.lossNote": "Send-side loss as reported by the other party's receiver reports.",
  "stats.pending": "Measuring — won't be a moment…",
  "stats.none": "No media stream measured. Nothing to see here",
  "stats.kbps": "{n} kbit/s",
  "stats.percent": "{n} %",
  "stats.ms": "{n} ms",
  "stats.khz": "{n} kHz",
  "stats.spanCall": "{d} measured average",
  "stats.open": "Media statistics for this call",
  "stats.callTitle": "Media statistics — {target}",
  "stats.close": "Close",
  "stats.copy": "Copy",
  "stats.copied": "Copied",
  "stats.copyFailed": "Copy refused. Sorry about that",
  "selftest.section": "Microphone and camera",
  "selftest.open": "Test my microphone and camera",
  "selftest.sectionHint": "A check outside any call: better to find a silent microphone now than during a conversation.",
  "selftest.title": "Microphone and camera test",
  "selftest.sub": "Nothing is sent: this test stays on this device.",
  "selftest.close": "Close",
  "selftest.starting": "Opening devices…",
  "selftest.hint": "Speak: the bar should move. You should see yourself in the picture.",
  "selftest.levelAria": "Microphone level",
  "selftest.mic": "Microphone",
  "selftest.cam": "Camera",
  "selftest.unnamed": "unnamed device",
  "selftest.absent": "none",
  "selftest.noCamera": "No camera: testing the microphone alone.",
  "selftest.denied": "Access to the microphone and camera was denied. Allow it in the browser, then run the test again.",
  "selftest.missing": "No microphone or camera found on this device.",
  "selftest.busy": "The microphone or camera is already in use by another application.",
  "selftest.failed": "Test failed: {detail}",

  // ---------------------------------------------------------------------
  // State machine errors
  // ---------------------------------------------------------------------
  "error.invalidUri": "Invalid SIP address (expected user@domain)",
  "error.wrongDomain": "This address must be in the {domain} domain",
  "error.duplicateAccount": "{address} is already saved as the other account",
  "error.passwordRequired": "Password required",
  "error.saveFailed": "Could not save: {detail}",
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
  "error.proxyLostDuringCall": "Connection to the proxy lost during the call",
  "error.callDropped": "Call dropped — connection to the proxy lost",
  "error.stunInvalid": "Invalid STUN server (expected host or host:port)",
  "error.turnInvalid": "Invalid TURN server (expected host or host:port)",
  "error.turnUserRequired": "TURN username required (the relay always authenticates)",
  "error.turnPasswordRequired": "TURN password required",

  // ---------------------------------------------------------------------
  // Call end reasons
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
  // Account sharing page (share_account.html)
  // ---------------------------------------------------------------------
  "share.title": "Shared account",
  "share.intro":
    "This link carries the settings of a SIP account. Check them, then create the account on this device.",
  "share.address": "SIP address",
  "share.displayName": "Display name",
  "share.proxy": "SIP server",
  "share.authUsername": "Authentication username",
  "share.ice": "NAT traversal",
  "share.rtt": "Real-time text",
  "share.none": "None",
  "share.warn":
    "This link carries everything needed to authenticate on this account. Once the account is created, do not keep it and do not pass it on.",
  "share.create": "Create this account",
  "share.creating": "Creating…",
  "share.open": "Open Trix",
  "share.noLink": "This link carries no account.",
  "share.malformed":
    "This link cannot be read: it was most likely cut short on the way. Ask for it to be sent again, whole.",
  "share.version":
    "This link comes from a newer version of Trix. Update the application to open it.",
  "share.wrongDomain":
    "This account is in the {domain} domain, which this installation of Trix does not accept.",
  "share.exists": "{address} is already saved on this device. Nothing was changed.",
  "share.full":
    "This device already keeps {max} accounts. Delete one in the settings before adding this one.",
  "share.saveFailed": "The account could not be saved: {detail}",

  "misc.raw": "{text}",
};

export default messages;
