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
 * Spelling is British throughout ("minimised", "Cancelled").
 *
 * Deliberately left untranslated: "Trix", "Powered by FSL", technical codes
 * (SIP 486, WSS_LOST) and the raw causes JsSIP reports — a searchable error
 * code stops being searchable once it is translated.
 */

import type { Dictionary } from "../types.js";

const messages: Dictionary = {
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

  // ---------------------------------------------------------------------
  // Home screen
  // ---------------------------------------------------------------------
  "home.tagline": "Total Conversation webphone",
  "home.useAccount": "Use this account",
  "home.newAccount": "Set up a new account",
  "fsl.aria": "Powered by FSL — finite-state-language on GitHub (new window)",

  // ---------------------------------------------------------------------
  // Configuration screen
  // ---------------------------------------------------------------------
  "config.title": "Settings",
  "config.section.account": "SIP account",
  "config.proxy": "SIP server",
  "config.proxyPlaceholder": "wss://sip.example.com:8443/ws",
  "config.uri": "SIP address",
  "config.uriPlaceholder": "sip:alice@example.com",
  "config.uriHint":
    "With or without the “sip:” prefix. The domain doubles as the authentication realm.",
  "config.displayName": "Your name",
  "config.authToggle": "Authentication username (if different from {user})",
  "config.authUserDefault": "the user part of the address",
  "config.password": "Password",
  "config.passwordSet": "•••••• (already set)",
  "config.passwordKeep": "Leave blank to keep the current password.",
  "config.ha1Note":
    "The password itself is never stored — only a digest (HA1), encrypted, in this browser.",

  "config.section.nat": "NAT traversal",
  "config.natHint":
    "Servers supplied by your SIP provider. Without them, a call between two private networks can connect with no audio getting through.",
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
    "Without them, Trix cannot alert you while the window is hidden or minimised.",
  "config.notifOn": "Notifications enabled",
  "config.notifBlocked": "Notifications blocked by the browser",
  "config.notifBlockedHint":
    "Re-enable them in the browser's site settings — Trix cannot ask for permission again itself.",
  "config.theme": "Theme",
  "config.themeHint": "“System” follows your device's light/dark setting.",
  "theme.system": "System",
  "theme.light": "Light",
  "theme.dark": "Dark",
  "config.save": "Save and connect",
  "config.saving": "Saving…",
  "config.cancel": "Cancel",

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

  // ---------------------------------------------------------------------
  // Call state
  // ---------------------------------------------------------------------
  "call.dialing": "Calling",
  "call.ringing": "Ringing",
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
  "call.retryIn": "Reconnecting in 10 s…",
  "call.chooseMode": "Choose call type",
  "mode.audio.label": "Audio call",
  "mode.audio.button": "Start audio call",
  "mode.video.label": "Video call",
  "mode.video.button": "Start video call",
  "chat.strip": "Chat — coming in phase 4",

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------
  "action.settings": "Settings",
  "action.logout": "Sign out",
  "action.retry": "Try again",
  "action.retryNow": "Try again now",
  "action.fixSettings": "Fix settings",
  "action.unavailableInCall": " (unavailable during a call)",

  // ---------------------------------------------------------------------
  // Media controls
  // ---------------------------------------------------------------------
  "ctrl.mic.aria": "Microphone",
  "ctrl.mic.mute": "Mute microphone",
  "ctrl.mic.unmute": "Unmute microphone",
  "ctrl.cam.aria": "Camera",
  "ctrl.cam.mute": "Turn camera off",
  "ctrl.cam.unmute": "Turn camera on",
  "ctrl.selfview.aria": "Self-view",
  "ctrl.selfview.hide": "Hide self-view",
  "ctrl.selfview.show": "Show self-view",
  "ctrl.speaker.aria": "Speaker",
  "ctrl.speaker.mute": "Mute speaker",
  "ctrl.speaker.unmute": "Unmute speaker",
  "ctrl.dtmf.aria": "DTMF keypad",
  "ctrl.dtmf.label": "DTMF keypad — coming in phase 4",
  "ctrl.fullscreen": "Full screen",
  "ctrl.hangup": "Hang up",

  // ---------------------------------------------------------------------
  // Side panel
  // ---------------------------------------------------------------------
  "panel.aria": "Side panel",
  "panel.showChat": "Show chat",
  "panel.hide": "Hide side panel",
  "panel.handleAria": "Panel width",
  "panel.handleTitle": "Drag to widen the panel — up to 33% of the width",

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
  "incoming.answerVideo": "Answer with video",
  "incoming.answerAudio": "Answer with audio",
  "incoming.reject": "Decline",

  // ---------------------------------------------------------------------
  // Incoming call alert (tab title, system notification)
  // ---------------------------------------------------------------------
  "alert.title": "📞 Incoming call — {caller}",
  "alert.notifTitle": "Incoming call",
  "alert.notifVideo": "{caller} — video call",
  "alert.notifAudio": "{caller} — audio call",

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
  "history.empty": "No calls yet",
  "history.entryTitle": "{target} — {outcome}",
  "outcome.answered": "Answered",
  "outcome.missed": "Missed",
  "outcome.failed": "Failed",
  "outcome.canceled": "Cancelled",
  "outcome.dropped": "Dropped",
  "endedBy.local": "you hung up",
  "endedBy.remote": "the other party hung up",
  "endedBy.network": "cut off by the network",
  "duration.minSec": "{m} min {s} s",
  "duration.sec": "{s} s",

  // ---------------------------------------------------------------------
  // State machine errors
  // ---------------------------------------------------------------------
  "error.invalidUri": "Invalid SIP address (expected user@domain)",
  "error.passwordRequired": "Password required",
  "error.saveFailed": "Could not save: {detail}",
  "error.invalidProxy": "Invalid proxy name — check the WSS address",
  "error.wssRefused": "Cannot reach the proxy (WSS connection refused)",
  "error.wssTimeout": "The proxy is not responding (WebSocket timeout)",
  "error.badCredentials": "Incorrect SIP address, password or authentication username",
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
  "reason.hungUp": "hung up",
  "reason.sleep": "System sleep",
  "reason.noAnswer": "No answer",
  "reason.declined": "Call declined",
  "reason.missed": "Missed call",
  "reason.missedNoAnswer": "Missed call (no answer)",
  "reason.setupFailed": "Could not set up the call",
  "reason.callFailed": "Could not place the call: {detail}",
  "reason.sip": "{cause} (SIP {code})",

  "misc.raw": "{text}",
};

export default messages;
