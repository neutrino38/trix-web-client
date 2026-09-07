/**
 * CallBlock — un appel, écrit comme un **service building block**
 * (`finite-state-language` §8.4, docs/CONCEPTION.md §4.2 et §4.3).
 *
 * Ce n'est pas une seconde machine : PhoneMachine l'*entre* depuis son
 * état `in_call` et se suspend là jusqu'au retour. Une seule instance,
 * un seul contexte, une seule boîte aux lettres — le bloc écrit la vue
 * de l'appel dans `ctx.call`, que l'UI lit déjà, au lieu d'en tenir un
 * miroir chez le parent.
 *
 * Ce qui lui appartient en propre vit dans sa sandbox (`fx.data`) : la
 * session JsSIP, qui a raccroché, la renégociation en vol. Rien de cela ne
 * peut entrer en collision avec une clé de l'hôte.
 *
 * Une seule définition sert les deux sens : `initial_state` aiguille
 * vers `dialing` (INVITE sortant) ou `ringing_in` (INVITE entrant, passé
 * dans `args.incoming`). Une fois établis, les deux sens partagent
 * exactement le même état `connected`.
 *
 * **Le bloc consomme tout ce qui arrive pendant l'appel**, y compris ce
 * dont la politique appartient au téléphone (perte du proxy, veille,
 * enregistrement perdu, second INVITE) : un événement qu'il laisserait
 * passer attendrait dans la file un hôte qui ne répond pas avant son
 * retour. Ce qui relève de l'hôte, il l'écrit dans le contexte partagé
 * (`ctx.lastError`, `ctx.sleepRequested`) ; ce qui relève de l'appel, il
 * le rapporte dans son outcome.
 */

import { defineSbb, goto, stay } from "finite-state-language";
import type { OnMap, SbbFx } from "finite-state-language";
import type {
  CallMedia,
  CallSession,
  IncomingCall,
  MediaKind,
  MediaOffer,
  RejectReason,
  SipHandle,
  SipOriginator,
} from "../sip/port.js";
import { MEDIA_KINDS, NO_MEDIA, anyMedia, isLastMedia, mergeMedia, sameMedia } from "../sip/port.js";
import type { CallDirection } from "../storage/store.js";
import { msg, rawMsg, type Msg, type MsgKey } from "../i18n/types.js";
import type { CallNotice, CallReturn, CallView, PhoneEvent, SuspectField } from "./events.js";

/**
 * Ce que le bloc exige de trouver chez son hôte — la plus petite forme
 * qui marche, et le compilateur refuse un hôte qui ne la fournit pas.
 * `handle` est l'UA sur lequel l'appel se place ; les autres champs sont
 * ce que le bloc a le droit d'influencer chez lui.
 */
export interface CallHost {
  handle: SipHandle | null;
  /** La vue de l'appel : c'est le bloc qui l'écrit, l'UI qui la lit. */
  call: CallView | null;
  lastError: Msg | null;
  lastErrorCode: string | null;
  suspectFields: SuspectField | null;
  /** Veille demandée pendant l'appel : l'hôte ira dormir au retour. */
  sleepRequested: boolean;
}

/** La sandbox du bloc : son état de travail, invisible de l'hôte. */
export interface CallData {
  /** Passés par le site d'appel. */
  target: string;
  media: CallMedia;
  direction: CallDirection;
  /** Entrant uniquement : l'INVITE en attente de décision. */
  incoming: IncomingCall | null;
  displayName: string | null;
  /** Médias proposés par l'appelant (entrant) ; = `media` pour un sortant. */
  offered: CallMedia;
  /**
   * Ce que nous avons demandé en dernier — à l'INVITE, à la réponse, ou
   * par re-INVITE. `media` dit ce que l'appel transporte ; la différence
   * entre les deux est exactement ce qui se dit à l'écran (« Bob n'a pas
   * accepté la vidéo »).
   */
  asked: CallMedia;
  session: CallSession | null;
  connectedAt: number | null;
  endedBy: "local" | "remote" | "network" | null;
  selfViewHidden: boolean;
  /**
   * **Un seul verrou de renégociation** (ADR 0003, D5) : une à la fois,
   * quel que soit le média qu'elle porte. Deux re-INVITE en vol sur la même
   * boîte de dialogue, c'est un 491 garanti — le verrou appartient donc à
   * l'appel, pas au média.
   */
  mediaPending: boolean;
  /**
   * **Axe 2** : je n'émets plus rien, le temps d'une pause (D7). Ce n'est
   * pas un média de moins — l'appel n'a pas changé — et cela ne se négocie
   * pas : le port lâche les deux pistes, et personne n'a de réponse à
   * attendre.
   */
  paused: boolean;
  /** Le correspondant s'est mis en pause : ses pistes se sont tues. */
  peerPaused: boolean;
  /**
   * **Ce que j'émets d'écran** (ADR 0005, D3). Il vit ici, à côté de
   * `media`, et non dedans : un partage n'est pas un média de l'appel — il
   * ne compte pas dans « ne pas retirer le dernier », il ne se consigne pas
   * dans l'historique, et on ne décroche pas « en partage ».
   */
  sharing: "off" | "starting" | "on";
  /**
   * **Ce que je reçois d'écran** (ADR 0005, D11). Comme `sharing`, il vit à
   * côté de `media` et non dedans : l'appel ne transporte pas un média de
   * plus parce qu'un document défile.
   *
   * Ce qu'il change est la **scène** : l'écran prend la grande surface, la
   * caméra du correspondant passe en vignette, et l'auto-vue se replie —
   * trois images sur un téléphone n'en font aucune lisible.
   */
  peerSharing: boolean;
  /**
   * Ce que le réseau émet **avant le décrochage** (RFC 3960), lu dans le
   * SDP des réponses provisoires : les trois médias, parce qu'un accueil
   * peut être parlé, signé ou écrit. `NO_MEDIA` tant qu'aucune réponse
   * provisoire n'a décrit de flux — l'état `early_media` est justement
   * celui où ce n'est plus le cas.
   */
  earlyMedia: CallMedia;
  /** Média proposé par le distant, en attente de la décision de l'utilisateur. */
  mediaOffer: MediaOffer | null;
  /** Ce que cette offre ajouterait — de quoi nommer le média dans la question. */
  offerAdds: MediaKind[];
  /**
   * L'offre en attente apporte un **écran partagé** (ADR 0005, D5). Une
   * seule question pour tout ce qu'elle porte : c'est déjà la sémantique
   * d'`offerAdds`, et accepter vaut pour l'ensemble.
   */
  offerShare: boolean;
  /** Les tonalités DTMF réellement parties, dans l'ordre de composition. */
  dtmfSent: string;
  /** Dernier message fugace publié, et le numéro d'ordre qui le distingue. */
  notice: CallNotice | null;
  noticeSeq: number;
  /**
   * Décidé au moment où l'on raccroche, lu par `hangingup` au moment de
   * rapporter : c'est nous qui avons mis fin à l'appel, quoi que dise
   * l'originator ensuite.
   */
  endingAs: Ending;
  endReason: Msg;
}

/**
 * Comment un raccrochage **de notre fait** sera rapporté, décidé au
 * moment où l'on envoie le CANCEL/BYE et lu par `hangingup`. Les issues
 * subies (`rejected`) sont rapportées sur place par l'état qui les voit.
 */
type Ending = "answered" | "canceled" | "missed" | "dropped";

type CallFx = SbbFx<PhoneEvent, CallHost, CallData, CallReturn>;
type CallStateName =
  | "initial_state"
  | "dialing"
  | "ringing"
  | "early_media"
  | "ringing_in"
  | "answering"
  | "connected"
  | "renegotiating"
  | "media_offer"
  | "hangingup";
type CallOn = OnMap<CallHost, PhoneEvent, CallStateName, CallFx>;

/** Publie l'état courant de l'appel dans le contexte de l'hôte. */
function publish(state: CallView["state"], ctx: CallHost, data: CallData): void {
  ctx.call = {
    state,
    direction: data.direction,
    target: data.target,
    displayName: data.displayName,
    offered: data.offered,
    media: data.media,
    selfViewHidden: data.selfViewHidden,
    paused: data.paused,
    peerPaused: data.peerPaused,
    sharing: data.sharing,
    peerSharing: data.peerSharing,
    mediaPending: data.mediaPending,
    mediaAsked: data.mediaOffer !== null ? data.offerAdds : null,
    shareAsked: data.mediaOffer !== null && data.offerShare,
    dtmfSent: data.dtmfSent,
    notice: data.notice,
    earlyMedia: data.earlyMedia,
    connectedAt: data.connectedAt,
    endedBy: data.endedBy,
    session: data.session,
  };
}

/**
 * Le correspondant tel qu'on le nomme dans une phrase — son nom affiché
 * s'il en porte un, son adresse sinon, débarrassée du `sip:` que
 * personne ne lit à voix haute.
 */
function peerName(data: CallData): string {
  return data.displayName ?? data.target.replace(/^sips?:/i, "");
}

/**
 * Prépare un message fugace : le numéro d'ordre est ce qui permet à
 * l'écran de reconnaître un **nouveau** message d'un simple re-rendu, y
 * compris quand c'est deux fois la même phrase. Il partira avec la
 * prochaine publication de la vue — c'est ce qu'il faut avant que l'appel
 * soit établi, où l'état publié n'est pas encore `connected`.
 */
function noteNotice(fx: CallFx, message: Msg): void {
  fx.data.noticeSeq += 1;
  fx.data.notice = { seq: fx.data.noticeSeq, message };
}

/** Le même message, publié sur-le-champ : l'appel est en communication. */
function notify(ctx: CallHost, fx: CallFx, message: Msg): void {
  noteNotice(fx, message);
  publish("connected", ctx, fx.data);
}

function failReason(ev: { cause: string; statusCode?: number; detail?: string }): Msg {
  // la cause vient de JsSIP, le code du protocole et le détail du
  // navigateur : aucun des trois ne se traduit — seul leur assemblage est
  // une phrase. Le détail n'existe que pour un échec média, et c'est lui
  // qui dit ce que « WebRTC Error » cache (docs/CONCEPTION.md §5.5).
  const cause = ev.detail ? `${ev.cause} — ${ev.detail}` : ev.cause;
  return ev.statusCode ? msg("reason.sip", { cause, code: ev.statusCode }) : rawMsg(cause);
}

/** Traduit l'originator JsSIP en responsable de la fin d'appel (`system` = incident réseau). */
function endedBy(originator: SipOriginator | undefined): "local" | "remote" | "network" {
  return originator === "local" ? "local" : originator === "system" ? "network" : "remote";
}

/**
 * Fin de session subie : on note qui l'a provoquée et on publie une
 * dernière vue avant de rapporter. Le `sbbReturn` reste sur le site
 * d'appel — c'est ce qui garde le diagramme extrait honnête, une arête
 * par issue réellement atteignable depuis cet état.
 */
function sealed(
  from: CallView["state"],
  by: "local" | "remote" | "network",
  ctx: CallHost,
  fx: CallFx,
): void {
  fx.data.endedBy = by;
  publish(from, ctx, fx.data);
}

/**
 * Raccrochage de notre fait : on envoie le CANCEL/BYE et on attend la
 * confirmation dans `hangingup`, qui rapportera `ending`.
 */
function hangUp(fx: CallFx, ending: Ending, reason: Msg, desc: string) {
  fx.data.session?.terminate();
  fx.data.endingAs = ending;
  fx.data.endReason = reason;
  return goto("hangingup", desc);
}

/**
 * Fin d'un appel entrant jamais décroché. `reason` devient le motif de
 * la ligne d'historique (« manqué » vs « refusé »), et `failed` sépare ce
 * que l'écran doit signaler (un refus technique) de ce qu'il doit taire
 * (un appel simplement manqué).
 *
 * La vue est publiée avant de rapporter : elle porte la session, donc le
 * carnet et le bilan média que l'hôte attache à la ligne d'historique
 * (§5.3). Elle n'est jamais rendue — le rendu vient une microtask plus
 * tard, quand le bloc a déjà rendu la main.
 */
function refuse(
  ctx: CallHost,
  fx: CallFx,
  how: RejectReason,
  reason: Msg,
  failed = false,
): void {
  fx.data.incoming?.reject(how);
  fx.data.endedBy = "local";
  publish("ringing_in", ctx, fx.data);
  fx.sbbReturn("missed", { reason, failed });
}

/**
 * Le retour de `hangingup`, seul endroit où l'issue est décidée
 * ailleurs qu'ici : c'est nous qui avons raccroché, et `endingAs` dit
 * pourquoi. Les quatre branches sont les quatre façons dont un
 * raccrochage de notre fait se lit dans l'historique.
 */
function report(fx: CallFx): void {
  const d = fx.data;
  const reason = d.endReason;
  switch (d.endingAs) {
    case "answered":
      fx.sbbReturn("answered", {
        connectedAt: d.connectedAt ?? Date.now(),
        media: d.media,
        endedBy: d.endedBy === "remote" ? "remote" : "local",
      });
      return;
    case "dropped":
      fx.sbbReturn("dropped", { connectedAt: d.connectedAt, media: d.media, reason });
      return;
    case "missed":
      // report() ne sert qu'aux raccrochages de notre fait : jamais un échec
      fx.sbbReturn("missed", { reason, failed: false });
      return;
    case "canceled":
      fx.sbbReturn("canceled", { reason });
  }
}

/**
 * Ce que tout état du bloc doit consommer parce que personne d'autre ne
 * peut : l'hôte est suspendu, et un événement laissé dans la file y
 * attendrait un bloc qui ne revient pas (invariant 7 de DESIGN-SBB).
 *
 * `ending` est ce que l'appel deviendra si l'état courant est
 * interrompu — la seule chose qui varie d'un état à l'autre.
 */
function interruptions(ending: Ending): CallOn {
  return {
    // proxy perdu : l'appel ne survivra pas, on raccroche et on rapporte
    // `dropped` — l'hôte lit l'erreur qu'on lui laisse pour reconnecter.
    "sip:disconnected": (_ev, ctx, fx) => {
      ctx.lastError = msg("error.proxyLostDuringCall");
      ctx.lastErrorCode = "WSS_LOST";
      ctx.suspectFields = "proxy";
      return hangUp(fx, "dropped", msg("error.proxyLostDuringCall"), "proxy perdu");
    },
    // veille : on raccroche, et l'hôte saura au retour qu'il doit dormir
    "sys:sleep": (_ev, ctx, fx) => {
      ctx.sleepRequested = true;
      return hangUp(fx, ending, msg("reason.sleep"), "veille");
    },
    // l'enregistrement tombe pendant l'appel : l'appel continue, mais
    // l'hôte doit le savoir pour choisir où revenir
    "sip:registrationFailed": (ev, ctx) => {
      ctx.lastError = msg("error.regLost", { cause: ev.cause });
      ctx.lastErrorCode = ev.statusCode ? `SIP ${ev.statusCode}` : ev.cause;
      ctx.suspectFields = "credentials";
      return undefined;
    },
    // deuxième INVITE pendant un appel : occupé (pas de double appel)
    "sip:incoming": (ev) => {
      ev.call.reject("busy");
    },
    /**
     * Média négocié avant que l'appel ne soit établi (la réponse SDP
     * arrive avant le 200 OK côté JsSIP) : on retient ce que l'appel
     * transporte réellement, l'écran le dira une fois en communication.
     */
    "sip:mediaChanged": (ev, _ctx, fx) => {
      const media = ev.media;
      // la vidéo demandée n'a pas été acceptée : c'est le décroché audio
      // d'un appel passé en vidéo, et l'appelant doit le savoir
      if (fx.data.asked.video && !media.video)
        noteNotice(fx, msg("notice.videoDeclined", { peer: peerName(fx.data) }));
      fx.data.media = media;
      return undefined;
    },
    "sip:mediaRefused": () => undefined,
    // hors communication, il n'y a rien à ajouter à un appel qui n'existe
    // pas encore : le distant est éconduit tout de suite
    "sip:mediaOffer": (ev) => {
      ev.offer.reject();
    },
    // désactivés à l'écran pendant l'appel : consommés pour qu'un clic ne
    // reste pas en attente et ne s'exécute pas après coup
    "ui:toggleMedia": () => undefined,
    // **le partage n'existe pas avant le décrochage** : il n'y a pas de
    // dialogue confirmé où poser un re-INVITE (ADR 0005, SC-2), et rien
    // n'est parti qui puisse conclure
    "ui:toggleShare": () => undefined,
    "sip:sharing": () => undefined,
    "sip:shareEnded": () => undefined,
    // et il n'y a pas davantage d'écran à recevoir : rien n'est négocié
    "sip:peerSharing": () => undefined,
    // le clavier DTMF n'existe qu'en communication : hors de là, il n'y a
    // pas de flux RTP où glisser la tonalité
    "ui:dtmf": () => undefined,
    "ui:acceptMedia": () => undefined,
    "ui:rejectMedia": () => undefined,
    // hors communication, il n'y a rien à suspendre : le bouton n'existe pas
    // à l'écran, et l'événement qui arriverait quand même est consommé
    "ui:togglePause": () => undefined,
    // les pistes distantes se taisent à l'établissement comme au
    // raccrochage : ce n'est pas une pause, et il n'y a rien à en dire
    "sip:peerPaused": () => undefined,
    "ui:backToSettings": () => undefined,
    "ui:logout": () => undefined,
    // changer de compte pendant un appel serait raccrocher au nom de
    // l'utilisateur, ou laisser un appel vivre sur un compte qui n'est plus
    // enregistré : l'interdiction vaut dès la première sonnerie, et elle ne
    // repose pas sur l'état d'un bouton (ADR 0002, décision 4 bis)
    "ui:switchAccount": () => undefined,
    "ui:call": () => undefined,
    "ui:clearHistory": () => undefined,
    "sip:registered": () => undefined,
    "sip:connected": () => undefined,
    "sys:wake": () => undefined,
  };
}

/**
 * Les messages fugaces d'un changement de média, un jeu par média. Une
 * table plutôt qu'une phrase à trous : « a ajouté la vidéo » et « a ajouté
 * l'audio » ne se construisent pas par concaténation dans les six langues —
 * l'article change, et l'arabe comme le japonais n'ont pas la même syntaxe.
 */
const NOTICE: Record<
  MediaKind,
  { declined: MsgKey; refused: MsgKey; added: MsgKey; removed: MsgKey; declinedHere: MsgKey; unavailable: MsgKey }
> = {
  audio: {
    declined: "notice.audioDeclined",
    refused: "notice.audioRefused",
    added: "notice.audioAdded",
    removed: "notice.audioRemoved",
    declinedHere: "notice.audioDeclinedHere",
    unavailable: "notice.audioUnavailable",
  },
  video: {
    declined: "notice.videoDeclined",
    refused: "notice.videoRefused",
    added: "notice.videoAdded",
    removed: "notice.videoRemoved",
    declinedHere: "notice.videoDeclinedHere",
    unavailable: "notice.videoUnavailable",
  },
};

/**
 * Ce qui se dit à l'écran quand **on vient de refuser** ce que le distant
 * proposait. Un média refusé le dit par son nom ; une offre qui n'apportait
 * qu'un écran a sa propre phrase — parler de « la vidéo » ferait croire à
 * une caméra qui vient de s'éteindre, alors que rien de ce que l'appel
 * transporte n'a bougé (ADR 0005, D3).
 *
 * Une offre qui portait les deux se dit par le média : c'est lui qui change
 * la nature de l'appel, l'écran n'en change que la scène.
 */
function declinedHere(data: CallData): Msg {
  const kind = data.offerAdds[0];
  return kind === undefined ? msg("notice.shareDeclinedHere") : msg(NOTICE[kind].declinedHere);
}

/** Les médias qui ont changé entre deux états de l'appel — l'audio d'abord. */
function changed(before: CallMedia, after: CallMedia): MediaKind[] {
  return MEDIA_KINDS.filter((k) => before[k] !== after[k]);
}

/**
 * Combien de tonalités la vue garde. Un code de conférence en fait une
 * douzaine, un menu vocal quelques-unes de plus ; au-delà, ce sont les
 * dernières qui intéressent — et l'écho de l'écran a une largeur finie.
 */
const DTMF_KEPT = 32;

/**
 * Ce que les deux temps de l'attente d'une réponse partagent — `ringing`
 * et `early_media`. Du point de vue du protocole, ils sont le même état :
 * l'INVITE a reçu une réponse provisoire et attend la finale. Ce qui les
 * sépare est ce que l'appelant **entend** pendant ce temps, et cela ne
 * regarde que l'écran (ADR 0003, §4 — F.703 §6.1.2).
 *
 * `from` est l'état d'où l'on scelle : c'est lui qui sera publié en
 * dernier, et l'historique n'a pas à confondre un appel resté sans
 * réponse avec un appel où le réseau a répondu quelque chose.
 */
function awaitingAnswer(from: "ringing" | "early_media"): CallOn {
  return {
    ...interruptions("canceled"),
    /**
     * **Rien ne change de média avant le décrochage**, et cela est dit ici
     * plutôt que laissé au hasard d'un événement sans destinataire.
     *
     * L'appel n'est pas encore un appel : il n'y a pas de dialogue établi
     * où poser un re-INVITE (RFC 3261 §14.1 le réserve à un dialogue
     * confirmé), et l'offre partie avec l'INVITE est celle à laquelle le
     * distant est en train de répondre — la changer sous lui n'aurait pas
     * de sens. L'écran dit la même chose de son côté : les deux boutons
     * média sont désactivés hors communication (`call/overlay.ts`).
     *
     * La Pause est refusée pour la même raison, à l'envers : il n'y a rien
     * à suspendre tant que rien n'est établi.
     */
    "ui:toggleMedia": () => undefined,
    "ui:toggleShare": () => undefined,
    "ui:togglePause": () => undefined,
    "sip:accepted": () => goto("connected", "200 OK"),
    "sip:failed": (ev, ctx, fx) => {
      sealed(from, endedBy(ev.originator), ctx, fx);
      fx.sbbReturn("rejected", { reason: failReason(ev) });
    },
    "sip:ended": (ev, ctx, fx) => {
      sealed(from, endedBy(ev.originator), ctx, fx);
      fx.sbbReturn("canceled", { reason: rawMsg(ev.cause) });
    },
    "ui:hangup": (_ev, _ctx, fx) => hangUp(fx, "canceled", msg("reason.hungUp"), "CANCEL"),
  };
}

/**
 * Le délai de garde de l'appel sortant est écoulé : personne ne décrochera,
 * on annule et on rapporte. Seul le corps est partagé — le `delay` reste
 * écrit dans chaque état, faute de quoi le diagramme perd l'arête et une
 * garde qui n'apparaît plus nulle part ne se relit plus (§4.5).
 */
function giveUp(from: "ringing" | "early_media", ctx: CallHost, fx: CallFx): void {
  fx.data.session?.terminate();
  sealed(from, "local", ctx, fx);
  fx.sbbReturn("rejected", { reason: msg("reason.noAnswer") });
}

/**
 * Ce que les trois états de la communication partagent — `connected` et
 * les deux temps d'une renégociation. L'appel ne change pas de nature
 * parce qu'une offre est en vol : on raccroche, on compose un DTMF et on
 * masque son self-view exactement pareil.
 */
function inCall(): CallOn {
  return {
    ...interruptions("answered"),
    "sip:confirmed": () => undefined, // ACK
    "sip:accepted": () => undefined,
    "sip:progress": () => undefined,
    "sip:ended": (ev, ctx, fx) => {
      const by = endedBy(ev.originator);
      sealed("connected", by, ctx, fx);
      // un incident réseau n'est pas un raccrochage : la ligne
      // d'historique n'est pas la même, et c'est le bloc qui le sait
      if (by === "network") {
        fx.sbbReturn("dropped", {
          connectedAt: fx.data.connectedAt,
          media: fx.data.media,
          reason: rawMsg(ev.cause),
        });
        return;
      }
      fx.sbbReturn("answered", {
        connectedAt: fx.data.connectedAt ?? Date.now(),
        media: fx.data.media,
        endedBy: by,
      });
    },
    "sip:failed": (ev, ctx, fx) => {
      sealed("connected", endedBy(ev.originator), ctx, fx);
      fx.sbbReturn("dropped", {
        connectedAt: fx.data.connectedAt,
        media: fx.data.media,
        reason: failReason(ev),
      });
    },
    "ui:hangup": (_ev, _ctx, fx) => hangUp(fx, "answered", msg("reason.hungUp"), "BYE"),
    /**
     * **La Pause** (D6, D7). `stay()` et non `goto()` : rien ne se négocie,
     * donc il n'y a pas d'état d'attente — le geste est instantané et ne
     * peut pas échouer, ce qui est toute sa valeur.
     *
     * Elle vaut dans les trois états de la communication, renégociation en
     * vol comprise : se retirer un instant ne demande pas d'attendre qu'un
     * re-INVITE ait abouti.
     */
    "ui:togglePause": (_ev, ctx, fx) => {
      fx.data.paused = !fx.data.paused;
      fx.data.session?.setPaused(fx.data.paused);
      publish("connected", ctx, fx.data);
      return stay(fx.data.paused ? "en pause" : "reprise");
    },
    /**
     * Le correspondant s'est mis en pause, ou en est revenu. Rien à faire
     * qu'à le dire : l'appel continue, et nous continuons de lui envoyer
     * tout ce que nous émettons — c'est lui qui s'est retiré, pas nous.
     */
    "sip:peerPaused": (ev, ctx, fx) => {
      if (fx.data.peerPaused === ev.paused) return undefined;
      fx.data.peerPaused = ev.paused;
      publish("connected", ctx, fx.data);
      return stay(ev.paused ? "le distant est en pause" : "le distant est revenu");
    },
    /**
     * **Le correspondant partage son écran** (ADR 0005, D11), ou il vient
     * de cesser. Ce n'est pas un média de plus — `media` ne bouge pas —,
     * c'est la **scène** qui change : l'écran prend la grande surface et
     * son visage passe en vignette.
     *
     * Le self-view se replie avec l'arrivée de l'écran : trois images sur
     * un téléphone n'en font aucune lisible. Le bouton reste, et un appui
     * le rouvre — c'est un pli, pas une interdiction.
     *
     * Il ne se rouvre pas tout seul à la fin du partage : ce serait défaire
     * un geste que l'utilisateur a peut-être fait sien entre-temps.
     */
    "sip:peerSharing": (ev, ctx, fx) => {
      if (fx.data.peerSharing === ev.on) return undefined;
      fx.data.peerSharing = ev.on;
      if (ev.on) fx.data.selfViewHidden = true;
      notify(
        ctx,
        fx,
        msg(ev.on ? "notice.sharePeerStarted" : "notice.sharePeerStopped", {
          peer: peerName(fx.data),
        }),
      );
      return stay(ev.on ? "le distant partage son écran" : "le distant a cessé de partager");
    },
    "ui:toggleSelfView": (_ev, ctx, fx) => {
      fx.data.selfViewHidden = !fx.data.selfViewHidden;
      publish("connected", ctx, fx.data);
      return stay("self-view");
    },
    /**
     * Une touche du clavier DTMF. La tonalité part dans le flux audio
     * (RFC 4733) et n'y laisse aucune trace visible : ce que la vue en
     * garde est tout ce qui dira qu'elle est partie. Elle ne s'y ajoute
     * donc que si le port l'a réellement émise — afficher un chiffre que
     * le serveur vocal n'a jamais reçu serait pire que ne rien afficher.
     */
    "ui:dtmf": (ev, ctx, fx) => {
      if (fx.data.session?.sendDtmf(ev.tone) !== true) {
        notify(ctx, fx, msg("notice.dtmfFailed", { tone: ev.tone }));
        return stay("DTMF perdu");
      }
      fx.data.dtmfSent = (fx.data.dtmfSent + ev.tone).slice(-DTMF_KEPT);
      publish("connected", ctx, fx.data);
      return stay("DTMF");
    },
  };
}

export const CallBlock = defineSbb<CallHost, PhoneEvent, CallData, CallReturn>()({
  name: "CallBlock",
  namespace: "call",
  returns: {
    answered: "l'appel a été établi puis raccroché — {connectedAt, media, endedBy}",
    dropped: "l'appel a été coupé par le réseau — {connectedAt, media, reason}",
    rejected: "l'appel sortant a été refusé ou n'a pas pu être placé — {reason}",
    canceled: "l'appelant a renoncé avant toute réponse — {reason}",
    missed: "l'appel entrant n'a jamais été décroché — {reason, failed}",
  },

  // Un appel n'a pas de borne globale : il finit quand le dialogue finit.
  // Ce sont les états qui portent les délais (sonnerie, établissement,
  // raccrochage), comme le `bridge` du dialecte Elixir.
  timeout: { delay: "infinity" },

  data: () => ({
    target: "",
    media: { audio: true, video: false, text: false },
    direction: "outgoing" as CallDirection,
    incoming: null,
    displayName: null,
    offered: { audio: true, video: false, text: false },
    asked: { audio: true, video: false, text: false },
    session: null,
    connectedAt: null,
    endedBy: null,
    selfViewHidden: false,
    paused: false,
    sharing: "off" as CallData["sharing"],
    peerSharing: false,
    peerPaused: false,
    mediaPending: false,
    earlyMedia: NO_MEDIA,
    mediaOffer: null,
    offerAdds: [] as MediaKind[],
    offerShare: false,
    dtmfSent: "",
    notice: null,
    noticeSeq: 0,
    endingAs: "canceled",
    endReason: msg("reason.hungUp"),
  }),

  /**
   * Le bloc est arraché sans retourner — terminaison de la machine ou
   * arrêt coopératif. La session est à lui, et lui seul sait qu'elle
   * existe : il la referme avant que le déroulement ne poursuive.
   */
  cleanup(ctx, data) {
    data.session?.terminate();
    ctx.call = null;
  },

  states: {
    /**
     * Aiguillage : traversé sans attendre d'événement. Pour un entrant,
     * on s'abonne d'abord à la session (sinon une annulation immédiate de
     * l'appelant passerait inaperçue), puis on part en `ringing_in`.
     *
     * Sauf si l'offre est hors de portée du navigateur : le téléphone ne
     * sonne alors pas du tout. Faire sonner reviendrait à promettre un
     * appel que le décrochage ferait échouer — et le 488 doit partir
     * **avant** le 180, sans quoi l'appelant a entendu une sonnerie qui
     * n'existait pas. C'est possible parce que tout ce chemin est
     * synchrone : JsSIP n'envoie son 180 qu'au retour de l'événement qui
     * nous a livré l'INVITE (§4.3).
     */
    initial_state: {
      enter(ctx, fx) {
        const d = fx.data;
        if (!d.incoming) return goto("dialing", "INVITE sortant");
        d.direction = "incoming";
        d.target = d.incoming.from;
        d.displayName = d.incoming.displayName;
        d.offered = d.incoming.offered;
        d.media = d.incoming.offered; // avant décision, l'affichage montre l'offre
        d.asked = d.incoming.offered;
        // avant le refus comme avant la sonnerie : c'est `listen()` qui
        // ouvre le carnet, et l'appel refusé doit garder le sien
        d.session = d.incoming.listen((ev) => fx.send(ev));
        const problem = d.incoming.offerProblem;
        if (problem) {
          refuse(ctx, fx, "incompatible", msg("reason.offerUnsupported", { detail: problem }), true);
          return;
        }
        return goto("ringing_in", "INVITE entrant");
      },
      meta: { callState: "start" },
    },

    // INVITE envoyé, en attente de réponse provisoire ou finale
    dialing: {
      enter(ctx, fx) {
        const d = fx.data;
        try {
          d.session = ctx.handle!.call(d.target, d.media, (ev) => fx.send(ev));
        } catch (e) {
          fx.sbbReturn("rejected", {
            reason: msg("reason.callFailed", {
              detail: e instanceof Error ? e.message : String(e),
            }),
          });
          return;
        }
        d.offered = d.media;
        d.asked = d.media;
        publish("dialing", ctx, d);
      },
      on: {
        ...interruptions("canceled"),
        "sip:progress": (ev, _ctx, fx) => {
          if (!anyMedia(ev.media)) return goto("ringing", "180");
          fx.data.earlyMedia = ev.media;
          return goto("early_media", "183 + SDP");
        },
        "sip:accepted": () => goto("connected", "200 OK"),
        "sip:failed": (ev, ctx, fx) => {
          sealed("dialing", endedBy(ev.originator), ctx, fx);
          fx.sbbReturn("rejected", { reason: failReason(ev) });
        },
        "sip:ended": (ev, ctx, fx) => {
          sealed("dialing", endedBy(ev.originator), ctx, fx);
          fx.sbbReturn("canceled", { reason: rawMsg(ev.cause) });
        },
        "ui:hangup": (_ev, _ctx, fx) => hangUp(fx, "canceled", msg("reason.hungUp"), "CANCEL"),
      },
      meta: { callState: "dialing" },
    },

    ringing: {
      enter(ctx, fx) {
        publish("ringing", ctx, fx.data);
      },
      on: {
        ...awaitingAnswer("ringing"),
        // un 183 porteur de SDP, après le 180 : le réseau se met à parler
        "sip:progress": (ev, _ctx, fx) => {
          if (!anyMedia(ev.media)) return undefined;
          fx.data.earlyMedia = ev.media;
          return goto("early_media", "183 + SDP");
        },
      },
      // 90 s : le Timer C de RFC 3261 §16.6, la limite qu'un proxy applique
      // de toute façon à une transaction INVITE. Le délai est écrit ici, en
      // clair, et non derrière une constante : c'est de cette ligne que le
      // diagramme tire son arête (§4.5)
      after: {
        delay: 90_000,
        then: (ctx, fx) => giveUp("ringing", ctx, fx),
      },
      meta: { callState: "ringing" },
    },

    /**
     * **Le réseau parle avant le décrochage** (RFC 3960) : une réponse
     * provisoire a porté une description de session, et du son arrive déjà
     * — la sonnerie de l'opérateur, une annonce (« votre correspondant
     * n'est pas joignable »), un serveur vocal. Les pistes reçues sont
     * branchées sur l'élément distant dès qu'elles arrivent
     * (`sip/port.ts`, `attachMedia`) : cela s'entend.
     *
     * Rien ne distingue cet état de `ringing` du point de vue du protocole
     * — mêmes réponses attendues, même délai de garde. Ce qu'il porte est
     * ce que l'écran doit en faire : **se taire**. Le retour d'appel que
     * Trix produit localement (F.703 §6.1.2, `ui/ring.ts`) couvrirait ce
     * que le réseau a déjà à dire, et deux tonalités qui se répondent
     * valent moins qu'une.
     *
     * On n'en revient pas : un 180 sans SDP qui suivrait n'interrompt pas
     * le flux précoce, il cesse seulement de le décrire. Repasser en
     * `ringing` rallumerait la tonalité par-dessus.
     *
     * **Ce que l'on émet pendant ce temps**, et qui n'est pas un choix :
     * les flux audio et vidéo sortants sont ouverts dès l'établissement de
     * la connexion pair-à-pair, avant le décrochage. C'est ce qui perce le
     * NAT — sans paquet sortant, aucune passerelle ne sait où renvoyer le
     * média, et l'annonce précoce n'arriverait jamais. Le texte fait la
     * même chose avec sa signature de session, qui ne dit rien
     * (`sip/rttws.ts`). Ce n'est donc pas un état où l'on peut promettre
     * que rien ne part ; c'est un état où rien de ce qui part n'a été
     * *décidé* — d'où l'interdiction de toucher aux médias jusqu'au
     * décrochage (`awaitingAnswer`), et la saisie de texte fermée à
     * l'écran (`call/chat.ts`).
     */
    early_media: {
      enter(ctx, fx) {
        publish("early_media", ctx, fx.data);
      },
      on: {
        ...awaitingAnswer("early_media"),
        /**
         * Réponses provisoires suivantes : le média précoce **s'ajoute**,
         * il ne se retire pas. Un 180 sans SDP après un 183 qui en portait
         * un n'interrompt aucun flux, il cesse seulement de le décrire ; et
         * une annonce qui passe de la parole à la langue des signes est un
         * média de plus, pas un média à la place.
         */
        "sip:progress": (ev, ctx, fx) => {
          const merged = mergeMedia(fx.data.earlyMedia, ev.media);
          if (sameMedia(merged, fx.data.earlyMedia)) return undefined;
          fx.data.earlyMedia = merged;
          publish("early_media", ctx, fx.data);
          return undefined;
        },
      },
      // le délai de garde repart de l'entrée dans cet état : une annonce
      // du réseau est une progression, pas une attente qui s'éternise
      after: {
        delay: 90_000,
        then: (ctx, fx) => giveUp("early_media", ctx, fx),
      },
      meta: { callState: "early_media" },
    },

    /**
     * Le téléphone sonne : l'UI propose les réponses compatibles avec
     * l'offre (`offered`) et le refus. Un appel entrant non décroché
     * n'est pas une erreur — il ressort en `missed` avec le motif exact,
     * que l'hôte consigne tel quel dans l'historique.
     */
    ringing_in: {
      enter(ctx, fx) {
        publish("ringing_in", ctx, fx.data);
      },
      on: {
        ...interruptions("missed"),
        "ui:answer": (ev, _ctx, fx) => {
          fx.data.media = ev.media;
          fx.data.asked = ev.media;
          fx.data.incoming!.answer(ev.media);
          return goto("answering", "200 OK");
        },
        "ui:reject": (_ev, ctx, fx) => refuse(ctx, fx, "declined", msg("reason.declined")),
        // le bouton rouge de la vue mobile pendant la sonnerie = refuser
        "ui:hangup": (_ev, ctx, fx) => refuse(ctx, fx, "declined", msg("reason.declined")),
        // l'appelant a renoncé (CANCEL) : appel manqué, pas un échec
        "sip:failed": (ev, ctx, fx) => {
          sealed("ringing_in", endedBy(ev.originator), ctx, fx);
          fx.sbbReturn("missed", { reason: msg("reason.missed"), failed: false });
        },
        "sip:ended": (ev, ctx, fx) => {
          sealed("ringing_in", endedBy(ev.originator), ctx, fx);
          fx.sbbReturn("missed", { reason: msg("reason.missed"), failed: false });
        },
      },
      after: {
        delay: 60_000,
        then: (ctx, fx) => refuse(ctx, fx, "timeout", msg("reason.missedNoAnswer")),
      },
      meta: { callState: "ringing_in" },
    },

    /** 200 OK envoyé : on attend la confirmation de la session par JsSIP. */
    answering: {
      enter(ctx, fx) {
        publish("answering", ctx, fx.data);
      },
      on: {
        ...interruptions("missed"),
        "sip:accepted": () => goto("connected", "200 OK"),
        "sip:confirmed": () => goto("connected", "ACK"),
        "sip:progress": () => undefined,
        "sip:failed": (ev, ctx, fx) => {
          sealed("answering", endedBy(ev.originator), ctx, fx);
          fx.sbbReturn("missed", { reason: failReason(ev), failed: true });
        },
        "sip:ended": (ev, ctx, fx) => {
          sealed("answering", endedBy(ev.originator), ctx, fx);
          fx.sbbReturn("missed", { reason: rawMsg(ev.cause), failed: true });
        },
        "ui:hangup": (_ev, _ctx, fx) => hangUp(fx, "missed", msg("reason.declined"), "BYE"),
      },
      after: {
        // média refusé par l'OS, ACK jamais reçu… : ne pas rester bloqué
        delay: 30_000,
        then: (ctx, fx) => {
          fx.data.session?.terminate();
          sealed("answering", "local", ctx, fx);
          fx.sbbReturn("missed", {
            reason: msg("reason.setupFailed"),
            failed: true,
          });
        },
      },
      meta: { callState: "answering" },
    },

    connected: {
      enter(ctx, fx) {
        // `??=` et non `=` : la communication repasse par cet état après
        // chaque renégociation, le chronomètre ne repart pas de zéro
        fx.data.connectedAt ??= Date.now();
        fx.data.mediaPending = false;
        publish("connected", ctx, fx.data);
      },
      on: {
        ...inCall(),
        /**
         * Les deux boutons média, **strictement symétriques** (ADR 0003,
         * D5) : chacun ajoute son média à l'appel, ou l'en retire. Le
         * re-INVITE part, son issue arrivera en `sip:mediaChanged` ou
         * `sip:mediaRefused`.
         *
         * L'invariant « on ne retire pas le dernier média » se vérifie
         * **ici**, et nulle part ailleurs : l'interface ne fait qu'en griser
         * le bouton, et l'événement qui passerait malgré tout est refusé au
         * même endroit que celui qui vient d'un raccourci clavier.
         */
        "ui:toggleMedia": (ev, _ctx, fx) => {
          const kind = ev.kind;
          const on = !fx.data.media[kind];
          if (!on && isLastMedia(fx.data.media, kind)) return stay("dernier média");
          fx.data.asked = { ...fx.data.media, [kind]: on };
          fx.data.session?.setMedia(kind, on);
          return goto("renegotiating", `${on ? "ajout" : "retrait"} : ${kind}`);
        },
        /**
         * Changement venu du distant : personne ne l'a demandé ici, donc
         * l'écran le signale — c'est la seule façon de comprendre qu'un flux
         * vient d'apparaître ou de disparaître.
         */
        "sip:mediaChanged": (ev, ctx, fx) => {
          const before = fx.data.media;
          fx.data.media = ev.media;
          fx.data.asked = ev.media;
          // le texte qui se déclare négocié n'est pas un changement à
          // annoncer : c'est la fin d'une négociation commencée avec l'appel
          // (ADR 0003, D1) — seuls l'audio et la vidéo apparaissent ou
          // disparaissent sous les yeux du correspondant
          const moved = changed(before, ev.media);
          if (moved.length === 0) {
            publish("connected", ctx, fx.data);
            return stay("média inchangé");
          }
          // deux médias changent rarement d'un coup, et quand cela arrive,
          // c'est le plus visible qui se dit — annoncer deux fois
          // n'apporterait qu'un message chassant l'autre
          const kind = moved.includes("video") ? "video" : moved[0]!;
          notify(
            ctx,
            fx,
            msg(NOTICE[kind][ev.media[kind] ? "added" : "removed"], { peer: peerName(fx.data) }),
          );
          return stay(`${kind} ${ev.media[kind] ? "ajouté" : "retiré"} par le distant`);
        },
        /**
         * Le distant propose d'ajouter un média, un **écran partagé**, ou
         * les deux — une seule question, et l'acceptation vaut pour tout ce
         * qu'elle porte (ADR 0005, D5).
         */
        "sip:mediaOffer": (ev, _ctx, fx) => {
          fx.data.mediaOffer = ev.offer;
          fx.data.offerAdds = MEDIA_KINDS.filter((k) => ev.media[k] && !fx.data.media[k]);
          fx.data.offerShare = ev.share;
          // un seul motif, littéral : c'est lui qui se lit dans le diagramme
          // généré, et deux phrases y feraient deux flèches pour une seule
          // question (docs/DIAGRAMS.md)
          return goto("media_offer", "le distant propose un média ou son écran");
        },
        /**
         * **Le partage d'écran** (ADR 0005). Il emprunte le chemin des
         * commandes média — capteur, re-INVITE, attente — sans être l'une
         * d'elles : il ne change pas ce que l'appel transporte, et
         * `isLastMedia` ne le compte donc pas.
         *
         * Le démarrage a un temps d'attente (`starting`) parce qu'un écran
         * ne s'affiche chez le correspondant qu'une fois la négociation
         * conclue. L'arrêt n'en a pas : la piste meurt sur-le-champ, plus
         * rien ne part, et le re-INVITE ne fait que le dire — annoncer
         * « arrêt en cours » promettrait un écran encore visible.
         */
        "ui:toggleShare": (_ev, _ctx, fx) => {
          if (fx.data.sharing === "on") {
            fx.data.sharing = "off";
            fx.data.session?.stopShare();
            return goto("renegotiating", "fin du partage");
          }
          fx.data.sharing = "starting";
          fx.data.session?.startShare();
          return goto("renegotiating", "partage d'écran");
        },
        /**
         * **« Cesser de partager »**, appuyé dans la barre du navigateur.
         * La piste est déjà morte : il ne reste qu'à le dire au distant,
         * qui garderait sinon une m-section vivante sur une image gelée. Le
         * re-INVITE part d'ici, comme tous les autres — le port n'en émet
         * jamais de sa propre initiative.
         */
        "sip:shareEnded": (_ev, _ctx, fx) => {
          if (fx.data.sharing === "off") return undefined;
          fx.data.sharing = "off";
          fx.data.session?.stopShare();
          return goto("renegotiating", "partage arrêté par le navigateur");
        },
      },
      meta: { callState: "connected" },
    },

    /**
     * Notre re-INVITE est parti : l'appel continue exactement comme avant,
     * seules les icônes média attendent. **Un seul verrou pour les deux**
     * (ADR 0003, D5) : deux offres en vol sur la même boîte de dialogue,
     * c'est un 491 garanti.
     *
     * L'issue est l'un des trois événements du port — le média a changé, le
     * distant a dit non, ou personne ne répond et le délai tranche. Le délai
     * est généreux parce qu'un 491 peut coûter jusqu'à 4 s de reprise
     * (RFC 3261 §14.1), et que cette reprise a droit d'aboutir.
     */
    renegotiating: {
      enter(ctx, fx) {
        fx.data.mediaPending = true;
        publish("connected", ctx, fx.data);
      },
      on: {
        ...inCall(),
        // une renégociation à la fois, quel que soit le média : le second
        // clic est sans effet — sur l'autre bouton comme sur le même, et le
        // partage n'y fait pas exception (ADR 0005, D3)
        "ui:toggleMedia": () => undefined,
        "ui:toggleShare": () => undefined,
        /**
         * Le partage vient d'être négocié. C'est un événement à lui, et non
         * un `sip:mediaChanged` : ce que l'appel transporte n'a pas bougé.
         */
        "sip:sharing": (ev, ctx, fx) => {
          fx.data.sharing = ev.on ? "on" : "off";
          fx.data.mediaPending = false;
          publish("connected", ctx, fx.data);
          return goto("connected", ev.on ? "partage établi" : "partage retiré");
        },
        /**
         * L'écran a été coupé depuis la barre du navigateur pendant que la
         * négociation était en vol. Rien de plus à lancer — l'offre en
         * cours conclura —, mais l'écran doit cesser de dire que je partage.
         */
        "sip:shareEnded": (_ev, ctx, fx) => {
          if (fx.data.sharing === "off") return undefined;
          fx.data.sharing = "off";
          publish("connected", ctx, fx.data);
          return stay("partage arrêté par le navigateur");
        },
        "sip:mediaChanged": (ev, ctx, fx) => {
          // ce que nous avions demandé et que le distant n'a pas suivi :
          // c'est la différence entre `asked` et ce qui a été négocié
          const refused = MEDIA_KINDS.filter((k) => fx.data.asked[k] && !ev.media[k]);
          fx.data.media = ev.media;
          fx.data.mediaPending = false;
          const kind = refused[0];
          if (kind !== undefined) {
            notify(ctx, fx, msg(NOTICE[kind].refused, { peer: peerName(fx.data) }));
            return goto("connected", `${kind} refusé`);
          }
          publish("connected", ctx, fx.data);
          return goto("connected", "média négocié");
        },
        "sip:mediaRefused": (ev, ctx, fx) => {
          // le partage a sa propre phrase : rien de ce que l'appel
          // transporte n'a bougé, et parler de « la vidéo » ici ferait
          // croire à la caméra qui vient de s'éteindre (ADR 0005, D3)
          if (ev.share === true) {
            fx.data.sharing = "off";
            fx.data.mediaPending = false;
            notify(
              ctx,
              fx,
              ev.by === "remote"
                ? msg("notice.shareRefused", { peer: peerName(fx.data) })
                : msg("notice.shareUnavailable"),
            );
            return goto("connected", "partage refusé");
          }
          // ce que nous demandions, avant de revenir à ce que l'appel porte
          const kind = changed(fx.data.asked, fx.data.media)[0] ?? "video";
          fx.data.asked = fx.data.media;
          fx.data.mediaPending = false;
          // le distant a dit non, ou la demande n'a jamais pu partir d'ici
          // (capteur pris ailleurs) : ce n'est pas la même phrase
          notify(
            ctx,
            fx,
            ev.by === "remote"
              ? msg(NOTICE[kind].refused, { peer: peerName(fx.data) })
              : msg(NOTICE[kind].unavailable),
          );
          return goto("connected", "refus");
        },
        // les deux offres se croisent (RFC 3261 §14.1) : la nôtre est déjà
        // partie, celle du distant attendra son tour
        "sip:mediaOffer": (ev) => {
          ev.offer.reject();
        },
      },
      after: {
        /**
         * Le délai **côté utilisateur** : le distant n'a jamais conclu,
         * l'appel continue, et les icônes média cessent d'attendre. Il
         * couvre la reprise après 491, qui peut demander jusqu'à 4 s avant
         * même de repartir.
         *
         * Il tombe **avant** celui de la transaction SIP (Timer B, 32 s,
         * RFC 3261 §17.1.1.2), qui est ce qui conclut réellement l'offre
         * dans `sip/port.ts` : l'écran rend la main pendant que le port
         * finit de renoncer, et non l'inverse — un `mediaPending` qui
         * survivrait à la fin de la négociation ne se débloquerait plus.
         */
        delay: 28_000,
        then: (ctx, fx) => {
          const sharing = fx.data.sharing === "starting";
          const kind = changed(fx.data.asked, fx.data.media)[0] ?? "video";
          // ce délai-ci est le seul à trancher : le port n'en a pas, et
          // ceux de JsSIP ne couvrent pas le distant qui accuse réception
          // puis se tait. Sans ce mot-là, l'offre resterait en vol —
          // capteur allumé, et plus rien de négociable de tout l'appel
          fx.data.session?.abandonMedia();
          fx.data.asked = fx.data.media;
          fx.data.sharing = sharing ? "off" : fx.data.sharing;
          fx.data.mediaPending = false;
          notify(ctx, fx, msg(sharing ? "notice.shareUnavailable" : NOTICE[kind].unavailable));
          return goto("connected", "sans réponse");
        },
      },
      meta: { callState: "connected" },
    },

    /**
     * Le distant veut ajouter un média. Accepter allumerait un capteur —
     * micro ou caméra, la question est la même (ADR 0003, D5) : cela ne se
     * décide pas sans l'utilisateur, et le re-INVITE reste sans réponse
     * finale tant qu'il n'a pas tranché — l'appelant patiente sur le
     * 100 Trying déjà envoyé (docs/CONCEPTION.md §4.4).
     */
    media_offer: {
      enter(ctx, fx) {
        publish("connected", ctx, fx.data);
      },
      on: {
        ...inCall(),
        "ui:acceptMedia": (_ev, _ctx, fx) => {
          const offer = fx.data.mediaOffer;
          const adds = fx.data.offerAdds;
          fx.data.mediaOffer = null;
          fx.data.asked = { ...fx.data.media };
          for (const kind of adds) fx.data.asked[kind] = true;
          offer?.accept();
          // **un écran seul n'ajoute aucun média** : il n'y a pas de
          // `sip:mediaChanged` à attendre, et rien à verrouiller — la scène
          // s'ouvrira sur `sip:peerSharing`, une fois la réponse écrite
          if (adds.length === 0) return goto("connected", "écran accepté");
          return goto("renegotiating", `accepté : ${adds.join(", ")}`);
        },
        "ui:rejectMedia": (_ev, ctx, fx) => {
          const offer = fx.data.mediaOffer;
          const said = declinedHere(fx.data);
          fx.data.mediaOffer = null;
          offer?.reject();
          notify(ctx, fx, said);
          return goto("connected", "488");
        },
        // les icônes média ne répondent pas à la question posée : c'est la
        // popup qui le fait — et le partage non plus, un seul verrou (D5)
        "ui:toggleMedia": () => undefined,
        "ui:toggleShare": () => undefined,
        // raccrocher pendant la question : le re-INVITE mérite sa réponse
        // avant le BYE, sinon l'appelant reste sur une offre en suspens
        "ui:hangup": (_ev, _ctx, fx) => {
          const offer = fx.data.mediaOffer;
          fx.data.mediaOffer = null;
          offer?.reject();
          return hangUp(fx, "answered", msg("reason.hungUp"), "BYE");
        },
        "sip:mediaOffer": (ev) => {
          ev.offer.reject();
        },
        // le distant a renoncé de lui-même (nouvelle négociation) : la
        // question n'a plus d'objet
        "sip:mediaChanged": (ev, ctx, fx) => {
          fx.data.media = ev.media;
          fx.data.mediaOffer = null;
          publish("connected", ctx, fx.data);
          return goto("connected", "offre caduque");
        },
      },
      after: {
        // sans réponse, on ne fait pas patienter l'appelant indéfiniment
        delay: 25_000,
        then: (ctx, fx) => {
          const offer = fx.data.mediaOffer;
          const said = declinedHere(fx.data);
          fx.data.mediaOffer = null;
          offer?.reject();
          notify(ctx, fx, said);
          return goto("connected", "sans réponse");
        },
      },
      meta: { callState: "connected" },
    },

    /**
     * CANCEL/BYE parti : on attend la confirmation JsSIP avant de sortir.
     * L'issue a été décidée au moment où l'on a raccroché (`endingAs`) —
     * c'est nous qui avons mis fin à l'appel, quoi que dise l'originator.
     */
    hangingup: {
      enter(ctx, fx) {
        if (fx.data.endingAs !== "dropped") fx.data.endedBy = "local";
        else fx.data.endedBy = "network";
        publish("hangingup", ctx, fx.data);
      },
      on: {
        "sip:ended": (_ev, _ctx, fx) => report(fx),
        "sip:failed": (_ev, _ctx, fx) => report(fx),
        "sip:progress": () => undefined,
        "sip:accepted": () => undefined,
        "sip:confirmed": () => undefined,
        // le transport est mort : aucune confirmation n'arrivera
        "sip:disconnected": (_ev, ctx, fx) => {
          ctx.lastError = msg("error.proxyLostDuringCall");
          ctx.lastErrorCode = "WSS_LOST";
          ctx.suspectFields = "proxy";
          fx.data.endingAs = "dropped";
          fx.data.endReason = msg("error.proxyLostDuringCall");
          report(fx);
        },
        // on raccroche déjà : la veille n'a plus qu'à être notée
        "sys:sleep": (_ev, ctx) => {
          ctx.sleepRequested = true;
          return undefined;
        },
        "sip:incoming": (ev) => {
          ev.call.reject("busy");
        },
        // le média n'a plus d'intérêt : l'appel se referme. Une offre en
        // vol, elle, mérite encore sa réponse — sans quoi l'appelant
        // attendrait un 200 OK que ce dialogue ne donnera jamais
        "sip:mediaChanged": () => undefined,
        "sip:mediaRefused": () => undefined,
        "sip:sharing": () => undefined,
        "sip:shareEnded": () => undefined,
        "sip:peerSharing": () => undefined,
        "sip:mediaOffer": (ev) => {
          ev.offer.reject();
        },
        "ui:toggleMedia": () => undefined,
        "ui:toggleShare": () => undefined,
        "ui:acceptMedia": () => undefined,
        "ui:rejectMedia": () => undefined,
        "ui:togglePause": () => undefined,
        "sip:peerPaused": () => undefined,
        "ui:dtmf": () => undefined,
        "sip:registrationFailed": () => undefined,
        "sip:registered": () => undefined,
        "sip:connected": () => undefined,
        "sys:wake": () => undefined,
        "ui:hangup": () => undefined,
        "ui:backToSettings": () => undefined,
        "ui:logout": () => undefined,
        "ui:switchAccount": () => undefined,
        "ui:call": () => undefined,
        "ui:clearHistory": () => undefined,
      },
      after: {
        delay: 2000,
        then: (_ctx, fx) => report(fx),
      },
      meta: { callState: "hangingup" },
    },
  },
});
