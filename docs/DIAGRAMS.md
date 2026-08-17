# Diagrammes des machines — générés, ne pas éditer

Régénérer avec `npm run diagrams`. Source : les `goto()` des machines,
extraits de `src/machines/` par analyse statique.

Chaque flèche porte les événements qui la déclenchent, et entre parenthèses
le libellé de la transition. `[*]` est la fin de la machine. Les gardes
sont ignorées : une branche impossible à l'exécution est quand même
dessinée.

## PhoneMachine

```mermaid
stateDiagram-v2
  state "initial_state" as initial_state
  state "home" as home
  state "configuring" as configuring
  state "reconfiguring" as reconfiguring
  state "saving" as saving
  state "connecting" as connecting
  state "registering" as registering
  state "ready" as ready
  state "in_call" as in_call
  state "reconnecting" as reconnecting
  state "sleeping" as sleeping
  state "reg_failed" as reg_failed
  state "unregistering" as unregistering
  [*] --> initial_state
  initial_state --> home: task:loadConfig
  home --> configuring: ui:configure
  home --> connecting: ui:useAccount
  home --> home: ui:useAccount (aucun compte configuré)
  configuring --> configuring: ui:saveConfig (URI invalide), ui:saveConfig (mot de passe manquant)
  configuring --> saving: ui:saveConfig
  configuring --> home: ui:cancelConfig
  reconfiguring --> reconfiguring: ui:saveConfig (URI invalide), ui:saveConfig (mot de passe manquant)
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
  ready --> ready: ui:call (cible vide), sip:registered (re-REGISTER OK), ui:clearHistory (historique vidé)
  ready --> in_call: ui:call, sip:incoming
  ready --> reconnecting: sip:registrationFailed (reconnexion auto), sip:disconnected (connexion perdue)
  ready --> reg_failed: sip:registrationFailed
  ready --> reconfiguring: ui:backToSettings (retour paramètres)
  ready --> unregistering: ui:logout
  ready --> sleeping: sys:sleep (mise en veille)
  ready --> connecting: sys:wake (réveil : réenregistrement)
  in_call --> in_call: child:msg (vue d'appel)
  in_call --> sleeping: child:exit (veille : appel raccroché)
  in_call --> reconnecting: child:exit (proxy perdu pendant l'appel)
  in_call --> reg_failed: child:exit (enregistrement perdu pendant l'appel)
  in_call --> ready: child:exit
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
```

Événements relayés à la machine enfant :

| État | Événements |
| --- | --- |
| `in_call` | `ui:hangup`, `ui:muteMic`, `ui:muteCam`, `ui:toggleSelfView`, `ui:answer`, `ui:reject`, `sip:disconnected`, `sys:sleep` |

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
| `in_call` | `sip:incoming`, `ui:backToSettings`, `ui:logout`, `ui:call`, `sip:registered`, `sip:connected`, `sip:registrationFailed`, `sys:wake` |
| `reconnecting` | `ui:call`, `sip:disconnected`, `sip:unregistered`, `sip:incoming`, `sip:registrationFailed`, `sip:invalidProxy` |
| `sleeping` | `sys:sleep`, `ui:call`, `sip:disconnected`, `sip:unregistered`, `sip:incoming`, `sip:registrationFailed` |
| `reg_failed` | `sip:disconnected`, `sip:unregistered`, `sip:incoming`, `sip:registrationFailed`, `sip:invalidProxy`, `sys:sleep`, `sys:wake` |
| `unregistering` | `sip:unregistered`, `sip:registrationFailed`, `sip:incoming`, `sys:sleep`, `sys:wake` |

## CallMachine

```mermaid
stateDiagram-v2
  state "initial_state" as initial_state
  state "dialing" as dialing
  state "ringing" as ringing
  state "ringing_in" as ringing_in
  state "answering" as answering
  state "connected" as connected
  state "hangingup" as hangingup
  [*] --> initial_state
  initial_state --> dialing: entrée (INVITE sortant)
  initial_state --> ringing_in: entrée (INVITE entrant)
  dialing --> [*]: entrée (échec), sip:failed (échec), sip:ended (succès)
  dialing --> ringing: sip:progress (180/183)
  dialing --> connected: sip:accepted (200 OK)
  dialing --> hangingup: ui:hangup (CANCEL)
  ringing --> connected: sip:accepted (200 OK)
  ringing --> [*]: sip:failed (échec), sip:ended (succès), after 90 s (échec)
  ringing --> hangingup: ui:hangup (CANCEL)
  ringing_in --> answering: ui:answer (200 OK)
  ringing_in --> [*]: ui:reject (succès), ui:hangup (succès), sip:failed (succès), sip:ended (succès), after 60 s (succès)
  answering --> connected: sip:accepted (200 OK), sip:confirmed (ACK)
  answering --> [*]: sip:failed (échec), sip:ended (succès), after 30 s (échec)
  answering --> hangingup: ui:hangup (BYE)
  connected --> [*]: sip:ended (succès), sip:failed (échec)
  connected --> hangingup: ui:hangup (BYE)
  connected --> connected: ui:muteMic, ui:muteCam, ui:toggleSelfView (self-view)
  hangingup --> [*]: sip:ended (succès), sip:failed (succès), after 2 s (succès)
```

Événements consommés sans effet sur cette machine :

| État | Événements |
| --- | --- |
| `dialing` | `parent:msg` |
| `ringing` | `sip:progress`, `parent:msg` |
| `ringing_in` | `parent:msg` |
| `answering` | `sip:progress`, `parent:msg` |
| `connected` | `sip:confirmed`, `sip:accepted`, `sip:progress`, `parent:msg` |
| `hangingup` | `sip:progress`, `sip:accepted`, `sip:confirmed`, `parent:msg` |
