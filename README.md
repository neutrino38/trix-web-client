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
npm run diagrams  # régénère docs/DIAGRAMS.md depuis toMermaid()
```

## État d'avancement

- [x] Phase 0 — specs, conception, maquettes
- [x] Phase 1 — accueil, configuration (HA1 chiffré, jamais de mot de passe stocké), REGISTER
- [x] Phase 2 — écran d'appel (vues bureau et mobile), appels sortants (CallMachine),
      historique chiffré, reconnexion automatique, veille/réveil, observabilité `toMermaid()`
- [x] Phase 3 — appels entrants : réponse audio ou audio+vidéo selon l'offre SDP, refus,
      un appel à la fois (486/480), appels manqués dans l'historique, et **alerte accessible
      aux personnes sourdes** (flash écran, onglet et favicon clignotants, notification
      système, vibration, écran maintenu allumé)
- [ ] Phase 4 — DTMF, tchat sur data channel
- [ ] Phase 5 (future) — empaquetage Tauri

## Observabilité

Dans la console du navigateur :

```js
stauri.mermaid()   // diagrammes Mermaid de PhoneMachine + CallMachine, générés depuis le code
stauri.phone.log   // ring buffer des transitions
stauri.phone.state // état courant
```

Les transitions sont aussi loggées en continu (format Elixip) dans la console.
[docs/DIAGRAMS.md](docs/DIAGRAMS.md) est la version versionnée de ces diagrammes :
un test échoue si le code et le document divergent (`npm run diagrams` pour le régénérer).
