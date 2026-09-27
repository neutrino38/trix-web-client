# Diagrammes des machines — générés, ne pas éditer

Régénérer avec `npm run diagrams`. Source : les `goto()` des machines,
extraits de `src/machines/` par `finite-state-language/diagram`.

Chaque flèche porte les événements qui la déclenchent, et entre parenthèses
le libellé de la transition. `[*]` est la fin de la machine — pour un bloc
de service, la sortie vers son hôte, étiquetée par l'événement rendu. Les
gardes sont ignorées : une branche impossible à l'exécution est quand même
dessinée.

Un état qui entre un bloc n'a pas d'arête sortante tant que le bloc n'a pas
rendu la main : il est suspendu là, et c'est le tableau qui dit dans quel
bloc.

## PhoneMachine — machine

```mermaid
stateDiagram-v2
  state initial_state
  state home
  state configuring
  state reconfiguring
  state saving
  state switching
  state deleting
  state connecting
  state registering
  state ready
  state "in_call" as in_call
  state reconnecting
  state sleeping
  state reg_failed
  state unregistering
  [*] --> initial_state
  initial_state --> connecting: task:loadVault (reprise de l'enregistrement)
  initial_state --> home: task:loadVault
  home --> configuring: ui:configure
  home --> home: ui:useAccount (compte inconnu)
  home --> switching: ui:useAccount (compte choisi)
  configuring --> configuring: ui:saveConfig (URI invalide), ui:saveConfig (domaine imposé), ui:saveConfig (adresse déjà enregistrée), ui:saveConfig (mot de passe manquant), ui:saveConfig (serveur ICE invalide), ui:deleteAccount (aucun compte à supprimer)
  configuring --> saving: ui:saveConfig
  configuring --> deleting: ui:deleteAccount
  configuring --> home: ui:cancelConfig
  reconfiguring --> reconfiguring: ui:saveConfig (URI invalide), ui:saveConfig (domaine imposé), ui:saveConfig (adresse déjà enregistrée), ui:saveConfig (mot de passe manquant), ui:saveConfig (serveur ICE invalide), ui:deleteAccount (aucun compte à supprimer)
  reconfiguring --> saving: ui:saveConfig
  reconfiguring --> deleting: ui:deleteAccount
  reconfiguring --> connecting: ui:cancelConfig (retour à l'appel)
  saving --> connecting: task:saveVault
  switching --> connecting: task:saveVault (compte changé)
  deleting --> home: task:deleteAccount (compte supprimé)
  connecting --> registering: sip:connected (WebSocket ouverte)
  connecting --> reconnecting: sip:invalidProxy (reconnexion auto), sip:disconnected (reconnexion auto), after 10 s (reconnexion auto)
  connecting --> reg_failed: sip:invalidProxy, sip:disconnected, after 10 s
  connecting --> sleeping: sys:sleep (mise en veille)
  registering --> ready: sip:registered (REGISTER OK)
  registering --> reconnecting: sip:registrationFailed (reconnexion auto), sip:disconnected (reconnexion auto), after 30 s (reconnexion auto)
  registering --> reg_failed: sip:registrationFailed, sip:disconnected, after 30 s
  registering --> sleeping: sys:sleep (mise en veille)
  ready --> ready: ui:call (cible vide), sip:incoming (ne pas déranger : 486), sip:registered (re-REGISTER OK), ui:switchAccount (déjà ce compte), ui:switchAccount (compte inconnu), ui:clearHistory (historique vidé), ui:addContact (aucun compte actif), ui:addContact (adresse de contact invalide), ui:addContact (déjà au carnet), ui:addContact (contact ajouté), ui:renameContact (renommage ignoré), ui:renameContact (contact renommé), ui:removeContact (contact inconnu), ui:removeContact (contact retiré), sys:wake (réveil : REGISTER rafraîchi)
  ready --> in_call: ui:call, sip:incoming
  ready --> reg_failed: sip:registrationFailed
  ready --> reconnecting: sip:registrationFailed (REGISTER sans réponse), sip:disconnected (connexion perdue)
  ready --> reconfiguring: ui:backToSettings (retour paramètres)
  ready --> switching: ui:switchAccount (changement de compte)
  ready --> unregistering: ui:logout
  ready --> sleeping: sys:sleep (mise en veille)
  ready --> connecting: sys:wake (réveil : transport fermé)
  in_call --> sleeping: call:answered (veille : appel raccroché), call:missed (veille : appel raccroché), call:canceled (veille : appel raccroché), call:rejected (veille : appel raccroché), call:dropped (veille : appel raccroché)
  in_call --> reconnecting: call:answered (proxy perdu pendant l'appel), call:missed (proxy perdu pendant l'appel), call:canceled (proxy perdu pendant l'appel), call:rejected (proxy perdu pendant l'appel), call:dropped (proxy perdu pendant l'appel)
  in_call --> reg_failed: call:answered (enregistrement perdu pendant l'appel), call:missed (enregistrement perdu pendant l'appel), call:canceled (enregistrement perdu pendant l'appel), call:rejected (enregistrement perdu pendant l'appel), call:dropped (enregistrement perdu pendant l'appel)
  in_call --> ready: call:answered (appel terminé), call:missed (appel terminé), call:canceled (appel terminé), call:rejected (appel terminé), call:dropped (appel terminé)
  reconnecting --> connecting: ui:retry (reconnexion manuelle), sys:wake (réveil : réenregistrement), after 10 s (nouvelle tentative)
  reconnecting --> reconnecting: ui:clearHistory (historique vidé), ui:addContact (aucun compte actif), ui:addContact (adresse de contact invalide), ui:addContact (déjà au carnet), ui:addContact (contact ajouté), ui:renameContact (renommage ignoré), ui:renameContact (contact renommé), ui:removeContact (contact inconnu), ui:removeContact (contact retiré), ui:switchAccount (déjà ce compte), ui:switchAccount (compte inconnu)
  reconnecting --> reconfiguring: ui:backToSettings (paramètres)
  reconnecting --> switching: ui:switchAccount (changement de compte)
  reconnecting --> home: ui:logout (déconnexion)
  reconnecting --> sleeping: sys:sleep (mise en veille)
  sleeping --> connecting: sys:wake (réveil : réenregistrement)
  sleeping --> sleeping: ui:clearHistory (historique vidé), ui:addContact (aucun compte actif), ui:addContact (adresse de contact invalide), ui:addContact (déjà au carnet), ui:addContact (contact ajouté), ui:renameContact (renommage ignoré), ui:renameContact (contact renommé), ui:removeContact (contact inconnu), ui:removeContact (contact retiré), ui:switchAccount (déjà ce compte), ui:switchAccount (compte inconnu)
  sleeping --> home: ui:logout
  sleeping --> switching: ui:switchAccount (changement de compte)
  sleeping --> reconfiguring: ui:backToSettings
  reg_failed --> connecting: ui:retry
  reg_failed --> reg_failed: ui:clearHistory (historique vidé), ui:addContact (aucun compte actif), ui:addContact (adresse de contact invalide), ui:addContact (déjà au carnet), ui:addContact (contact ajouté), ui:renameContact (renommage ignoré), ui:renameContact (contact renommé), ui:removeContact (contact inconnu), ui:removeContact (contact retiré), ui:switchAccount (déjà ce compte), ui:switchAccount (compte inconnu)
  reg_failed --> switching: ui:switchAccount (changement de compte)
  reg_failed --> configuring: ui:backToSettings
  reg_failed --> home: ui:logout
  unregistering --> home: sip:disconnected (déconnecté), after 5 s (déconnexion forcée)
  in_call : sbb CallBlock
```

Blocs entrés depuis cet état (`fx.sbb`) :

| État | Événements |
| --- | --- |
| `in_call` | `CallBlock` |

Événements consommés sans effet sur cette machine :

| État | Événements |
| --- | --- |
| `initial_state` | `sys:sleep`, `sys:wake` |
| `home` | `sip:disconnected`, `sip:unregistered`, `sip:incoming`, `sys:sleep`, `sys:wake` |
| `configuring` | `sip:disconnected`, `sip:unregistered`, `sip:incoming`, `sys:sleep`, `sys:wake` |
| `reconfiguring` | `sip:disconnected`, `sip:unregistered`, `sip:incoming`, `sip:registrationFailed`, `sys:sleep`, `sys:wake` |
| `saving` | `sys:sleep`, `sys:wake` |
| `switching` | `sip:disconnected`, `sip:unregistered`, `sip:registrationFailed`, `sip:incoming`, `sys:sleep`, `sys:wake` |
| `deleting` | `sys:sleep`, `sys:wake` |
| `connecting` | `sip:incoming`, `sys:wake` |
| `registering` | `sip:incoming`, `sys:wake` |
| `ready` | `sip:connected`, `sip:failed`, `sip:ended` |
| `reconnecting` | `ui:call`, `sip:disconnected`, `sip:unregistered`, `sip:incoming`, `sip:registrationFailed`, `sip:invalidProxy` |
| `sleeping` | `sys:sleep`, `ui:call`, `sip:disconnected`, `sip:unregistered`, `sip:incoming`, `sip:registrationFailed` |
| `reg_failed` | `sip:disconnected`, `sip:unregistered`, `sip:incoming`, `sip:registrationFailed`, `sip:invalidProxy`, `sys:sleep`, `sys:wake` |
| `unregistering` | `sip:unregistered`, `sip:registrationFailed`, `sip:incoming`, `sys:sleep`, `sys:wake` |

## CallBlock — bloc de service (SBB)

```mermaid
stateDiagram-v2
  state initial_state
  state dialing
  state ringing
  state early_media
  state ringing_in
  state answering
  state connected
  state preparing
  state renegotiating
  state media_offer
  state hangingup
  [*] --> initial_state
  initial_state --> dialing: enter (INVITE sortant)
  initial_state --> [*]: enter (call:missed)
  initial_state --> ringing_in: enter (INVITE entrant)
  dialing --> [*]: enter (call:rejected), sip:failed (call:rejected), sip:ended (call:canceled)
  dialing --> hangingup: sip:disconnected, sys:sleep, ui:hangup
  dialing --> ringing: sip:progress (180)
  dialing --> early_media: sip:progress (183 + SDP)
  dialing --> connected: sip:accepted (200 OK)
  ringing --> hangingup: sip:disconnected, sys:sleep, ui:hangup
  ringing --> connected: sip:accepted (200 OK)
  ringing --> [*]: sip:failed (call:rejected), sip:ended (call:canceled), after 90 s (call:rejected)
  ringing --> early_media: sip:progress (183 + SDP)
  early_media --> hangingup: sip:disconnected, sys:sleep, ui:hangup
  early_media --> connected: sip:accepted (200 OK)
  early_media --> [*]: sip:failed (call:rejected), sip:ended (call:canceled), after 90 s (call:rejected)
  ringing_in --> hangingup: sip:disconnected, sys:sleep
  ringing_in --> answering: ui:answer (200 OK)
  ringing_in --> [*]: ui:reject (call:missed), ui:hangup (call:missed), sip:failed (call:missed), sip:ended (call:missed), after 60 s (call:missed)
  answering --> hangingup: sip:disconnected, sys:sleep, ui:hangup
  answering --> connected: sip:accepted (200 OK), sip:confirmed (ACK)
  answering --> [*]: sip:failed (call:missed), sip:ended (call:missed), after 30 s (call:missed)
  connected --> hangingup: sip:disconnected, sys:sleep, ui:hangup
  connected --> connected: sip:mediaChanged (média inchangé), sip:mediaChanged, ui:toggleMedia (dernier média), ui:toggleShare (le distant partage déjà), sip:peerSharing, ui:dtmf (DTMF perdu), ui:dtmf (DTMF), ui:togglePause, sip:peerPaused, ui:toggleSelfView (self-view)
  connected --> media_offer: sip:mediaOffer (le distant propose un média ou son écran)
  connected --> preparing: ui:toggleMedia, ui:toggleShare (fin du partage), ui:toggleShare (partage d'écran), sip:shareEnded (partage arrêté par le navigateur)
  connected --> [*]: sip:ended (call:dropped), sip:ended (call:answered), sip:failed (call:dropped)
  preparing --> hangingup: sip:disconnected, sys:sleep, ui:hangup
  preparing --> connected: sip:mediaChanged, sip:mediaChanged (média négocié), sip:mediaRefused (partage refusé), sip:mediaRefused (refus), sip:sharing
  preparing --> renegotiating: sip:offering (offre partie)
  preparing --> preparing: sip:shareEnded (partage arrêté par le navigateur), sip:peerSharing, ui:dtmf (DTMF perdu), ui:dtmf (DTMF), ui:togglePause, sip:peerPaused, ui:toggleSelfView (self-view)
  preparing --> [*]: sip:ended (call:dropped), sip:ended (call:answered), sip:failed (call:dropped)
  renegotiating --> hangingup: sip:disconnected, sys:sleep, ui:hangup
  renegotiating --> connected: sip:mediaChanged, sip:mediaChanged (média négocié), sip:mediaRefused (partage refusé), sip:mediaRefused (refus), sip:sharing, after 28 s (sans réponse)
  renegotiating --> renegotiating: sip:offering (offre reprise), sip:shareEnded (partage arrêté par le navigateur), sip:peerSharing, ui:dtmf (DTMF perdu), ui:dtmf (DTMF), ui:togglePause, sip:peerPaused, ui:toggleSelfView (self-view)
  renegotiating --> [*]: sip:ended (call:dropped), sip:ended (call:answered), sip:failed (call:dropped)
  media_offer --> hangingup: sip:disconnected, sys:sleep, ui:hangup
  media_offer --> connected: sip:mediaChanged (offre caduque), ui:acceptMedia (écran accepté), ui:rejectMedia (488), after 25 s (sans réponse)
  media_offer --> media_offer: sip:peerSharing, ui:dtmf (DTMF perdu), ui:dtmf (DTMF), ui:togglePause, sip:peerPaused, ui:toggleSelfView (self-view)
  media_offer --> renegotiating: ui:acceptMedia
  media_offer --> [*]: sip:ended (call:dropped), sip:ended (call:answered), sip:failed (call:dropped)
  hangingup --> [*]: sip:ended (call:answered), sip:ended (call:dropped), sip:ended (call:missed), sip:ended (call:canceled), sip:failed (call:answered), sip:failed (call:dropped), sip:failed (call:missed), sip:failed (call:canceled), sip:disconnected (call:answered), sip:disconnected (call:dropped), sip:disconnected (call:missed), sip:disconnected (call:canceled), after 2 s (call:answered), after 2 s (call:dropped), after 2 s (call:missed), after 2 s (call:canceled)
```

Événements consommés sans effet sur cette machine :

| État | Événements |
| --- | --- |
| `dialing` | `sip:registrationFailed`, `sip:incoming`, `sip:mediaChanged`, `sip:mediaRefused`, `sip:offering`, `sip:mediaOffer`, `ui:toggleMedia`, `ui:toggleShare`, `sip:sharing`, `sip:shareEnded`, `sip:peerSharing`, `ui:dtmf`, `ui:acceptMedia`, `ui:rejectMedia`, `ui:togglePause`, `sip:peerPaused`, `ui:backToSettings`, `ui:logout`, `ui:switchAccount`, `ui:call`, `ui:clearHistory`, `sip:registered`, `sip:connected`, `sys:wake` |
| `ringing` | `sip:registrationFailed`, `sip:incoming`, `sip:mediaChanged`, `sip:mediaRefused`, `sip:offering`, `sip:mediaOffer`, `ui:toggleMedia`, `ui:toggleShare`, `sip:sharing`, `sip:shareEnded`, `sip:peerSharing`, `ui:dtmf`, `ui:acceptMedia`, `ui:rejectMedia`, `ui:togglePause`, `sip:peerPaused`, `ui:backToSettings`, `ui:logout`, `ui:switchAccount`, `ui:call`, `ui:clearHistory`, `sip:registered`, `sip:connected`, `sys:wake` |
| `early_media` | `sip:registrationFailed`, `sip:incoming`, `sip:mediaChanged`, `sip:mediaRefused`, `sip:offering`, `sip:mediaOffer`, `ui:toggleMedia`, `ui:toggleShare`, `sip:sharing`, `sip:shareEnded`, `sip:peerSharing`, `ui:dtmf`, `ui:acceptMedia`, `ui:rejectMedia`, `ui:togglePause`, `sip:peerPaused`, `ui:backToSettings`, `ui:logout`, `ui:switchAccount`, `ui:call`, `ui:clearHistory`, `sip:registered`, `sip:connected`, `sys:wake`, `sip:progress` |
| `ringing_in` | `sip:registrationFailed`, `sip:incoming`, `sip:mediaChanged`, `sip:mediaRefused`, `sip:offering`, `sip:mediaOffer`, `ui:toggleMedia`, `ui:toggleShare`, `sip:sharing`, `sip:shareEnded`, `sip:peerSharing`, `ui:dtmf`, `ui:acceptMedia`, `ui:rejectMedia`, `ui:togglePause`, `sip:peerPaused`, `ui:backToSettings`, `ui:logout`, `ui:switchAccount`, `ui:call`, `ui:clearHistory`, `sip:registered`, `sip:connected`, `sys:wake` |
| `answering` | `sip:registrationFailed`, `sip:incoming`, `sip:mediaChanged`, `sip:mediaRefused`, `sip:offering`, `sip:mediaOffer`, `ui:toggleMedia`, `ui:toggleShare`, `sip:sharing`, `sip:shareEnded`, `sip:peerSharing`, `ui:dtmf`, `ui:acceptMedia`, `ui:rejectMedia`, `ui:togglePause`, `sip:peerPaused`, `ui:backToSettings`, `ui:logout`, `ui:switchAccount`, `ui:call`, `ui:clearHistory`, `sip:registered`, `sip:connected`, `sys:wake`, `sip:progress` |
| `connected` | `sip:registrationFailed`, `sip:incoming`, `sip:mediaRefused`, `sip:offering`, `sip:sharing`, `ui:acceptMedia`, `ui:rejectMedia`, `ui:backToSettings`, `ui:logout`, `ui:switchAccount`, `ui:call`, `ui:clearHistory`, `sip:registered`, `sip:connected`, `sys:wake`, `sip:confirmed`, `sip:accepted`, `sip:progress` |
| `preparing` | `sip:registrationFailed`, `sip:incoming`, `sip:mediaOffer`, `ui:toggleMedia`, `ui:toggleShare`, `ui:acceptMedia`, `ui:rejectMedia`, `ui:backToSettings`, `ui:logout`, `ui:switchAccount`, `ui:call`, `ui:clearHistory`, `sip:registered`, `sip:connected`, `sys:wake`, `sip:confirmed`, `sip:accepted`, `sip:progress` |
| `renegotiating` | `sip:registrationFailed`, `sip:incoming`, `sip:mediaOffer`, `ui:toggleMedia`, `ui:toggleShare`, `ui:acceptMedia`, `ui:rejectMedia`, `ui:backToSettings`, `ui:logout`, `ui:switchAccount`, `ui:call`, `ui:clearHistory`, `sip:registered`, `sip:connected`, `sys:wake`, `sip:confirmed`, `sip:accepted`, `sip:progress` |
| `media_offer` | `sip:registrationFailed`, `sip:incoming`, `sip:mediaRefused`, `sip:offering`, `sip:mediaOffer`, `ui:toggleMedia`, `ui:toggleShare`, `sip:sharing`, `sip:shareEnded`, `ui:backToSettings`, `ui:logout`, `ui:switchAccount`, `ui:call`, `ui:clearHistory`, `sip:registered`, `sip:connected`, `sys:wake`, `sip:confirmed`, `sip:accepted`, `sip:progress` |
| `hangingup` | `sip:progress`, `sip:accepted`, `sip:confirmed`, `sys:sleep`, `sip:incoming`, `sip:mediaChanged`, `sip:mediaRefused`, `sip:sharing`, `sip:shareEnded`, `sip:peerSharing`, `sip:mediaOffer`, `ui:toggleMedia`, `ui:toggleShare`, `ui:acceptMedia`, `ui:rejectMedia`, `ui:togglePause`, `sip:peerPaused`, `ui:dtmf`, `sip:registrationFailed`, `sip:registered`, `sip:connected`, `sys:wake`, `ui:hangup`, `ui:backToSettings`, `ui:logout`, `ui:switchAccount`, `ui:call`, `ui:clearHistory` |
