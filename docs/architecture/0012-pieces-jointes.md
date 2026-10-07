# ADR 0012 — Les pièces jointes, comme Linphone les envoie

**Statut :** accepté — 2026-10-07 · **implémenté** — 2026-10-07 : réception (T1), affichage et
lecture dans la page (T2), envoi d'une photo et légende (T3, T5), message vocal et indicateur de
saisie (T4) ; validation réelle à faire (§4)
**Portée :** `sip/fthttp.ts` (nouveau), `sip/message.ts`, `sip/port.ts`, `storage/store.ts`,
`machines/messaging.ts`, `ui/attachment.ts` (nouveau), `ui/filefetch.ts` (nouveau), `ui/screens/call/thread.ts`,
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

Le champ « Serveur de fichiers » est dans la section du compte, sous le serveur SIP, et disparaît
quand `config.json` l'impose ou que la messagerie est éteinte. Une saisie qui n'est pas une adresse
`https://` est refusée à l'enregistrement, champ désigné — `http://` n'est admis que vers la machine
elle-même, pour le développement. La réception n'en a pas besoin : l'URL du fichier est dans le
XML ; sans serveur, Trix reçoit et affiche, mais n'offre pas d'envoyer.

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

Seule une URL `http(s)` est jamais demandée : un `javascript:` ou un `data:` venu d'un XML ne
produit aucun fichier.

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

### D6 — Le fichier est récupéré, puis montré dans la page

`ui/filefetch.ts` récupère le fichier par `fetch`, `credentials: "omit"` : le serveur le sert en
statique, l'URL est la capacité, et nos cookies n'ont rien à y faire (le serveur répond avec
l'en-tête CORS de l'origine de Trix). Une image s'affiche dans la carte, un message vocal s'y joue
(`<audio>`), tout autre fichier s'offre à l'enregistrement ; dans les trois cas un lien
« Enregistrer » le donne au navigateur avec son nom d'origine.

- **Images et messages vocaux de 10 Mo au plus se récupèrent seuls**, à l'affichage de leur carte,
  comme Linphone le fait (`auto_download_incoming_files_max_size`) ; le reste attend le bouton.
  Un SVG ne s'affiche jamais : il porterait du script dans la page.
- **Le conteneur audio est lu sur ses quatre premiers octets**, jamais sur le type du XML :
  Linphone étiquette `audio/wav` un fichier Matroska/Opus. `RIFF` donne `audio/wav`, l'en-tête EBML
  `audio/webm`, `OggS` `audio/ogg`. La durée affichée est celle du XML.
- **Ce que le navigateur ne sait pas lire, il le dit** : l'`error` de l'élément `<audio>` fait
  passer la carte à « Ce navigateur ne lit pas ce format » et au seul lien d'enregistrement. Quels
  navigateurs lisent le `.mka` de Linphone est une **mesure** (§4) ; un démultiplexeur en WASM ou
  WebCodecs ne se construit que si elle échoue là où il le faut.
- **Une carte se redessine seule.** L'état d'un fichier vit hors des redessins du fil, par URL ;
  quand il change, seule sa carte est remplacée, pour qu'un message vocal en lecture ne soit pas
  coupé par l'arrivée d'un autre fichier. Les URL d'objet sont gardées pour la session, les plus
  anciennes libérées au-delà de quarante.
- Un 404 dit « Le fichier n'est plus sur le serveur », sans nouvel essai ; un autre échec,
  « Échec du téléchargement », avec « Réessayer ».

### D7 — Envoyer un fichier : déposer, puis envoyer le XML

Le bouton « Joindre » de la zone de saisie ouvre le sélecteur de photos ; le fichier choisi part
aussitôt. `machines/messaging.ts` crée l'entrée tout de suite, en attente, avec la description du
fichier et une URL vide (« Envoi du fichier… »), et lance le dépôt (`sip/ftupload.ts`) ; quand le
serveur a répondu, l'entrée apprend son URL et le XML part par le lien, en CPIM comme un texte,
avec le même `imdn.Message-ID` et les mêmes demandes d'accusés, en XML nu après un 415. Déposé
hors ligne, il attend l'enregistrement comme un texte (ADR 0008, D3).

- Le XML est celui que Linphone reconstruit (CRLF, espace de noms `am`, nom percent-encodé, type
  local) : l'URL, `until` et la taille du serveur, le nom et le type du fichier choisi.
- Le fichier lui-même n'est gardé qu'en mémoire, jamais dans le coffre : un fichier non déposé quand
  la page se recharge échoue, « Fichier perdu au rechargement de la page ». « Réessayer » redépose
  un fichier que la page a encore.
- Les échecs du dépôt se disent : 400 « Fichier trop volumineux pour le serveur », 401
  « Le serveur de fichiers refuse vos identifiants », le reste « Le serveur de fichiers ne l'a pas
  pris ». Un dépôt est abandonné après cinq minutes.
- Pas de limite de taille côté client, pas de barre de progression : la limite est celle du
  serveur, qui la dit par son 400, et `fetch` ne rapporte pas la progression d'un envoi.

### D8 — La légende

Ce qui est en cours de saisie quand la photo est choisie part avec elle, en légende : un
`multipart/mixed`, le XML d'abord puis le `text/plain`, **à l'intérieur** de l'enveloppe CPIM — le
corps SIP reste en une seule partie. Une légende au-delà de 1 000 octets (ADR 0008, D2) ne part pas :
la photo part seule, et le texte reste dans la zone de saisie. Linphone affiche une légende reçue,
mais n'en envoie jamais : c'est une limite de Linphone, que Trix ne compense pas.

### D9 — L'indicateur de saisie

Trix n'en avait aucun. Il lit maintenant l'isComposing (RFC 3994, `sip/iscomposing.ts`), nu ou en
CPIM, répondu 200, et l'envoie **nu**, `Priority: non-urgent`, `Expires: 0` — comme Linphone, et
pour que kelixip ne le garde jamais.

- **Reçu** : « Bob écrit… » ou « Bob enregistre un message vocal… » sous la zone de saisie de la
  ligne ouverte, jusqu'au `refresh` annoncé (120 s sans) ou jusqu'à son message. Seulement pour une
  ligne à nous — contact, ou quelqu'un à qui l'on a écrit — et jamais pour un bloqué ; d'un
  inconnu, il ne dit rien à montrer. L'indicateur se met à jour **sans redessiner le fil**, pour
  ne pas couper un message vocal en lecture.
- **Envoyé** : `active` à la frappe, au plus une fois par 60 s ; `idle` après 15 s sans touche ;
  rien quand le message part, que le destinataire sait déjà lire. Pendant un enregistrement,
  `active` avec le type du message vocal, renouvelé chaque minute, et `idle` s'il est abandonné.

### D10 — Le message vocal

Le bouton « Vocal » enregistre au micro (`ui/voicerecorder.ts`), avec `MediaRecorder` en
`audio/webm; codecs=opus` si le navigateur l'a, sinon Ogg/Opus ; « Envoyer le vocal » l'envoie,
« Annuler » le jette. Le fichier s'appelle `vocal_<date>.mka` et part avec le type de Linphone,
`audio/wav;voice-recording=yes`, quel que soit son conteneur — c'est à ce type seul que Linphone
reconnaît un message vocal — et sa durée mesurée en millisecondes dans le XML. Un enregistrement
s'arrête et part de lui-même au bout de cinq minutes. Un micro refusé se dit.

Que le lecteur de Linphone lise le WebM d'un navigateur est une **mesure** (§4) ; à défaut, un
encodeur WAV PCM 16 kHz mono dans le client, construit sur cette mesure.

## 2. Ce que le serveur de référence demande à l'envoi

Lu dans le code du serveur de référence, et vérifié sur sa répétition en conteneurs
(elixip, `packaging/fhft/rehearsal/`), par le code de Trix lui-même :

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

Contre la répétition du serveur en conteneurs, le 2026-10-07 : le dépôt de Trix authentifié par
son HA1, le fichier relu à l'identique, un mauvais mot de passe lu « identifiants refusés ».

Tests automatiques : le XML du serveur de référence tel qu'il l'a renvoyé, celui que Linphone
reconstruit (CRLF, vignette ignorée, `file-key` ignoré, durée), le nom percent-encodé, les URL
refusées, `until` ; le fichier nu, en CPIM, avec sa légende, `external-body` ; l'accusé nu ; la
carte, son état expiré, le libellé ; le fichier rangé, mis en quarantaine, puis rangé à
l'acceptation.

En réel, avec un Linphone de bureau provisionné (`file_transfer_server_url`) :

1. une photo de Linphone s'affiche en carte, avec le bon nom et la bonne taille ;
2. un message vocal de Linphone s'affiche avec sa durée ;
3. un texte s'affiche toujours en texte ;
4. un Linphone sans CPIM reçoit 200 à ses accusés ;
5. la photo s'affiche dans la carte sans clic, et un fichier de plus de 10 Mo attend le bouton ;
6. une photo envoyée de Trix s'affiche chez Linphone et dans un second Trix, et revient
   « Distribué » des deux ; avec une légende, Linphone l'affiche sous la photo ;
7. **la mesure** : le message vocal de Linphone se joue — ou dit qu'il ne se joue pas — dans
   Chromium, Firefox et Safari, et le résultat est écrit ici ;
8. **la mesure** : un message vocal de Trix se joue chez Linphone avec la bonne durée ;
9. « Bob écrit… » apparaît dans Trix quand Linphone écrit, et l'inverse ; « enregistre un message
   vocal » pendant un enregistrement, des deux côtés.

## Références

- GSMA RCC.07 v6.0 §3.5.4.8 — File Transfer via HTTP
- ADR 0008 — La messagerie instantanée ; ADR 0009 — CPIM ; ADR 0010 — Les accusés IMDN
- elixip — `docs/design/DESIGN-CHAT-MEDIA.md`, `docs/design/chat-media-plan.md`
