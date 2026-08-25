/**
 * La politique des comptes : combien on en garde, et ce qui fait que deux
 * comptes sont « le même ».
 *
 * Elle vit ici plutôt que dans le coffre parce que le coffre n'a pas à la
 * connaître — il manipule une liste (`storage/store.ts`) —, et plutôt que
 * dans l'écran d'accueil parce que trois endroits l'appliquent : l'accueil,
 * qui cesse de proposer « Ajouter un compte » ; la machine, qui refuse
 * d'enregistrer deux fois la même adresse ; et la page de partage, qui
 * refuse le lien d'un compte déjà là. Le jour où la limite bouge, elle
 * bouge à un endroit (ADR 0002, décision 3).
 */

import type { AccountConfig, StoredAccount } from "./storage/store.js";

/**
 * Deux comptes au plus. La limite n'est pas technique — le coffre en
 * porterait dix — mais d'interface : au-delà, l'accueil et la bascule de
 * l'en-tête ne sont plus la bonne forme, et il faudrait un vrai
 * gestionnaire de comptes.
 */
export const MAX_ACCOUNTS = 2;

/**
 * L'adresse SIP d'un compte, sous la forme qui l'identifie : `user@domaine`.
 * Le nom affiché et le proxy n'en font pas partie — deux comptes de même
 * adresse sur deux proxys différents resteraient le même compte pour le
 * registrar, et l'un des deux ne s'enregistrerait pas.
 */
export function addressOf(cfg: AccountConfig): string {
  return `${cfg.username}@${cfg.domain}`;
}

/** Comparaison insensible à la casse : les domaines SIP le sont (RFC 3261 §19.1.4). */
export function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Le compte du coffre qui porte déjà cette adresse, s'il y en a un.
 * `exceptId` écarte le compte en cours de modification : renommer un compte
 * sans changer son adresse ne doit pas se heurter à lui-même.
 *
 * L'adresse est passée telle quelle plutôt qu'un compte entier : le
 * formulaire la connaît avant d'avoir un compte à comparer — il n'a pas
 * encore de HA1, et n'en aura peut-être jamais si c'est ici qu'on l'arrête.
 */
export function findByAddress(
  accounts: readonly StoredAccount[],
  address: string,
  exceptId: string | null = null,
): StoredAccount | null {
  return accounts.find((a) => a.id !== exceptId && sameAddress(addressOf(a), address)) ?? null;
}
