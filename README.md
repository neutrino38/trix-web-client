# STAURI Communicator

Webphone SIP « conversation totale » (audio + vidéo + texte temps réel), en TypeScript,
logique en machines à états [finite-state-language](https://github.com/neutrino38/finite-state-language/),
signalisation [JsSIP](https://jssip.net/), build [Vite](https://vite.dev/).

Documentation : [docs/SPECS.md](docs/SPECS.md) (spécifications),
[docs/CONCEPTION.md](docs/CONCEPTION.md) (conception technique),
[docs/mockups/mockup.html](docs/mockups/mockup.html) (maquettes).

## Commandes

```sh
npm install
npm run dev       # serveur de dev (http://localhost:5173)
npm test          # tests unitaires (machines, HA1, stockage chiffré)
npm run build     # typecheck + build de production (dist/)
```

## État d'avancement

- [x] Phase 0 — specs, conception, maquettes
- [x] Phase 1 — accueil, configuration (HA1 chiffré, jamais de mot de passe stocké), REGISTER
- [ ] Phase 2 — écran d'appel, appels sortants, observabilité `toMermaid()`
- [ ] Phase 3 — appels entrants
- [ ] Phase 4 — DTMF, tchat sur data channel
- [ ] Phase 5 (future) — empaquetage Tauri

## Observabilité

Dans la console du navigateur :

```js
stauri.mermaid()   // diagramme Mermaid de PhoneMachine, généré depuis le code
stauri.phone.log   // ring buffer des transitions
stauri.phone.state // état courant
```

Les transitions sont aussi loggées en continu (format Elixip) dans la console.
