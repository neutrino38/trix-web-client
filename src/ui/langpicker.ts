/**
 * Sélecteur de langue de l'interface.
 *
 * Trois raisons d'en faire un composant à part plutôt qu'un bloc dans
 * l'accueil : il apparaît à deux endroits (l'accueil, d'où l'on part, et
 * les paramètres, où l'on revient sans repasser par l'accueil), il se
 * peuple tout seul de ce que `i18n` a trouvé, et il n'a aucun re-rendu à
 * commander — `setLocaleChoice` prévient ses abonnés, et c'est `main.ts`
 * qui redessine. Le composant ne connaît donc ni l'écran ni la machine.
 *
 * « Automatique » est le premier choix, et il nomme la langue qu'il
 * détecte (« Automatique — Français ») : sans cela, l'utilisateur ne
 * saurait pas ce qu'il obtient avant de l'avoir choisi.
 *
 * **Ce n'est pas un `<select>` natif, et c'est un renoncement.** Le
 * contrôle du navigateur ouvre la roue du système sur iOS, se pilote au
 * clavier sans qu'on écrive une ligne, et se cherche à la lettre. Rien de
 * tout cela ne se remplace à bon compte. Mais un `<option>` ne rend que du
 * texte — aucun navigateur n'y affiche d'image —, et le drapeau du Québec
 * n'existe pas en emoji : Unicode ne code que trois drapeaux de
 * subdivision, et le fleurdelisé n'en est pas. Pour le montrer, il faut
 * des boutons, donc ce menu, donc le clavier à réécrire (flèches, Origine,
 * Fin, Échap, focus rendu au bouton). Le motif suit celui du menu de mode
 * d'appel (`ui/screens/call/parts.ts`), pour n'en avoir qu'un dans le
 * dépôt.
 *
 * Chaque entrée porte son drapeau, qui se repère avant d'être lu — c'est
 * tout l'intérêt dans un menu où l'entrée qu'on cherche est celle qu'on ne
 * sait pas lire. Dessiné quand `ui/flags.ts` en a un, sinon l'emoji déduit
 * de la balise (`localeFlag`), sinon rien : une langue déposée demain
 * s'affiche sans qu'on dessine quoi que ce soit. « Automatique » prend le
 * globe 🌐, n'étant d'aucun pays — le drapeau de l'espéranto aurait dit
 * « la langue de personne », mais il n'a pas de caractère non plus.
 */

import {
  LOCALES,
  detectLocale,
  localeChoice,
  localeFlag,
  localeName,
  setLocaleChoice,
  t,
} from "../i18n/index.js";
import { esc } from "./el.js";
import { flagImage } from "./flags.js";

/** Le drapeau d'« Automatique », qui n'a pas de langue à lui. */
const AUTO_FLAG = "\u{1F310}";

/**
 * Après un changement de langue, l'application entière se redessine et le
 * bouton qu'on venait d'actionner disparaît avec elle. Sans ce drapeau, le
 * focus retomberait sur `<body>` et la navigation au clavier serait à
 * reprendre du début — le `<select>` natif avait le même défaut, mais
 * puisqu'on écrit le menu, autant le corriger.
 */
let refocus = false;

/** Ce qu'une entrée du menu a besoin de savoir d'elle-même. */
interface Entry {
  value: string;
  /** Nom affiché, dans sa propre langue. */
  name: string;
  /** Balise à poser sur le texte : un lecteur d'écran doit prononcer
   *  « English » à l'anglaise au milieu d'une interface française
   *  (RGAA 8.7). Vide pour « Automatique », qui parle la langue en cours. */
  lang: string;
  /** Vignette prête à insérer — image, emoji, ou rien. */
  flag: string;
}

/**
 * Image si on l'a dessinée, emoji sinon, **case vide** en dernier recours.
 * Vide et non rien : l'arabe n'a pas de drapeau, et sans cette case son nom
 * viendrait buter contre le bord quand les autres commencent après leur
 * vignette. Une colonne qui se décale d'une ligne se lit moins vite qu'une
 * colonne droite, et la ligne sans drapeau paraîtrait fautive plutôt que
 * délibérée.
 */
function flagHtml(code: string, fallback: string): string {
  const src = flagImage(code);
  if (src) return `<img class="flag" src="${esc(src)}" alt="" width="24" height="16">`;
  if (fallback) return `<span class="flag emoji" aria-hidden="true">${fallback}</span>`;
  return `<span class="flag blank" aria-hidden="true"></span>`;
}

function entries(): Entry[] {
  return [
    {
      value: "auto",
      name: t("lang.autoDetected", { name: localeName(detectLocale()) }),
      lang: "",
      flag: `<span class="flag emoji" aria-hidden="true">${AUTO_FLAG}</span>`,
    },
    ...LOCALES.map((code) => ({
      value: code,
      name: localeName(code),
      lang: code,
      flag: flagHtml(code, localeFlag(code)),
    })),
  ];
}

/** `<span lang="ja">日本語</span>` — la balise seulement quand elle sert. */
function named(e: Entry): string {
  const attr = e.lang ? ` lang="${esc(e.lang)}"` : "";
  return `<span class="lang-name"${attr}>${esc(e.name)}</span>`;
}

/**
 * Gabarit. `withLabel` : un intitulé au-dessus (accueil, paramètres) ;
 * sans lui, seul le menu est rendu — le libellé viendrait alors du
 * contexte.
 */
export function langPicker(withLabel = true): string {
  const choice = localeChoice();
  const list = entries();
  const current = list.find((e) => e.value === choice) ?? list[0]!;
  const items = list
    .map((e) => {
      const on = e.value === choice;
      return `<button type="button" role="menuitemradio" aria-checked="${on}" tabindex="-1"
                      class="${on ? "selected" : ""}" data-value="${esc(e.value)}">
                ${e.flag}${named(e)}${on ? `<span class="check" aria-hidden="true">✓</span>` : ""}
              </button>`;
    })
    .join("");
  return `<div class="field lang-picker">
    ${withLabel ? `<label for="f-lang">${esc(t("lang.label"))}</label>` : ""}
    <button type="button" id="f-lang" class="lang-trigger" data-ref="lang"
            aria-haspopup="true" aria-expanded="false">
      ${current.flag}${named(current)}<span class="caret" aria-hidden="true">▾</span>
    </button>
    <div class="dropdown lang-menu" role="menu" data-ref="langmenu" hidden>${items}</div>
  </div>`;
}

/**
 * Câblage : ouverture, navigation au clavier, enregistrement du choix. Le
 * rendu qui suit n'est pas notre affaire — les abonnés de `onLocaleChange`
 * s'en chargent, une fois le dictionnaire réellement en place.
 */
export function wireLangPicker(node: HTMLElement): void {
  const trigger = node.querySelector<HTMLButtonElement>('[data-ref="lang"]');
  const menu = node.querySelector<HTMLElement>('[data-ref="langmenu"]');
  if (!trigger || !menu) return;
  const items = (): HTMLButtonElement[] => [...menu.querySelectorAll("button")];

  const close = (focus = false): void => {
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (focus) trigger.focus();
  };
  const open = (which: "first" | "last" | "selected" = "selected"): void => {
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    const all = items();
    const target =
      which === "last"
        ? all[all.length - 1]
        : which === "first"
          ? all[0]
          : (all.find((b) => b.classList.contains("selected")) ?? all[0]);
    target?.focus();
  };

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu.hidden) open();
    else close();
  });
  trigger.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      open("first");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      open("last");
    }
  });

  // Déplacement au clavier : le focus circule d'un bouton à l'autre, seul
  // le menu étant dans l'ordre de tabulation (`tabindex="-1"` partout).
  menu.addEventListener("keydown", (e) => {
    const all = items();
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown" ? i + 1 : i - 1;
      all[(next + all.length) % all.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      all[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      all[all.length - 1]?.focus();
    } else if (e.key === "Escape" || e.key === "Tab") {
      close(e.key === "Escape");
    }
  });

  for (const item of items()) {
    item.addEventListener("click", () => {
      close();
      refocus = true;
      void setLocaleChoice(item.dataset["value"] ?? "auto");
    });
  }

  // Un clic ailleurs referme, comme tout menu.
  node.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest(".lang-picker")) close();
  });

  if (refocus) {
    refocus = false;
    // En micro-tâche : `renderApp` construit et câble l'écran *avant* de le
    // poser dans le document (`root.replaceChildren`), et donner le focus à
    // un élément détaché ne fait rien du tout. La micro-tâche s'exécute au
    // bout du bloc synchrone, donc une fois le bouton en place.
    queueMicrotask(() => trigger.focus());
  }
}
