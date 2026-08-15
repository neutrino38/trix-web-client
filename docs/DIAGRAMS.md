# Diagrammes des machines — générés, ne pas éditer

Régénérer avec `npm run diagrams` (source : `toMermaid()` des machines).

## PhoneMachine

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
  state in_call
  state reconnecting
  state sleeping
  state reg_failed
  state unregistering
  [*] --> initial_state
  note right of initial_state
    on: task:loadConfig
  end note
  note right of home
    on: ui:configure, ui:useAccount, sip:disconnected, sip:unregistered, sys:sleep, sys:wake
  end note
  note right of configuring
    on: ui:saveConfig, ui:cancelConfig, sip:disconnected, sip:unregistered, sys:sleep, sys:wake
  end note
  note right of reconfiguring
    on: ui:saveConfig, ui:cancelConfig, sip:disconnected, sip:unregistered, sip:registrationFailed, sys:sleep, sys:wake
  end note
  note right of saving
    on: task:saveConfig, sys:sleep, sys:wake
  end note
  note right of connecting
    on: sip:connected, sip:invalidProxy, sip:disconnected, sys:sleep, sys:wake
    after 10000 ms
  end note
  note right of registering
    on: sip:registered, sip:registrationFailed, sip:disconnected, sys:sleep, sys:wake
    after 30000 ms
  end note
  note right of ready
    on: ui:call, sip:registered, sip:connected, sip:registrationFailed, sip:disconnected, ui:backToSettings, ui:logout, ui:clearHistory, sys:sleep, sys:wake
  end note
  note right of in_call
    on: child:msg, child:exit, ui:hangup, ui:muteMic, ui:muteCam, ui:toggleSelfView, ui:backToSettings, ui:logout, ui:call, sip:registered, sip:connected, sip:registrationFailed, sip:disconnected, sys:sleep, sys:wake
  end note
  note right of reconnecting
    on: ui:retry, ui:call, ui:clearHistory, ui:backToSettings, ui:logout, sip:disconnected, sip:unregistered, sip:registrationFailed, sip:invalidProxy, sys:sleep, sys:wake
    after 10000 ms
  end note
  note right of sleeping
    on: sys:wake, sys:sleep, ui:call, ui:clearHistory, sip:disconnected, sip:unregistered, sip:registrationFailed, ui:logout, ui:backToSettings
  end note
  note right of reg_failed
    on: ui:retry, ui:clearHistory, ui:backToSettings, ui:logout, sip:disconnected, sip:unregistered, sip:registrationFailed, sip:invalidProxy, sys:sleep, sys:wake
  end note
  note right of unregistering
    on: sip:unregistered, sip:registrationFailed, sip:disconnected, sys:sleep, sys:wake
    after 5000 ms
  end note
```

## CallMachine

```mermaid
stateDiagram-v2
  state initial_state
  state ringing
  state connected
  state hangingup
  [*] --> initial_state
  note right of initial_state
    on: sip:progress, sip:accepted, sip:failed, sip:ended, ui:hangup, parent:msg
  end note
  note right of ringing
    on: sip:progress, sip:accepted, sip:failed, sip:ended, ui:hangup, parent:msg
    after 90000 ms
  end note
  note right of connected
    on: sip:confirmed, sip:accepted, sip:progress, sip:ended, sip:failed, ui:hangup, ui:muteMic, ui:muteCam, ui:toggleSelfView, parent:msg
  end note
  note right of hangingup
    on: sip:ended, sip:failed, sip:progress, sip:accepted, sip:confirmed, parent:msg
    after 2000 ms
  end note
```
