/**
 * Version du logiciel — **lue dans `package.json`**, jamais recopiée.
 *
 * Un numéro écrit en dur ici serait une seconde vérité à tenir à jour :
 * `npm version` ferait bouger le manifeste, l'écran d'accueil continuerait
 * d'annoncer l'ancien numéro, et rien ne le signalerait. Le manifeste reste
 * donc la seule source, et l'import nommé n'emporte dans le bundle que la
 * chaîne de version — le reste du fichier est éliminé à la construction.
 */

import { version } from "../package.json";

export const APP_VERSION: string = version;
