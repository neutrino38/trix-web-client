# Trix Communicator

Trix Communicator is an experimental WebRTC phone / IM client that supports Total Conversation
standards. Its purpose is not commercial, but you can derive it to build your own commercial
product, as it is licensed under MIT terms.

Trix is meant to:

- be the playground for developing stateful UIs based on the
  [finite state language](https://github.com/neutrino38/finite-state-language/)
- be used as a test bed for the evolution of this framework
- be the reference web client to test the Elixip project for WebRTC interop
- be used as a playground for developing advanced services such as chatbots over WebRTC,
  location based services and so on

## Guiding principles

- Trix is meant to remain sleek, with few features.
- Trix will remain fully independent from Elixip and interoperable with other backends.
  It will remain independent from any backend.
- Trix may evolve and support other signalling protocols such as XMPP or Matrix.
- Trix will be configurable and customizable through a local JSON config file.
- Trix will consume a simple provisioning interface for accounts.
- Trix will be compatible with some centralized observability service.

## The name

Trix, short for Trixie, is taken from the Lucifer series and evokes a young and playful girl.
The prefix "tri" refers to the three media (audio, video and realtime text) possibly involved
in a total conversation interaction. Finally, the "ix" may be seen as a link with Elixip,
although we keep the two projects fully separate for the sake of interop testing.

## The tech

Trix is a [Vite](https://vite.dev/) project embedding [JsSIP](https://jssip.net/) and using
[finite-state-language](https://github.com/neutrino38/finite-state-language/) as a UI orchestration
framework.

Realtime text transport is the WebRTC data channel.

## Languages

The UI ships in **English, French (France and Québec), Japanese, Simplified Chinese and
Modern Standard Arabic**. The language is picked on the home screen (and in the settings),
each entry under its own flag, with `Automatic` as the first choice — it follows the
browser's language, exact tag first: `fr-CA` gets the Québec French, `fr-CH` the reference
one. Right-to-left is part of the deal: picking Arabic flips the whole layout, side
panel included.

Adding a language means dropping one file in `src/i18n/locales/`, named after its BCP-47
tag (`de.ts`, `zh-Hant.ts`): Vite discovers it, the picker lists it under its own name and
flag — drawn in `ui/flags.ts` where we have one, derived from the tag as an emoji
otherwise —, the writing direction comes from the tag, and the build fails if any message
from the French reference is missing. Nothing else to register. See
[docs/CONCEPTION.md §4.7](docs/CONCEPTION.md).

## Presence

Presence is implemented. Trix watches your contacts over SIP (SUBSCRIBE/NOTIFY, PIDF and
RPID) and publishes your own status (PUBLISH): *Available*, *Busy*, *Away*, *Do not
disturb* — incoming calls are declined and noted — and *Invisible*, with a note and two
automatic rules (*On the phone* during a call, *Away* after 10 minutes idle). Contacts and
calls meet in the **Exchanges thread**, one line per correspondent, on desktop and mobile.

Nothing to configure: what the server supports — everything, your contacts' presence but
not yours, or nothing — is discovered at each registration, and a refusal from another
domain (a conference bridge, a peer server) only affects that domain. An operator who wants no SUBSCRIBE at all
sets `"presence": "no"` in `config.json`.

Instant messages (SIP MESSAGE, in plain text) fill the same thread: written offline, they
leave at the next registration; a message from an unknown address waits for you to accept
it; blocking a contact refuses their calls and messages alike. The SIP server must keep
messages while the page sleeps. `"messaging": "no"` turns it all off. See the [user guide,
section 10](USERGUIDE.md#10-contacts-messages-presence-and-history),
[ADR 0007](docs/architecture/0007-presence.md) and
[ADR 0008](docs/architecture/0008-messagerie.md).

## Documentation

**[USERGUIDE.md](USERGUIDE.md) — the user guide (in English).** Setting up a SIP account,
placing and receiving calls, the deaf-accessible alert, contacts, presence and call
history, the built-in
diagnostics, what is stored and where, and a troubleshooting table. Start here if you want
to *use* Trix rather than build on it.

The rest is in French: [docs/SPECS.md](docs/SPECS.md) (spécifications),
[docs/CONCEPTION.md](docs/CONCEPTION.md) (conception technique),
[docs/DIAGRAMS.md](docs/DIAGRAMS.md) (diagrammes générés depuis le code),
[docs/mockups/mockup.html](docs/mockups/mockup.html) (maquettes),
[docs/utilisation/deploiement.md](docs/utilisation/deploiement.md) (déploiement),
[docs/architecture/](docs/architecture/) (décisions d'architecture, une par fichier).

## Useful commands

```sh
npm install
npm run dev       # dev server (http://localhost:5173)
npm test          # unit tests (state machines, HA1, encrypted storage)
npm run build     # typecheck + production build (dist/)
npm run diagrams  # regenerates docs/DIAGRAMS.md from the machine sources
```

## Deployment

The build is a set of static files — two pages, `index.html` (the client) and
`share_account.html` (the one that receives a shared account link). Serve `dist/` over
HTTPS — WebRTC needs a secure context, or the browser denies camera and microphone
access. Both are plain files: no URL rewriting is needed. No backend ships with the
client: the user types the `wss://` URL of their SIP proxy in the configuration screen,
along with the optional STUN/TURN servers used for NAT traversal (TURN over TLS included).

Ready-to-use vhosts for `trix.example.com`, with security headers, the production CSP and
asset caching:

- Apache 2.4: [config/apache/trix.example.com.conf](config/apache/trix.example.com.conf)
- nginx: [config/nginx/trix.example.com.conf](config/nginx/trix.example.com.conf)

```sh
npm ci && npm run build
sudo cp -r dist/. /var/www/trix/
sudo cp config/apache/trix.example.com.conf /etc/httpd/conf.d/   # or config/nginx/… in /etc/nginx/conf.d/
```

Full steps, required modules and per-distribution paths:
[docs/utilisation/deploiement.md](docs/utilisation/deploiement.md).

## Progress

- [x] Phase 0 — specs, technical design, mockups
- [x] Phase 1 — home screen, configuration (encrypted HA1, password never stored), REGISTER
- [x] Phase 2 — call screen (desktop and mobile views), outgoing calls (CallMachine),
      encrypted call history, automatic reconnection, sleep/wake, observability
- [x] Phase 3 — incoming calls: answering in audio or audio+video depending on the SDP offer,
      rejection, one call at a time (486/480), missed calls in the history, and a
      **deaf-accessible alert** (screen flash, blinking tab title and favicon, system
      notification, vibration, screen kept awake)
- [x] Internationalisation — English/French/Québécois/Japanese/Chinese/Arabic UI, one file
      per language, automatic detection, right-to-left layout, translated call history and
      error messages
- [x] NAT traversal — STUN and TURN (TURN over TLS), configured per account
- [x] Diagnostics — SIP trace, per-call packet log kept with its history entry, live media
      statistics and end-of-call summary
- [x] Phase 4 (DTMF) — 12-key keypad over the video stage, physical keyboard, local
      tone feedback, and an on-screen echo of the tones that actually went out
      (RFC 4733: a DTMF is neither heard here nor carried by any SIP packet)
- [x] Phase 4 (chat) — chat over the WebRTC data channel, total conversation
      experience (adding / removing audio or video from a call)
- [x] Phase 5 (accounts) — deployment configuration through `config.json`, two SIP
      accounts with one registered at a time, and **account sharing by link**: a whole
      account travels in a single URL, created on the other device after a confirmation
      screen (call history never travels — see
      [ADR 0004](docs/architecture/0004-partage-compte-par-lien.md))
- [x] Phase 6 (presence) — contacts kept encrypted in the browser, SIP presence (SUBSCRIBE,
      and PUBLISH grafted onto JsSIP), your own status with do-not-disturb and two automatic
      rules, and the **Exchanges thread**: contacts and calls, one line per correspondent,
      on desktop and mobile. Whatever the server supports is discovered at each
      registration (see [ADR 0007](docs/architecture/0007-presence.md))
- [x] Phase 6 (messaging) — instant messaging (SIP MESSAGE, text/plain) in the same
      thread: messages written offline leave at the next registration, unknown senders
      wait for your answer, contacts can be blocked, and a badge tells about messages
      during a call. The server must keep messages while the page sleeps (see
      [ADR 0008](docs/architecture/0008-messagerie.md))

## Observability

From the browser console:

```js
trix.mermaid()   // Mermaid diagrams of PhoneMachine + CallBlock, generated from the code
trix.dump()      // the last transitions in plain text, to paste into a bug report
trix.phone.log   // ring buffer of transitions
trix.phone.state // current state
```

The **Trace SIP messages** checkbox (settings, Diagnostics section) prints every packet
sent and received to the console — header on one line, full packet in a collapsed group.
It is taken at the socket level, so it takes effect immediately, even mid-call, and will
keep working when the transport is not JsSIP's own WebSocket. For JsSIP's own internals,
`JsSIP.debug.enable("JsSIP:*")` is still there.

The same checkbox turns on two things you can read without the console: the **media
statistics** of the call in progress (codec, bitrate and loss each way over a sliding 10 s
window), revealed from the *In call* pill, and — on each history line — the **packet log**
of that call and its **media summary**, both reopenable from the line and copyable in one
click. Nothing is measured or kept while the box is unticked.

Transitions are also logged continuously (Elixip format) to the console.
[docs/DIAGRAMS.md](docs/DIAGRAMS.md) is the versioned copy of those diagrams: a test fails if the
code and the document diverge (`npm run diagrams` to regenerate it).
