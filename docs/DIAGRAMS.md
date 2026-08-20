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
  state connecting
  state registering
  state ready
  state "in_call" as in_call
  state reconnecting
  state sleeping
  state reg_failed
  state unregistering
  [*] --> initial_state
  initial_state --> home: task:loadConfig
  home --> configuring: ui:configure
  home --> connecting: ui:useAccount
  home --> home: ui:useAccount (aucun compte configuré)
  configuring --> configuring: ui:saveConfig (URI invalide), ui:saveConfig (mot de passe manquant), ui:saveConfig (serveur ICE invalide)
  configuring --> saving: ui:saveConfig
  configuring --> home: ui:cancelConfig
  reconfiguring --> reconfiguring: ui:saveConfig (URI invalide), ui:saveConfig (mot de passe manquant), ui:saveConfig (serveur ICE invalide)
  reconfiguring --> saving: ui:saveConfig
  reconfiguring --> connecting: ui:cancelConfig (retour à l'appel)
  saving --> connecting: task:saveConfig
  connecting --> registering: sip:connected (WebSocket ouverte)
  connecting --> reconnecting: sip:invalidProxy (reconnexion auto), sip:disconnected (reconnexion auto), after 10 s (reconnexion auto)
  connecting --> reg_failed: sip:invalidProxy, sip:disconnected, after 10 s
  connecting --> sleeping: sys:sleep (mise en veille)
  registering --> ready: sip:registered (REGISTER OK)
  registering --> reconnecting: sip:registrationFailed (reconnexion auto), sip:disconnected (reconnexion auto), after 30 s (reconnexion auto)
  registering --> reg_failed: sip:registrationFailed, sip:disconnected, after 30 s
  registering --> sleeping: sys:sleep (mise en veille)
  ready --> ready: ui:call (cible vide), sip:registered (re-REGISTER OK), ui:clearHistory (historique vidé), sys:wake (réveil : REGISTER rafraîchi)
  ready --> in_call: ui:call, sip:incoming
  ready --> reg_failed: sip:registrationFailed
  ready --> reconnecting: sip:registrationFailed (REGISTER sans réponse), sip:disconnected (connexion perdue)
  ready --> reconfiguring: ui:backToSettings (retour paramètres)
  ready --> unregistering: ui:logout
  ready --> sleeping: sys:sleep (mise en veille)
  ready --> connecting: sys:wake (réveil : transport fermé)
  in_call --> sleeping: call:answered (veille : appel raccroché), call:missed (veille : appel raccroché), call:canceled (veille : appel raccroché), call:rejected (veille : appel raccroché), call:dropped (veille : appel raccroché)
  in_call --> reconnecting: call:answered (proxy perdu pendant l'appel), call:missed (proxy perdu pendant l'appel), call:canceled (proxy perdu pendant l'appel), call:rejected (proxy perdu pendant l'appel), call:dropped (proxy perdu pendant l'appel)
  in_call --> reg_failed: call:answered (enregistrement perdu pendant l'appel), call:missed (enregistrement perdu pendant l'appel), call:canceled (enregistrement perdu pendant l'appel), call:rejected (enregistrement perdu pendant l'appel), call:dropped (enregistrement perdu pendant l'appel)
  in_call --> ready: call:answered (appel terminé), call:missed (appel terminé), call:canceled (appel terminé), call:rejected (appel terminé), call:dropped (appel terminé)
  reconnecting --> connecting: ui:retry (reconnexion manuelle), sys:wake (réveil : réenregistrement), after 10 s (nouvelle tentative)
  reconnecting --> reconnecting: ui:clearHistory (historique vidé)
  reconnecting --> reconfiguring: ui:backToSettings (paramètres)
  reconnecting --> home: ui:logout (déconnexion)
  reconnecting --> sleeping: sys:sleep (mise en veille)
  sleeping --> connecting: sys:wake (réveil : réenregistrement)
  sleeping --> sleeping: ui:clearHistory (historique vidé)
  sleeping --> home: ui:logout
  sleeping --> reconfiguring: ui:backToSettings
  reg_failed --> connecting: ui:retry
  reg_failed --> reg_failed: ui:clearHistory (historique vidé)
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
| `home` | `sip:disconnected`, `sip:unregistered`, `sip:incoming`, `sys:sleep`, `sys:wake` |
| `configuring` | `sip:disconnected`, `sip:unregistered`, `sip:incoming`, `sys:sleep`, `sys:wake` |
| `reconfiguring` | `sip:disconnected`, `sip:unregistered`, `sip:incoming`, `sip:registrationFailed`, `sys:sleep`, `sys:wake` |
| `saving` | `sys:sleep`, `sys:wake` |
| `connecting` | `sip:incoming`, `sys:wake` |
| `registering` | `sip:incoming`, `sys:wake` |
| `ready` | `sip:connected` |
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
  state ringing_in
  state answering
  state connected
  state hangingup
  [*] --> initial_state
  initial_state --> dialing: enter (INVITE sortant)
  initial_state --> ringing_in: enter (INVITE entrant)
  dialing --> [*]: enter (call:rejected), sip:failed (call:rejected), sip:ended (call:canceled)
  dialing --> hangingup: sip:disconnected, sys:sleep, ui:hangup
  dialing --> ringing: sip:progress (180/183)
  dialing --> connected: sip:accepted (200 OK)
  ringing --> hangingup: sip:disconnected, sys:sleep, ui:hangup
  ringing --> connected: sip:accepted (200 OK)
  ringing --> [*]: sip:failed (call:rejected), sip:ended (call:canceled), after 90 s (call:rejected)
  ringing_in --> hangingup: sip:disconnected, sys:sleep
  ringing_in --> answering: ui:answer (200 OK)
  ringing_in --> [*]: ui:reject (call:missed), ui:hangup (call:missed), sip:failed (call:missed), sip:ended (call:missed), after 60 s (call:missed)
  answering --> hangingup: sip:disconnected, sys:sleep, ui:hangup
  answering --> connected: sip:accepted (200 OK), sip:confirmed (ACK)
  answering --> [*]: sip:failed (call:missed), sip:ended (call:missed), after 30 s (call:missed)
  connected --> hangingup: sip:disconnected, sys:sleep, ui:hangup
  connected --> [*]: sip:ended (call:dropped), sip:ended (call:answered), sip:failed (call:dropped)
  connected --> connected: ui:muteMic, ui:muteCam, ui:toggleSelfView (self-view)
  hangingup --> [*]: sip:ended (call:answered), sip:ended (call:dropped), sip:ended (call:missed), sip:ended (call:canceled), sip:failed (call:answered), sip:failed (call:dropped), sip:failed (call:missed), sip:failed (call:canceled), sip:disconnected (call:answered), sip:disconnected (call:dropped), sip:disconnected (call:missed), sip:disconnected (call:canceled), after 2 s (call:answered), after 2 s (call:dropped), after 2 s (call:missed), after 2 s (call:canceled)
```

Événements consommés sans effet sur cette machine :

| État | Événements |
| --- | --- |
| `dialing` | `sip:registrationFailed`, `sip:incoming`, `ui:backToSettings`, `ui:logout`, `ui:call`, `ui:clearHistory`, `sip:registered`, `sip:connected`, `sys:wake` |
| `ringing` | `sip:registrationFailed`, `sip:incoming`, `ui:backToSettings`, `ui:logout`, `ui:call`, `ui:clearHistory`, `sip:registered`, `sip:connected`, `sys:wake`, `sip:progress` |
| `ringing_in` | `sip:registrationFailed`, `sip:incoming`, `ui:backToSettings`, `ui:logout`, `ui:call`, `ui:clearHistory`, `sip:registered`, `sip:connected`, `sys:wake` |
| `answering` | `sip:registrationFailed`, `sip:incoming`, `ui:backToSettings`, `ui:logout`, `ui:call`, `ui:clearHistory`, `sip:registered`, `sip:connected`, `sys:wake`, `sip:progress` |
| `connected` | `sip:registrationFailed`, `sip:incoming`, `ui:backToSettings`, `ui:logout`, `ui:call`, `ui:clearHistory`, `sip:registered`, `sip:connected`, `sys:wake`, `sip:confirmed`, `sip:accepted`, `sip:progress` |
| `hangingup` | `sip:progress`, `sip:accepted`, `sip:confirmed`, `sys:sleep`, `sip:incoming`, `sip:registrationFailed`, `sip:registered`, `sip:connected`, `sys:wake`, `ui:hangup`, `ui:backToSettings`, `ui:logout`, `ui:call`, `ui:clearHistory` |
