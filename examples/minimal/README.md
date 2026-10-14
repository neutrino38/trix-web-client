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

## Deux instances dans la même page

Avec `?double` dans l'URL (`http://localhost:5173/?double`), deux instances tournent côte à
côte, avec les préfixes `minimal-a` et `minimal-b`. C'est l'essai de la section 4 de l'ADR 0011.
Deux onglets ne suffisent pas : chacun a son propre JsSIP et ses propres modules, alors que
deux instances dans une page partagent les deux. On vérifie :

- les deux comptes enregistrés en même temps ;
- un appel de l'une à l'autre, dans la même page ;
- un statut changé d'un côté, qui ne bouge pas de l'autre ;
- deux bases IndexedDB distinctes, `minimal-a` et `minimal-b`, dans l'onglet Application.

Il est volontairement dépouillé : pas de framework, presque pas de style. À chaque vue, l'écran
est entièrement reconstruit, puis le champ qui avait le focus le retrouve, avec son texte et
son curseur. Le son de l'appel passe par un élément `<audio>` placé hors de la zone
reconstruite, pour qu'il ne soit jamais coupé.
