/**
 * A second UI for Trix, written against the facade alone (ADR 0011, D10):
 * accounts, an audio call with real-time text, the Exchanges thread with
 * its messages, and the status. It is the contract's proof — if it ever
 * needs to import anything but `trix/core`, the facade is incomplete — and
 * the starting point the affiliation guide points to.
 *
 * Deliberately plain: no framework, no styling to speak of. The whole
 * screen is rebuilt from each view; what the person is typing survives
 * because the focused field is put back after the rebuild.
 */
import {
  bubbleText,
  createTrix,
  formatMsg,
  type AccountView,
  type ChosenStatus,
  type ConfigForm,
  type Msg,
  type RttTransport,
  type Thread,
  type TrixView,
} from "trix/core";

const LOCALE = "fr";

// its own prefix: this example never reads nor writes Trix's own vault (D8)
const trix = createTrix({ storagePrefix: "minimal", locale: LOCALE });

const app = document.getElementById("app")!;
const remote = document.getElementById("remote") as HTMLAudioElement;

/** The thread unfolded, by address key. */
let openKey: string | null = null;

// ---- a few DOM helpers --------------------------------------------------

type Child = Node | string | null | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { dataset?: Record<string, string> } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { dataset, ...rest } = props;
  Object.assign(el, rest);
  if (dataset) Object.assign(el.dataset, dataset);
  add(el, ...children);
  return el;
}

/** Appends the children that are there: `false` and `null` stand for a part not shown. */
function add(el: HTMLElement, ...children: Child[]): void {
  for (const c of children) if (c !== null && c !== false) el.append(c);
}

function button(label: string, onclick: () => void, disabled = false): HTMLButtonElement {
  return h("button", { type: "button", textContent: label, onclick, disabled });
}

function say(m: Msg | null): string {
  return m ? formatMsg(m, LOCALE) : "";
}

// ---- screens -------------------------------------------------------------

function vaultError(): Node {
  return h(
    "section",
    {},
    h("p", { className: "error", textContent: "Le coffre de ce navigateur est illisible." }),
    button("Réessayer", () => trix.accounts.retryVault()),
    button("Tout effacer", () => {
      if (confirm("Effacer les comptes et l'historique de ce navigateur ?")) trix.accounts.resetVault();
    }),
  );
}

function accounts(view: TrixView): Node {
  return h(
    "section",
    {},
    h("h1", { textContent: "Comptes" }),
    h(
      "ul",
      {},
      ...view.accounts.map((a) =>
        h(
          "li",
          {},
          `${a.displayName || a.address} `,
          button("Utiliser", () => trix.accounts.use(a.id)),
          button("Modifier", () => trix.accounts.configure(a.id)),
        ),
      ),
    ),
    button("Ajouter un compte", () => trix.accounts.configure(null)),
  );
}

function field(name: string, label: string, value: string, suspect: boolean, type = "text"): HTMLLabelElement {
  return h("label", {}, `${label} `, h("input", { name, value, type, className: suspect ? "suspect" : "" }));
}

function settings(view: TrixView): Node {
  const s = view.settings!;
  const a: AccountView | null = s.editing;
  const dep = view.deployment;
  const form = h("form", {});
  const rtt = h(
    "select",
    { name: "rtt" },
    ...(["websocket", "datachannel", "none"] as const).map((t) =>
      h("option", { value: t, textContent: t, selected: (a?.rtt ?? "websocket") === t }),
    ),
  );
  add(
    form,
    h("h1", { textContent: a ? "Modifier le compte" : "Nouveau compte" }),
    dep.proxy === null && field("proxy", "Proxy (wss://…)", a?.proxy ?? "", s.suspect === "proxy"),
    field("uri", "Adresse SIP", a?.address ?? (dep.domain ? `@${dep.domain}` : ""), s.suspect === "credentials"),
    field("displayName", "Nom affiché", a?.displayName ?? "", false),
    field("password", a ? "Mot de passe (vide : inchangé)" : "Mot de passe", "", s.suspect === "credentials", "password"),
    dep.fileStore === null && field("fileStore", "Serveur de fichiers", a?.fileStore ?? "", s.suspect === "fileStore"),
    dep.rtt === null && h("label", {}, "Texte en temps réel ", rtt),
    h("p", { className: "error", textContent: say(view.errors.last) }),
    h("button", { type: "submit", textContent: "Enregistrer", disabled: s.busy !== null }),
    button("Annuler", () => trix.accounts.cancel()),
    a !== null && button("Supprimer", () => confirm("Supprimer ce compte et son historique ?") && trix.accounts.remove()),
  );
  form.onsubmit = (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const text = (k: string) => String(data.get(k) ?? "").trim();
    const config: ConfigForm = {
      proxy: dep.proxy ?? text("proxy"),
      uri: text("uri"),
      displayName: text("displayName"),
      authUsername: a?.authUsername ?? null,
      password: text("password") || null,
      // STUN and TURN are left as they are: this example has no field for them
      stun: a?.stun ?? "",
      turn: a?.turn?.host ?? "",
      turnUsername: a?.turn?.username ?? "",
      turnPassword: null,
      turnTls: a?.turn?.tls ?? false,
      rtt: dep.rtt ?? (text("rtt") as RttTransport),
      ...(dep.fileStore === null ? { fileStore: text("fileStore") } : {}),
    };
    trix.accounts.save(config);
  };
  return form;
}

const STATUSES: ChosenStatus[] = ["available", "busy", "away", "dnd", "invisible"];

function ready(view: TrixView): Node {
  const account = view.account!;
  const target = h("input", { name: "target", placeholder: "bob@example.fr" });
  return h(
    "section",
    {},
    h("h1", { textContent: account.displayName || account.address }),
    h("p", {}, `Enregistrement : ${view.registration} `, button("Changer de compte", () => trix.accounts.logout())),
    view.errors.last && h("p", { className: "error" }, `${say(view.errors.last)} ${view.errors.code ?? ""}`),
    view.presence.state !== "disabled" &&
      h(
        "label",
        {},
        "Statut ",
        h(
          "select",
          { onchange: (e: Event) => trix.presence.setStatus((e.target as HTMLSelectElement).value as ChosenStatus) },
          ...STATUSES.map((s) => h("option", { value: s, textContent: s, selected: view.presence.prefs.chosen === s })),
        ),
      ),
    h(
      "form",
      {
        onsubmit: (e: Event) => {
          e.preventDefault();
          if (target.value.trim()) trix.call.dial(target.value.trim(), { audio: true, video: false, text: true });
        },
      },
      target,
      h("button", { type: "submit", textContent: "Appeler" }),
    ),
    view.messaging.prompt &&
      h(
        "p",
        {},
        `${view.messaging.prompt.name ?? view.messaging.prompt.uri} vous écrit. `,
        button("Accepter", () => trix.messaging.acceptSender(view.messaging.prompt!.key)),
        button("Refuser", () => trix.messaging.refuseSender(view.messaging.prompt!.key)),
      ),
    h("h2", { textContent: "Échanges" }),
    ...view.threads.map((t) => thread(view, t)),
  );
}

function thread(view: TrixView, t: Thread): Node {
  const open = openKey === t.key;
  const head = h(
    "p",
    {},
    button(open ? "▾" : "▸", () => {
      openKey = open ? null : t.key;
      render();
    }),
    ` ${t.name}`,
    t.presence ? h("span", { className: "muted", textContent: ` (${t.presence.info.state})` }) : null,
    t.unread > 0 ? ` — ${t.unread} non lu(s)` : "",
    " ",
    !t.blocked && button("Appeler", () => trix.call.dial(t.target, { audio: true, video: false, text: true })),
  );
  if (!open) return head;
  if (t.unread > 0 && document.visibilityState === "visible") queueMicrotask(() => trix.messaging.read(t.key));
  const input = h("input", { name: `message-${t.key}`, placeholder: "Message" });
  return h(
    "div",
    {},
    head,
    h(
      "ul",
      {},
      ...t.messages.map((m) =>
        h(
          "li",
          { className: m.direction === "outgoing" ? "bubble us" : "bubble" },
          m.file ? `📎 ${m.file.name ?? "fichier"} ` : "",
          m.text,
          m.state === "failed" ? h("span", { className: "error", textContent: ` — ${say(m.reason)}` }) : null,
        ),
      ),
      ...t.calls.map(({ entry }) =>
        h(
          "li",
          { className: "muted" },
          `Appel ${entry.direction} : ${entry.outcome}`,
          // what was written during the call, kept with it in the history
          ...(entry.chat ?? []).map((item) =>
            item.kind === "bubble"
              ? h("div", { className: `bubble ${item.side}`, textContent: bubbleText(item) })
              : null,
          ),
        ),
      ),
    ),
    !t.blocked &&
      view.messaging.state !== "disabled" &&
      h(
        "form",
        {
          onsubmit: (e: Event) => {
            e.preventDefault();
            if (!input.value.trim()) return;
            trix.messaging.send(t.target, input.value);
            input.value = "";
          },
        },
        input,
        h("button", { type: "submit", textContent: "Envoyer" }),
      ),
  );
}

function inCall(view: TrixView): Node {
  const call = view.call!;
  const ringing = call.state === "ringing_in";
  const conv = view.conversation;
  const text = h("textarea", { name: "rtt", rows: 3, value: conv?.draft ?? "" });
  text.oninput = () => trix.conversation.type(text.value);
  text.onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      trix.conversation.enter();
    }
  };
  return h(
    "section",
    {},
    h("h1", { textContent: call.displayName ?? call.target }),
    h("p", { textContent: `Appel ${call.direction} — ${call.state}` }),
    ringing && button("Répondre", () => trix.call.answer({ ...call.offered, video: false })),
    ringing && button("Refuser", () => trix.call.reject()),
    !ringing && button("Raccrocher", () => trix.call.hangup()),
    view.errors.call && h("p", { className: "error", textContent: say(view.errors.call) }),
    conv &&
      h(
        "div",
        {},
        h("h2", { textContent: "Texte" }),
        ...conv.items.map((item) =>
          item.kind === "bubble"
            ? h("p", { className: `bubble ${item.side}`, textContent: bubbleText(item) })
            : h("p", { className: "muted", textContent: formatMsg(item.key, LOCALE) }),
        ),
        conv.refused ? h("p", { className: "muted", textContent: "Le correspondant ne prend pas le texte." }) : text,
      ),
  );
}

// ---- the loop: a view in, a screen out -----------------------------------

function screen(view: TrixView): Node {
  switch (view.phase) {
    case "loading":
      return h("p", { textContent: "Chargement…" });
    case "vaultError":
      return vaultError();
    case "accounts":
      return accounts(view);
    case "settings":
      return settings(view);
    case "ready":
      return ready(view);
    case "inCall":
      return inCall(view);
  }
}

function render(): void {
  const view = trix.view();
  if (!view) return;
  // the focused field, its text and its caret go back where they were
  const focused = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  const keep = focused?.name ? { name: focused.name, value: focused.value, at: focused.selectionStart } : null;
  app.replaceChildren(screen(view));
  if (keep) {
    const again = app.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${CSS.escape(keep.name)}"]`);
    if (again) {
      // the conversation's draft is the core's: it already holds the text
      if (again.name !== "rtt") again.value = keep.value;
      again.focus();
      if (keep.at !== null) again.setSelectionRange(keep.at, keep.at);
    }
  }
}

// the commands, onStreams included, wait for the core to be ready
await trix.ready;

// the call's sound: a stream, set on an element this page owns (D4)
trix.call.onStreams(() => {
  remote.srcObject = trix.call.streams().remote;
});
trix.subscribe(render);
render();
