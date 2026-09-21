# Trix Communicator — User Guide

Trix Communicator is a Total Conversation webphone: audio, video and real-time text, in
a browser tab. It talks SIP over a secure WebSocket to your own SIP provider. There is no
Trix server and no Trix account — everything lives in your browser.

This guide covers the application as shipped today (phases 0 to 4). The DTMF keypad and
real-time text chat are in place; the chat transcript export is still to come.

---

## Contents

1. [Before you start](#1-before-you-start)
2. [The home screen](#2-the-home-screen)
3. [Setting up your SIP account](#3-setting-up-your-sip-account)
4. [Getting through NAT: STUN and TURN](#4-getting-through-nat-stun-and-turn)
5. [Alerts, display and diagnostics](#5-alerts-display-and-diagnostics)
6. [Registration status](#6-registration-status)
7. [Making a call](#7-making-a-call)
8. [During a call](#8-during-a-call)
9. [Receiving a call](#9-receiving-a-call)
10. [Call history](#10-call-history)
11. [Diagnosing a call](#11-diagnosing-a-call)
12. [On a phone](#12-on-a-phone)
13. [Accessibility](#13-accessibility)
14. [Your data](#14-your-data)
15. [Troubleshooting](#15-troubleshooting)

---

## 1. Before you start

You need:

- **A modern browser with WebRTC** — Chrome, Edge, Firefox or Safari, kept up to date.
- **An HTTPS address.** WebRTC only works in a secure context; over plain HTTP the browser
  refuses access to your camera and microphone. `http://localhost` counts as secure, so a
  local development server works too.
- **A SIP account that accepts SIP over secure WebSocket (WSS).** Your provider gives you
  the WSS URL of their proxy, your SIP address and your password. Trix cannot register
  against a proxy that only speaks UDP or TCP.

Camera and microphone permission is asked for by the browser the first time a call needs
them, not when Trix starts.

## 2. The home screen

The first screen shows the Trix icon, the product name, and the **version number** — quote
it whenever you report a problem.

- **Interface language.** The picker offers *Automatic* (which follows your browser's
  language and names the language it detected), English, French, Québécois, Japanese,
  Simplified Chinese and Modern Standard Arabic. Choosing Arabic flips the whole layout
  right-to-left, side panel included. The same picker is in Settings, so you can change
  your mind later.
- **Use this account** appears only once an account has been saved, with the display name
  and `user@domain` shown underneath. It connects and registers straight away.
- **Set up a new account** opens the settings form. With no account stored, this is the
  main button.

## 3. Setting up your SIP account

The settings form has three columns (one column on a narrow window). The first is the
account itself.

| Field | What to enter |
|---|---|
| **SIP server** | The secure WebSocket URL of your provider's proxy, e.g. `wss://sip.example.com:8443/ws` |
| **SIP address** | `alice@example.com`, with or without the `sip:` prefix. The domain doubles as the authentication realm — there is no separate realm field |
| **Your name** | Free text. This is the display name your correspondents see |
| **Authentication username** | Optional. Tick the box only if your provider authenticates you under a name different from the user part of your address. The reminder text follows what you type in the address field |
| **Password** | Used once, then thrown away — see below |

Press **Save and connect**. Trix computes HA1 digests from your credentials — one in
MD5, one in SHA-256, because it is the server that picks which one its challenge uses —
stores those, and forgets the password itself. On a later visit the password field shows
`•••••• (already set)`: **leave it blank to keep the stored digests**, or type a new
password to replace them.

If the server rejects the registration, the form comes back with the reason in plain
language, the raw SIP code underneath, and the offending field highlighted.

**Cancel** returns to the home screen without saving.

## 4. Getting through NAT: STUN and TURN

The second column holds the servers your provider supplies for NAT traversal. Without
them, a call between two private networks can connect and still carry no audio.

| Field | What to enter |
|---|---|
| **STUN server** | Optional. Host on its own or `host:port`; with no port, 3478 is used |
| **TURN server** | Optional. Same format. A TURN server relays the media when a direct connection cannot be made |
| **TURN username** / **TURN password** | Required as soon as a TURN server is given — a relay always authenticates |
| **TURN over TLS** | Encrypted relay (`turns:`), which still gets through networks that only allow TLS traffic. With no port given, 5349 is then used instead of 3478 |

The three TURN sub-fields stay greyed out until you name a TURN server.

Unlike your SIP password, the **TURN password is stored** (encrypted): the relay asks for
the secret itself on every call, so a digest would not do.

## 5. Alerts, display and diagnostics

The third column mixes settings that belong to the account with settings that belong to
this browser. The difference matters: account settings are encrypted and travel with your
account; browser settings take effect immediately and stay on this device.

| Setting | Where it lives | What it does |
|---|---|---|
| **Visual flash on incoming call** | Account | The screen flashes while ringing, so you are alerted with the sound off. On by default |
| **System notifications** | Browser | Press **Enable notifications** to grant permission. Without it, Trix cannot alert you while the window is hidden or minimised. If the browser has blocked them, Trix says so — it cannot ask again itself, you have to re-enable them in the browser's site settings |
| **Warn me when I become unreachable** | Browser | A notification when the browser puts the tab to sleep or the registration drops, and another once everything is back. Same permission as incoming calls, separate setting — being told someone is calling you is not the same as being told that nobody can any more. On by default; see [staying reachable](#staying-reachable-in-a-background-tab) |
| **Theme** | Browser | *System* (the default, following your device's light/dark setting), *Light* or *Dark* |
| **Interface language** | Browser | Same picker as the home screen |
| **Test my microphone and camera** | Browser | Opens a self-test that stays on this device — see below |
| **Trace SIP messages** | Browser | Turns on the diagnostics described in [section 11](#11-diagnosing-a-call) |

**Testing your microphone and camera.** The button opens a small window showing the
picture you would send and a bar that moves with your voice, plus the names of the
devices your browser picked. Nothing is sent anywhere and no sound is played back — the
bar is what tells you the microphone works, whether or not you can hear it. If there is
no camera, the microphone is tested on its own. If something is wrong, the window says
what to do about it: allow access in the browser, plug a device in, or close the other
application holding it. Better to find a silent microphone here than in the middle of a
conversation.

## 6. Registration status

The pill at the top left of the call screen always says where the phone stands:

| Pill | Meaning |
|---|---|
| **Connecting…** | Opening the WebSocket to the proxy |
| **Registering…** | REGISTER sent, waiting for the answer |
| **Registered** (green) | Ready to call and be called; your address is shown next to it |
| **Reconnecting…** | The connection dropped. Trix retries on its own — the screen offers **Try again now** if you do not want to wait |
| **Asleep** | The device went to sleep. Registration resumes on wake, with nothing to do |
| **Registration failed** (red) | The reason is spelled out on the stage, with the raw SIP code below and two buttons: **Fix settings** and **Try again** |
| **Signing out…** | Unregistering before returning to the home screen |

Two buttons sit at the top right: **Settings** (unregisters, then reopens the form) and
**Sign out** (unregisters, closes the socket, returns home). Both are disabled during a
call.

### Staying reachable in a background tab

A browser tab is not a phone that sits on a desk. Chrome's Energy Saver **freezes** a tab
that has been hidden for about five minutes, and its Memory Saver **discards** one
outright to reclaim memory. Both are on by default, for everybody, and neither asks. The
tab stays in the strip with its title and its icon — but nothing in it runs any more, and
nobody can call you.

Trix will not fight this, and will not play the usual tricks to escape it — a silent
looping audio track or a phantom media stream would drain your battery to work around a
decision your browser made on your behalf. It does three things instead.

**It hangs up cleanly.** Freezing is announced a fraction of a second in advance, and
that is the last moment any code of ours runs: Trix uses it to unregister. A contact that
has been withdrawn is something your provider can act on — it can send the caller to
voicemail. A contact still listed with nobody behind it just rings into the void.

**It tells you.** While you cannot receive calls, the call screen says so in a full
sentence, the tab title and icon change (steadily, never blinking — there is nothing to
pick up), and after ten continuous seconds a system notification goes out, but only if
the window is hidden. The ten seconds are there so that a three-second reconnection does
not wake anyone. When you are reachable again, a second notification says so and replaces
the first.

**It comes back on its own.** Return to the tab — or reload it, or reopen the browser —
and Trix registers again with nothing to click. If the browser had discarded the tab, the
screen tells you the period you were unreachable, for instance *“from 14:05 to 14:52”*, so
you know what to make of any missed call in that window. Nothing is filtered on arrival: a
call that was placed while you were asleep still rings, and if the caller has already hung
up it still lands in your history as a missed call. That is the truth, and it is the most
useful thing the episode has to tell you.

**What you can do about it.** Two gestures, both in your browser, both outside Trix:

- **Pin the tab.** Right-click the tab, *Pin*. A pinned tab is far less likely to be
  discarded.
- **Add Trix to the sites that stay active.** In Chrome: *Settings → Performance*, then
  add the Trix address to *Always keep these sites active*. In Edge, the same list sits
  under *Settings → System and performance*.

Neither is needed while you are on a call: an open WebRTC connection already exempts the
tab from freezing. The vulnerable moment is exactly the one where a phone should be most
dependable — registered, waiting for a call.

## 7. Making a call

Type the address in the **SIP address** field, then press <kbd>Enter</kbd> or the call
button.

- **A bare name is completed for you.** Typing `bob` calls `bob@` your configured domain.
  The hint under the field reminds you which domain that is.
- **The call button is split.** The main half places the call; the ▾ half opens a small
  menu with **Audio call** and **Video call**. Picking one is remembered and renames the
  main button (*Start audio call* / *Start video call*), so the next call goes out the same
  way with a single click. The call only ever leaves through the main button — choosing a
  mode never dials.
- **Clicking a history line** fills the address field, ready to call back.

While the call is being set up, the stage shows *Calling…* then *Ringing…* with the
address you dialled, and you hear a ringing tone — Trix produces it locally, because a
SIP call carries no sound of its own before it is answered.

- **If the other end plays something first** — an operator's ringing tone, a greeting, a
  voice menu — the stage says *Network message* and Trix stops its own tone rather than
  talking over it. The greeting may also arrive as **video** (sign language) or as
  **real-time text**, in which case the tone keeps playing: nothing is filling the
  silence, and you should not be left thinking the line is dead.
- **A subtitled greeting shows up in the text panel.** A service that answers with a
  recorded message can send its subtitles as real-time text before picking up; they
  appear in the thread like any other message.
- **Before the call is answered, nothing is changed and nothing real is sent.** The audio
  and video buttons and Pause stay inactive, and the text panel can be read but not typed
  into — there is no one at the other end yet to receive what you would write. Your
  microphone and camera stay silent and black on the wire until someone answers, so a
  machine playing a greeting never hears your room. You still see yourself in the
  self-view: that picture is local.

## 8. During a call

The remote video fills the stage; your own camera sits in a small inset at the top. Two
thin vertical bars beside the video are level meters — the far end's audio and your own —
so you can see that sound is flowing even if you cannot hear it.

The controls float in a bar over the video:

| Control | Effect |
|---|---|
| **Microphone** | Takes the audio out of the call, or puts it back. This is renegotiated with the other party, who sees it happen — it is not a mute |
| **Camera** | Takes the video out of the call, or puts it back (video calls only) |
| **Share screen** | Puts a window, a tab or your whole screen into the call, alongside your camera. Desktop browsers only — see below |
| **Self-view** | Hides or shows your own picture. Purely local — the other side is unaffected |
| **Listening** | Stops the incoming audio *on this device*. Nothing leaves the call: the other party keeps talking, and the remote level meter keeps moving while you hear nothing. It lights up green while they are speaking |
| **DTMF keypad** | Opens a 12-key pad over the video. The physical keyboard works too, and the tones that actually went out are echoed on screen |
| **Chat** | Shows or hides the real-time text thread (mobile view; on the desktop it lives in the side panel) |
| **Swap** | While the other party is sharing, swaps the big surface and the inset — their face back to full size, their screen to the corner. Purely local; tapping the inset does the same |
| **Full screen** | Same as double-clicking the video, but reachable from the keyboard |
| **Side panel** | Collapses the panel so the video takes the whole width |
| **Hang up** (red circle) | Ends the call. It stays available with the panel collapsed |

A medium that has left the call is shown in **red with a struck-through icon**; a purely
local toggle (self-view, listening, keypad, swap) is shown in **purple**; **green** says
your screen is in the call — something *more* is going out, the exact opposite of what
red means. Red therefore says
one thing only: *this medium is no longer in the call*. The struck-through icon carries
the state on its own, so the colour is never the only clue.

On the desktop bar, a vertical rule separates the two call media from everything after
it — listening, self-view, keypad, full screen, statistics, panel toggles — none of
which the other party ever sees. Each side is announced as a group ("Call media", "This
device") to screen readers and keyboard users.

### Sharing your screen

**Share screen** asks the browser which window, tab or screen to share, then adds it to
the call as a *second* video — your camera keeps running and the other party keeps seeing
your face. For two people signing, a share that replaced the camera would amount to
hanging up.

- **The other party is asked first.** A shared screen takes the big surface, and their
  view of you shrinks to an inset: that is their decision, not yours. They can decline
  without anything else changing — the call carries on exactly as it was — and a share
  that gets no answer within 25 seconds counts as declined.
- **Stopping.** Press the button again, or use the browser's own *Stop sharing* bar:
  either way the screen leaves the call and the other party is told.
- **One share at a time.** While they are sharing, your own button is greyed and says so;
  while you are, theirs is.
- **Pause stops the sharing too.** Nothing you send goes out during a pause — screen
  included. A work screen shows notifications, e-mails and names, so this one is not
  negotiable.
- **The button only exists where the machine can capture a screen**, which in practice
  means a desktop browser. Receiving a share needs nothing special and works everywhere,
  phones included.

**When someone shares with you**, their screen takes the stage — fitted whole, never
cropped, because cropping a shared screen cuts off text — their camera moves to an inset,
and your self-view folds away (the button brings it back). Tap the inset, or use **Swap**,
to put their face back in the big surface without refusing the share.

**Zooming in on it.** Fitting the whole screen in is not the same as being able to read
it: a desktop screen shrunk to phone width is complete and illegible. Pinch to zoom in,
then drag with one finger to move around. The same is reachable without a touch screen:
the **− / % / +** pad in the corner of the shared screen does it with single clicks, and
with the screen focused the keyboard does too — <kbd>+</kbd> and <kbd>−</kbd> to zoom,
the arrow keys to move, <kbd>0</kbd> to go back to the whole picture. On a laptop
trackpad, <kbd>Ctrl</kbd> + two-finger scroll works as a pinch.

Zooming is yours alone: nothing goes over the wire, and the other party keeps sending the
same picture. It goes back to 100% when their screen leaves the stage.

The call timer runs in the top bar, next to the *In call* pill.

**The side panel** can be resized by dragging the handle on its inner edge, or with the
arrow keys once the handle has focus (<kbd>Home</kbd> and <kbd>End</kbd> jump to the
extremes). It never goes below 300 px, nor above a third of the window. Its width and
collapsed state are remembered.

At the foot of the panel, **A−** and **A+** change the text size — the one setting worth
adjusting mid-conversation.

## 9. Receiving a call

An incoming call opens a modal dialog over the whole screen. It names the caller (their
display name if the invitation carries one, their address otherwise) and says in its
heading whether the call is audio or video.

**The answer buttons follow what the caller offered**, and nothing else:

- offered audio and video → **Answer with video** and **Answer with audio**;
- offered audio only → **Answer with audio** alone;
- offered video only → **Answer with video** alone.

**Decline** rejects the call, and so does <kbd>Esc</kbd>. The rest of the screen is inert
while the dialog is up: answering or declining is the only thing to do.

**Being alerted without sound.** Trix is built for people who cannot rely on a ringtone,
so every channel a browser offers runs in parallel:

| Channel | Covers the case where… |
|---|---|
| Full-screen flash | The application is on screen |
| Blinking tab title | Trix is in a background tab |
| Blinking favicon | Same, spotted at a glance in the tab strip |
| System notification | The window is hidden or minimised |
| Vibration | The phone is in a pocket or face down |
| Screen wake lock | The screen was about to go dark — a flash on a dark screen alerts nobody |

The flash beats well under one cycle per second and uses no saturated red, which keeps it
below the photosensitivity threshold; if your system asks for reduced motion, it becomes a
steady frame instead of a blinking one. It is the only channel you can turn off (in the
account settings). A discreet ringtone plays as well, as a complement — never as the main
signal.

**One call at a time.** A second incoming call while you are busy is refused
automatically.

## 10. Call history

The panel keeps the last 50 calls for this account, encrypted. Each line shows the
direction, the correspondent, a camera icon for video calls, the time (or date and time,
past today), and how the call ended:

| Outcome | Meaning |
|---|---|
| **Answered** | Connected, with the duration and who hung up — you, the other party, or the network |
| **Missed** | An incoming call you did not take |
| **Cancelled** | An outgoing call you gave up before it was answered |
| **Failed** | The call could not be set up; the SIP cause is shown |
| **Dropped** | The connection to the proxy was lost mid-call |

Click a line to fill the address field and call back. **Clear** empties the list.

History reads in whichever language the interface is set to, including calls made in
another one.

## 11. Diagnosing a call

Tick **Trace SIP messages** in the Diagnostics section of Settings. It takes effect at
once — even mid-call — and switches on three things.

**In the browser console** (F12): every SIP packet sent and received, header on one line
and the full packet in a collapsed group, interleaved with the state transitions of the
call. Seeing them side by side is the point: a `180 Ringing` with no matching transition
is invisible in either trace on its own.

**Media statistics, live.** During a call, the *In call* pill becomes a button. Hover it,
give it keyboard focus, or click it — clicking pins it open — and it reveals the codec,
bitrate and packet loss of each direction, for each of audio and video, plus the round
trip time. The figures cover a **sliding 10-second window**, never the whole call: a
perfect minute must not hide the ten seconds that broke up.

A shared screen gets **its own row**, separate from *Video*: added to the camera's
figures, a screen at 2 Mbit/s would make a camera that has stopped sending look
excellent — and it would throw off the skew below.

Two more figures matter to accessibility and get their own place there:

- **Missing text.** Real-time text has no bitrate worth reading; what counts is how often
  text was lost. Each gap — whether the channel dropped here or the far end reports one of
  its own — is counted and shown on the *Text* row.
- **Audio / video skew**, the one figure with a target set by a standard: below 100 ms,
  lip-reading and sign language stay comfortable (ITU-T F.703 §5.2.2). It is signed, so
  you can tell sound running ahead of picture from sound running behind, and it is
  highlighted past the threshold. A dash means it cannot be measured — an audio-only call,
  or a browser that does not report it. A shared screen is left out of it: what the
  standard is about is voice against face, and a document scrolling a second late bothers
  nobody.

**Two icons in the history**, on calls that took place with tracing on:

- the **scroll** reopens that call's packet log — the console, after the fact, with each
  packet's body unfolding on click;
- the **magnifier** reopens its media summary — the same table as the live one, but
  averaged over the whole measured call.

Both dialogs have a **Copy** button that puts the contents on the clipboard as plain text,
ready to paste into a ticket.

> **Before sharing.** Traces carry your SIP address and your correspondents'. They are
> encrypted on disk, but strip them before attaching them to a public bug report.

With the box unticked, nothing is measured and nothing is kept: the pill goes back to
being a pill, and new calls store no trace.

## 12. On a phone

Below 720 px wide, Trix switches to a phone layout. You can also force it from a desktop
with `?layout=mobile` in the URL, or `?layout=desktop` the other way.

Switching layouts does not interrupt anything — neither the call nor the registration.

Out of a call, the phone view shows the status, the address field, the split call button
and the history. In a call, the video takes the screen, the timer is inset in the corner,
the media controls float at the bottom of the picture and the red circle hangs up.

## 13. Accessibility

- **Nothing depends on sound.** See [section 9](#9-receiving-a-call).
- **Nothing depends on colour alone.** Cut streams are struck through as well as red;
  measured values stay legible without their highlight.
- **Everything is reachable from the keyboard**, including full screen and the panel
  resize handle.
- **The incoming-call dialog traps focus** while it is open and gives it back where it
  came from.
- **The tab title follows the state** — the caller's name while ringing, the running timer
  during a call — so a background tab still says what is happening.
- **Screen readers are told about state changes**, and the in-call announcement ticks by
  the minute rather than by the second.
- **Text size** is adjustable from the panel, and the interface follows the browser's own
  zoom.

## 14. Your data

Everything Trix keeps stays in this browser, encrypted with a non-extractable key held by
the browser itself. Nothing is sent anywhere except to the SIP proxy you configured.

| Kept | Where | Note |
|---|---|---|
| Your account (server, address, display name, HA1 digests, ICE servers, flash setting) | Encrypted, in the browser database | **Your SIP password is never stored** — only the digests computed from it |
| TURN password | Encrypted, same place | Stored in full, because the relay needs the secret itself |
| Call history, with any traces and media summaries | Encrypted, same place, per account | **Clear** in the history head removes it |
| Theme, language, text size, panel width, preferred call mode, tracing on/off | Browser local storage | Plain display preferences, no personal data |

Clearing the site's data in your browser removes all of it, account included.

## 15. Troubleshooting

| What you see | What it usually means |
|---|---|
| *Invalid SIP address (expected user@domain)* | The address field needs a domain — `alice@example.com`, not `alice` |
| *Invalid proxy name — check the WSS address* | The SIP server field is not a usable `wss://` URL |
| *Cannot reach the proxy (WSS connection refused)* | Wrong host or port, or the proxy is down. Check the URL with your provider |
| *The proxy is not responding (WebSocket timeout)* | Nothing answered. A firewall between you and the proxy is the usual culprit |
| *Incorrect SIP address, password or authentication username* | Credentials rejected. If your provider authenticates you under a separate name, tick **Authentication username** and fill it in |
| *This server asks for SHA-256 authentication, and this account has no such digest* | The account was saved before Trix computed SHA-256 digests, or arrived through a sharing link made by an older version. Your password is probably fine — open the settings and type it again, and the missing digest is computed |
| *Registration refused: …* | The registrar said no, for the reason given. The raw SIP code sits underneath |
| *The registrar is not responding* | The socket is up but the REGISTER went unanswered |
| *Connection to the proxy lost* | The network dropped. Trix reconnects on its own |
| *TURN username required* / *TURN password required* | A TURN server always authenticates; both fields are needed |
| *Invalid STUN server* / *Invalid TURN server* | Give a host, or `host:port` — no scheme, no path |
| **The call connects but there is no sound or picture** | Almost always NAT. Fill in the STUN and TURN servers your provider gave you ([section 4](#4-getting-through-nat-stun-and-turn)) |
| **The browser never asks for camera or microphone** | The page is not in a secure context. Serve it over HTTPS |
| **No system notification while the window is hidden** | Permission was never granted, or was blocked. See [section 5](#5-alerts-display-and-diagnostics) |
| **The screen does not flash on an incoming call** | The flash is off in your account settings, or your system asks for reduced motion — in which case it is a steady frame instead |
| **The tab says “You cannot receive calls”** | The browser has put the tab to sleep, the machine has, or the registration has dropped. Come back to the tab and Trix registers again by itself — see [staying reachable](#staying-reachable-in-a-background-tab) |
| **Callers said it rang into the void while the tab was open in the background** | Chrome froze or discarded the tab. Pin it and add Trix to the sites that stay active, as described in [staying reachable](#staying-reachable-in-a-background-tab) |

If none of this helps, tick **Trace SIP messages**, reproduce the problem, then copy the
call's trace from the history ([section 11](#11-diagnosing-a-call)) and attach it to your
report, along with the version number from the home screen — after removing the addresses
you would rather not publish.

---

Trix Communicator is MIT-licensed and interoperates with any standards-compliant SIP
backend. See [README.md](README.md) for what it is and how to build it, and `docs/` for
the specification and technical design (in French).
