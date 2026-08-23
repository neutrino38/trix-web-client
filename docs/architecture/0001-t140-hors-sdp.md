# ADR 0001 — Le texte temps réel n'est pas négocié en SDP

**Statut :** accepté — 2026-08-23
**Portée :** `sip/rttdc.ts`, `sip/rttsip.ts` (transport `datachannel`)

## Contexte

RFC 8865 transporte T.140 sur un canal de données WebRTC. La négociation prévue par la
norme passe par RFC 8864 : une ligne `a=dcmap` décrit le canal (label, sous-protocole,
fiabilité, ordre), des lignes `a=dcsa` portent les paramètres de la session texte
(direction, langue, `cps`). Tout cela s'écrit dans le SDP, sur la section
`m=application`.

Trix n'écrit pas ce SDP : c'est Chrome qui le rédige, à partir de la
`RTCPeerConnection`. Or **aucun navigateur n'implémente RFC 8864.** Chrome n'émet ni
`a=dcmap` ni `a=dcsa` et n'en lit aucune ; les canaux de données y sont négociés
in-band, par DCEP, dans le média. Obtenir ces lignes supposerait donc de retoucher le
SDP après `createOffer` et avant `setLocalDescription`, et de filtrer celles du distant
avant `setRemoteDescription`.

Le dépôt sait ce que cela coûte : c'est exactement ce que fait `sip/rttws.ts` pour le
transport WebSocket des passerelles déjà déployées, et il ne le fait que parce que
Chrome refuse purement et simplement une description qui porte un `m=text TCP/WSS`.

## Décision

**Le transport `datachannel` ne lit ni n'écrit une seule ligne de SDP.** Le canal est
créé sur la connexion pair-à-pair avant que la première offre ne soit rédigée ; DCEP
porte le sous-protocole `t140` ; l'offrant crée, le répondant écoute `ondatachannel`.
La collision se règle sur l'identifiant du canal, que les deux extrémités voient.

Les paramètres de session T.140 prennent les valeurs par défaut de la norme :
`sendrecv`, aucune préférence de langue, et — c'est un écart, documenté en §4.9 — aucun
plafond de débit.

## Conséquences

- **Compatibilité durable.** Rien à réécrire quand Chrome change la façon dont il
  rédige une section `m=application`. Un post-traitement du SDP est un pari sur la
  stabilité d'un format que personne ne nous garantit.
- **La direction ne se négocie pas.** `recvonly` et `inactive` ne sont pas gérés. En
  pair à pair, le besoin n'existe pas : les deux extrémités sont le même logiciel. En
  mode passerelle, il faudrait une signalisation applicative que Trix n'a pas — et
  inventer un canal de contrôle applicatif pour la porter serait pire que le mal.
- **La langue de la session n'est pas annoncée.** Elle sert à l'affichage, pas au
  filtrage : son absence ne casse rien.
- **L'interopérabilité repose sur le sous-protocole.** Un pair qui laisse `protocol`
  vide n'est reconnu que par le label `t140` — repli conservé pour cette raison.
- **Le jour où un navigateur implémentera RFC 8864**, cette décision se rouvre : les
  paramètres arriveraient alors sans que rien n'ait à être inventé.
