# ADR 0012 — Les pièces jointes, comme Linphone les envoie

**Statut :** accepté — 2026-10-07 · **réception implémentée** — 2026-10-07 (T1) ; téléchargement
intégré, envoi et légende à venir (T2 à T5) ; validation réelle à faire (§4)
**Portée :** `sip/fthttp.ts` (nouveau), `sip/message.ts`, `sip/port.ts`, `storage/store.ts`,
`machines/messaging.ts`, `ui/attachment.ts` (nouveau), `ui/screens/call/thread.ts`,
`ui/messagealerts.ts`, `ui/theme.css`, `i18n/locales/*`
**Hors périmètre :** les vignettes (`file-info type="thumbnail"`, que Linphone ignore) ; le
chiffrement LIME (`file-key`) ; les conversations de groupe ; plusieurs fichiers par message.
**Références normatives :** GSMA RCC.07 §3.5.4.8 (File Transfer via HTTP), RFC 3862 (CPIM)
**Conception côté serveur :** elixip, `docs/design/DESIGN-CHAT-MEDIA.md` et
`docs/design/chat-media-plan.md` (Part T)

## Contexte

Linphone n'envoie pas un fichier dans le MESSAGE. Il le dépose sur un serveur HTTP, puis envoie
un XML RCS qui le nomme, `application/vnd.gsma.rcs-ft-http+xml` : URL, nom, taille, type, date
d'expiration (`until`), et pour un message vocal sa durée. Trix répondait 415 à ce type (ADR 0009) :
la photo d'un correspondant Linphone était refusée, et lui la voyait en échec.

Ce qui fixe la forme du XML et ses pièges a été lu dans le code de Linphone et du serveur de
référence (DESIGN-CHAT-MEDIA §2) : la durée en **millisecondes** et non en secondes ; le message
vocal reconnu à son type exact `audio/wav;voice-recording=yes`, quel que soit son conteneur réel
(Matroska/Opus) ; le nom percent-encodé ; une légende possible dans un `multipart/mixed`, que
Linphone affiche mais n'envoie jamais.

## 1. Décisions

### D1 — L'adresse du serveur de fichiers est un réglage du compte

`AccountConfig` gagnera `fileStore`, l'URL de dépôt (`https://…/files/hft.php`), vide pour
« pièces jointes désactivées » — la valeur de tout compte enregistré avant. Comme le proxy et les
serveurs ICE, c'est un réglage d'opérateur : `config.json` peut l'épingler (clé
`file_transfer_server`, une URL `https://` et rien d'autre), et le champ disparaît alors de
l'écran de réglages ; un lien de partage le transporte, puisqu'il n'est pas un secret — les
empreintes le sont.

Le champ arrive avec l'**envoi** (T3) : la réception n'en a pas besoin, l'URL du fichier est dans
le XML.

### D2 — Un fichier est une entrée de message comme une autre

`MessageEntry` gagne `file?`, ce que le XML décrit (`sip/fthttp.ts`, `FileAttachment`) ; `text`
devient sa légende, vide sans légende. L'entrée garde son identifiant, son `imdn.Message-ID`, sa
place dans la quarantaine (ADR 0008, D5) : le dédoublonnage de l'ADR 0009 et les accusés de
l'ADR 0010 s'y appliquent sans changement. Un fichier envoyé seul en CPIM demande les mêmes
accusés qu'un texte.

### D3 — Ce que montre la conversation

Une carte : une icône (vocal, image, autre), le nom, la taille, la durée d'un message vocal, et
un lien « Télécharger » que le navigateur ouvre (`target="_blank"`, `rel="noopener noreferrer"`,
`download`). Passé `until`, le serveur a effacé le fichier : la carte dit « Expiré » et n'offre
plus de lien. La légende, s'il y en a une, s'affiche sous la carte ; sinon la liste des échanges
et les notifications disent « Fichier : nom » ou « Message vocal, 0:04 » (`entryText`).

Seule une URL `http(s)` devient un lien : un `javascript:` ou un `data:` venu d'un XML ne
produit aucun fichier. La lecture dans la page (image affichée, message vocal joué) est T2 : elle
demande un `fetch` et un choix de décodeur que la mesure tranchera.

### D4 — Un accusé nu est accepté

Un Linphone sans CPIM provisionné envoie quand même un accusé « distribué », nu,
`message/imdn+xml`, qui nomme le Call-ID de sa propre branche — kelixip relaie avec un Call-ID
neuf, donc l'identifiant ne correspond à rien chez nous. Il était refusé 415 ; il est maintenant
répondu **200** et lu comme un accusé en CPIM, puis ignoré faute de message à qui le rattacher.

### D5 — Ce qui est lu, et ce que dit le 415

Après l'ouverture du CPIM, ou sur un corps nu : le XML seul ; un `multipart/mixed` dont une
partie est le XML et une autre un `text/plain` en UTF-8 ou US-ASCII (la légende, gardée telle
quelle, espaces finaux compris) ; l'ancien `message/external-body; access-type=URL`. Tout autre
type reste refusé 415, et un XML qui ne nomme aucun fichier téléchargeable aussi. L'`Accept` du
415 liste désormais ces types et `message/imdn+xml`.

## 2. À retenir pour l'envoi (T3)

Lu dans le code du serveur de référence, et vérifié sur sa répétition en conteneurs
(elixip, `packaging/fhft/rehearsal/`) :

- le `From` HTTP doit être une **URI nue**, `sip:user@domaine` : le serveur en extrait l'usager et
  le realm par découpage, et un nom affiché ou des chevrons cassent le realm ;
- avec le digest, le POST vide **authentifié** reçoit **400**, pas 204 : le POST vide sert à
  apprendre le défi, et la réponse va sur le POST qui porte le fichier ;
- le realm est le domaine SIP, celui avec lequel Trix a calculé ses deux empreintes
  (`storage/ha1.ts`) : le digest se calcule sans le mot de passe ;
- le serveur n'offre que l'algorithme de sa base — MD5 chez kelixip.

## 3. Conséquences

- Une photo ou un message vocal de Linphone arrive comme une carte au lieu d'un échec chez
  l'expéditeur.
- Le coffre garde la description du fichier, jamais le fichier : il est sur le serveur, et
  disparaît à son `until` (7 jours par défaut).
- Le lien de téléchargement emmène l'utilisateur sur le serveur de fichiers ; sans CORS ni
  `fetch`, aucun en-tête n'est requis pour cela.

## 4. Validation

Tests automatiques : le XML du serveur de référence tel qu'il l'a renvoyé, celui que Linphone
reconstruit (CRLF, vignette ignorée, `file-key` ignoré, durée), le nom percent-encodé, les URL
refusées, `until` ; le fichier nu, en CPIM, avec sa légende, `external-body` ; l'accusé nu ; la
carte, son état expiré, le libellé ; le fichier rangé, mis en quarantaine, puis rangé à
l'acceptation.

En réel, avec un Linphone de bureau provisionné (`file_transfer_server_url`) :

1. une photo de Linphone s'affiche en carte, avec le bon nom et la bonne taille ;
2. un message vocal de Linphone s'affiche avec sa durée ;
3. un texte s'affiche toujours en texte ;
4. un Linphone sans CPIM reçoit 200 à ses accusés.

## Références

- GSMA RCC.07 v6.0 §3.5.4.8 — File Transfer via HTTP
- ADR 0008 — La messagerie instantanée ; ADR 0009 — CPIM ; ADR 0010 — Les accusés IMDN
- elixip — `docs/design/DESIGN-CHAT-MEDIA.md`, `docs/design/chat-media-plan.md`
