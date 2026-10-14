# Exemple minimal

Une seconde interface pour Trix, écrite contre la seule façade `trix/core` (ADR 0011, D10). Elle
couvre :

- les comptes ;
- l'appel audio avec texte en temps réel ;
- le fil Échanges et ses messages ;
- le statut de présence.

Elle sert de preuve du contrat. `test/layers.test.ts` vérifie qu'elle n'importe rien d'autre que
`trix/core` : si elle en a un jour besoin, c'est que la façade est incomplète.

```sh
npm run example     # serveur de développement
npm run build       # construit aussi l'exemple, dans examples/minimal/dist/
```

L'exemple a son propre préfixe de stockage (`minimal`) : il ne lit ni n'écrit jamais les
comptes du client Trix. Pour lui imposer une configuration de déploiement, posez un
`config.json` à côté de `index.html`.

Il est volontairement dépouillé : pas de framework, presque pas de style. À chaque vue, l'écran
est entièrement reconstruit, puis le champ qui avait le focus le retrouve, avec son texte et
son curseur. Le son de l'appel passe par un élément `<audio>` placé hors de la zone
reconstruite, pour qu'il ne soit jamais coupé.
