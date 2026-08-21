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

## Doc (in French)

Documentation: [docs/SPECS.md](docs/SPECS.md) (spécifications),
[docs/CONCEPTION.md](docs/CONCEPTION.md) (conception technique),
[docs/mockups/mockup.html](docs/mockups/mockup.html) (maquettes),
[docs/utilisation/deploiement.md](docs/utilisation/deploiement.md) (déploiement).

## Useful commands

```sh
npm install
npm run dev       # dev server (http://localhost:5173)
npm test          # unit tests (state machines, HA1, encrypted storage)
npm run build     # typecheck + production build (dist/)
npm run diagrams  # regenerates docs/DIAGRAMS.md from the machine sources
```

## Deployment

The build is a set of static files. Serve `dist/` over HTTPS — WebRTC needs a secure
context, or the browser denies camera and microphone access. No backend ships with the
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
- [ ] Phase 4 — DTMF, chat over data channel
- [ ] Phase 5 (future) — Tauri packaging

## Observability

From the browser console:

```js
trix.mermaid()   // Mermaid diagrams of PhoneMachine + CallMachine, generated from the code
trix.phone.log   // ring buffer of transitions
trix.phone.state // current state
```

The **Trace SIP messages** checkbox (settings, Diagnostics section) prints every packet
sent and received to the console — header on one line, full packet in a collapsed group.
It is taken at the socket level, so it takes effect immediately, even mid-call, and will
keep working when the transport is not JsSIP's own WebSocket. For JsSIP's own internals,
`JsSIP.debug.enable("JsSIP:*")` is still there.

Transitions are also logged continuously (Elixip format) to the console.
[docs/DIAGRAMS.md](docs/DIAGRAMS.md) is the versioned copy of those diagrams: a test fails if the
code and the document diverge (`npm run diagrams` to regenerate it).
