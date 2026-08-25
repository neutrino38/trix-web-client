# ADR 0004 — Partager un compte SIP par une URL

**Statut :** accepté — 2026-08-25
**Portée :** `src/share/`, `share_account.html`, `vite.config.ts`, `src/accounts.ts`,
`ui/screens/config.ts`, `docs/CONCEPTION.md` §6.1

## Contexte

Configurer un compte SIP dans Trix demande sept champs, dont une URL de proxy WebSocket
et un mot de passe. C'est le moment où l'on perd les gens — et c'est justement celui où
ils ont le plus besoin d'aide, puisque Trix s'adresse d'abord à un public sourd que
l'assistance téléphonique n'atteint pas.

Qui installe Trix pour quelqu'un d'autre — un opérateur, un centre relais, un proche —
sait déjà tous ces champs. Il lui manque un moyen de les transmettre autrement qu'en
les dictant.

Le besoin est donc : **un compte entier dans un lien**, envoyé par n'importe quel
canal, qui crée le compte à l'ouverture. L'historique d'appels n'en fait pas partie : il
appartient à la personne, pas au compte.

## Décision

**1. Le lien est le compte.** Rien n'est déposé sur un serveur, aucun identifiant n'est
réservé, aucun état n'est tenu quelque part : la configuration est encodée en JSON puis
en base64url dans l'URL elle-même. Un lien de partage fonctionne hors ligne côté
émetteur, ne périme pas, et n'ajoute aucune surface à exploiter côté exploitant.

**2. La charge voyage dans le fragment**, `share_account.html#data=…`, et non dans la
requête. Un fragment ne quitte jamais le navigateur : il n'entre ni dans la requête
HTTP, ni dans les journaux d'accès, ni dans un `Referer`. La lecture accepte malgré tout
`?data=`, pour un lien qu'un outil de messagerie aurait réécrit ; Trix n'en fabrique
jamais de cette forme.

**3. Une page à part, et une entrée de construction à part.** `share_account.html` est
une seconde entrée Vite, servie en fichier statique. Elle n'embarque ni automate, ni
pile SIP, ni JsSIP — et c'est le découpage qui le garantit, non une discipline.

**4. Rien n'est créé sans un clic.** La page montre ce qu'elle a compris, puis attend.
Ce qui est affiché est ce qui sera créé : le récapitulatif est construit à partir du
compte décodé **et validé**, jamais de la charge brute.

**5. Ce qui vient d'une URL n'est jamais cru.** Chaque champ est vérifié au décodage —
proxy `ws(s)://`, HA1 sur 32 chiffres hexadécimaux, adresse SIP sans espace ni second
`@`, serveur TURN écarté s'il lui manque ses identifiants, transport inconnu ramené à
`none`. Les champs facultatifs absents prennent les mêmes défauts qu'un compte relu d'un
coffre ancien. Un champ étranger à `AccountConfig` ne franchit pas le décodeur.

**6. Un numéro de version accompagne la charge.** Un lien d'une version future est
**reconnu comme tel**, et la page invite à mettre l'application à jour au lieu
d'annoncer un lien illisible.

**7. Trois refus, dits et non silencieux** : le compte est déjà enregistré sur
l'appareil (même `user@domaine`), l'appareil en garde déjà autant qu'il en tient
(ADR 0002), ou le déploiement impose un autre domaine SIP.

**8. Le compte reçu passe par le déploiement**, comme un compte relu du coffre
(`pinAccount`) : proxy, serveurs ICE et transport texte imposés l'emportent sur ce que
le lien transportait.

**9. Le bouton « Partager » vit dans le formulaire du compte**, et seulement pour un
compte déjà enregistré : un formulaire de création n'a pas de HA1 à transporter. Il
copie le lien dans le presse-papier ; si le navigateur refuse, le lien s'affiche
sélectionné, à copier à la main.

## Conséquences

- **Un lien de partage vaut le mot de passe du compte.** Il porte le HA1 — ce qu'un
  client SIP présente au registrar — et le mot de passe TURN s'il y en a un. C'est
  inhérent : un lien qui ne porterait pas de quoi s'authentifier ne transporterait pas
  un compte utilisable. Il n'y a donc rien à corriger, seulement à **dire** — sous le
  bouton qui fabrique le lien, et sur la page qui le reçoit. C'est aussi ce qui a
  décidé du fragment (décision 2) : le seul endroit d'une URL qui ne se journalise
  nulle part.

- **Le lien ne se révoque pas.** Qui le possède peut créer le compte, indéfiniment. Le
  seul recours est de changer le mot de passe du compte SIP, ce qui invalide le HA1 —
  c'est exactement le recours qu'on a contre un mot de passe qui a fuité, et il faut
  le savoir avant d'envoyer le lien, pas après.

- **La longueur reste raisonnable** : environ 370 caractères pour un compte simple,
  510 avec STUN et TURN. Aucun encodage plus compact n'a été retenu — la compression
  aurait rendu la charge illisible à l'œil sans changer d'ordre de grandeur, et
  `CompressionStream` aurait ajouté une asynchronie et une compatibilité à surveiller
  pour gagner cent caractères.

- **L'identifiant interne du compte ne voyage pas.** Il désigne un compte dans *un*
  coffre et nomme son historique (ADR 0002) ; celui qui reçoit le lien tire le sien.
  Deux appareils partageant un compte n'ont donc rien en commun que la configuration —
  et surtout pas leurs journaux d'appels.

- **`AccountConfig` et `StoredAccount` se séparent.** Le premier est le compte
  transportable, le second est le compte dans le coffre. C'est le partage qui a rendu
  la distinction nécessaire, et elle documente d'elle-même ce qui n'a de sens que
  localement.

- **La page de partage ouvre le coffre.** C'est le seul endroit hors de l'application
  qui le fasse. Elle le relit une seconde fois au moment d'écrire, plutôt que de
  réutiliser la copie affichée : entre l'affichage et le clic, un autre onglet a pu
  ajouter un compte, et écraser sa liste avec une copie plus ancienne le ferait
  disparaître.

- **Rien à changer côté serveur.** La CSP `default-src 'self'` couvre la seconde page
  telle quelle, et `Referrer-Policy: no-referrer` était déjà posé. Aucune réécriture
  d'URL n'est nécessaire : les deux pages sont des fichiers.
