import { defineConfig } from "vite";
import { resolve } from "node:path";

/**
 * Deux pages, et non une application à routes : `index.html` porte le
 * client, `share_account.html` reçoit un compte partagé par lien
 * (src/share/page.ts).
 *
 * Deux entrées séparées plutôt qu'un aiguillage dans `main.ts` : la page de
 * partage n'a besoin ni de l'automate, ni de la pile SIP, ni de JsSIP, et
 * ce découpage est ce qui le garantit — Rollup ne met dans son bundle que
 * ce qu'elle importe vraiment. Elle reste servie par un fichier statique,
 * sans réécriture d'URL côté serveur.
 */
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        share: resolve(__dirname, "share_account.html"),
      },
    },
  },
});
