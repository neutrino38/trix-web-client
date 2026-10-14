# Journal des versions

Ce journal suit ce qui change pour **les projets affiliés** (ADR 0011). La rubrique
« API noyau » de chaque version décrit les changements de ce qu'exporte `trix/core`
(`src/core/index.ts`), qui est le contrat. Le reste du dépôt est interne.

Les versions suivent semver sur ce contrat. Avant 1.0.0, une version mineure peut le rompre ;
elle le signale alors ici, sous « API noyau », par la mention **Rupture**. La 1.0.0 viendra à
la fin du chantier d'affiliation (ADR 0011, étape 9).

## Non publiée

### API noyau

- `package.json` déclare `"exports": { "./core": "./src/core/index.ts" }`. Un affilié importe
  `trix/core`, et rien d'autre (ADR 0011, D11).
- La façade exporte maintenant tous les types nommés qu'on rencontre dans ses propres
  exports. Avant, un affilié ne pouvait pas nommer le type d'un champ de la vue sans importer
  un module interne. `test/contract.test.ts` le vérifie désormais. Types ajoutés :
  - **conversation** : `ChatBubble`, `ChatNote`, `ChatRun`, `ChatSide`, `T140Attrs`,
    `ConversationEvent`, `RttState`, `RttTransport` ;
  - **appels et historique** : `CallNotice`, `CallDirection`, `CallOutcome`, `TraceLine`,
    `Direction`, `Flow`, `TextFlow` ;
  - **messagerie** : `MessageState`, `ComposingPeer`, `FileAttachment`, `UploadFile` ;
  - **présence** : `Presence`, `PresenceInfo`, `PublishedPresence` ;
  - **autres** : `ThreadCall`, `IceConfig`, `TurnServer`, `Sink`.
- Trois fonctions pures sont maintenant exportées : `bubbleText` (le texte d'une bulle),
  `isVoiceMessage` et `isExpired` (pour une pièce jointe).
- Le noyau compile maintenant sous les options strictes qu'un affilié peut activer :
  `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`,
  `noImplicitOverride`, `noImplicitReturns` et `noFallthroughCasesInSwitch`. Les options de
  pur style, comme `noPropertyAccessFromIndexSignature`, ne sont pas prises en charge.
- **Correction** : `call.onStreams` suit maintenant tous les appels. Avant, l'écouteur
  s'accrochait à la session de l'appel en cours : posé hors appel, il était ignoré sans
  message, et posé pendant un appel, il disparaissait avec lui. Un affilié qui s'abonnait une
  seule fois n'entendait donc pas les appels suivants. On s'abonne maintenant une fois, même
  avant `ready`. L'écouteur est aussi prévenu quand un appel commence ou se termine.
- `examples/minimal/` est une seconde interface qui n'utilise que `trix/core` : comptes, appel
  audio avec texte en temps réel, fil Échanges, messages et statut. Elle se lance avec
  `npm run example`.

## 0.10.9 — 2026-10-14

### API noyau

Aucun changement.

## 0.10.0 — 2026-10-02

### API noyau

Première version de la façade : `createTrix`, `TrixView`, `Platform` et `browserPlatform`,
ainsi que le catalogue des messages du noyau (`formatMsg`, `loadCoreMessages`). Les versions
0.10.1 à 0.10.8 l'ont complétée au fil des étapes 5 à 7 de l'ADR 0011 et de l'ADR 0012
(pièces jointes), sans journal.
