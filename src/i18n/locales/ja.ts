/**
 * Dictionnaire japonais (日本語).
 *
 * Commentaires en français, comme le reste du dépôt : ils s'adressent à qui
 * maintient cette traduction en regard du français de référence, pas à qui
 * la lit à l'écran.
 *
 * Ce n'est pas un décalque du français. Quatre écarts assumés :
 *
 * - **Les libellés de bouton sont des noms verbaux ou des formes en
 *   « ～する »** — « 通話を切る », « 設定を修正する » —, jamais un impératif :
 *   l'impératif japonais sonne comme un ordre donné à l'utilisateur.
 * - **La ponctuation est celle du japonais** : 、 et 。, les guillemets
 *   「 」 là où le français met « », et les parenthèses pleine chasse （ ）.
 *   Un deux-points français devient un 「：」 pleine chasse.
 * - **Le japonais ignore la majuscule.** Le « kicker » de l'appel entrant,
 *   capitalisé en français par le CSS (`text-transform`), ne peut compter
 *   que sur son corps et son interlettrage ; le texte, lui, se suffit
 *   d'être court et sans ambiguïté.
 * - **Une espace fine sépare le latin du japonais** — « SIP アドレス »,
 *   « {n} 分 » — : c'est l'usage typographique, et le rendu en souffre sans.
 *
 * Le japonais **ne décline pas le pluriel** : `Intl.PluralRules` ne lui
 * rend que la forme `other`. Les clés `.one` restent pourtant obligatoires
 * — le type les tient du français (voir `Translation` dans `../types.ts`) —
 * et portent ici le même texte que `.other`, qui seul sera choisi.
 *
 * Restent en clair, comme partout : « Trix », « Powered by FSL », les codes
 * techniques (SIP 486, WSS_LOST), les protocoles (SIP, TURN, STUN, WSS) et
 * les causes brutes de JsSIP — un code d'erreur traduit n'est plus
 * cherchable.
 */

import type { Translation } from "../types.js";

const messages: Translation = {
  // ---------------------------------------------------------------------
  // Choix de la langue
  // ---------------------------------------------------------------------
  "lang.label": "表示言語",
  "lang.auto": "自動（ブラウザーの言語）",
  "lang.autoDetected": "自動 — {name}",
  "lang.hint": "「自動」はブラウザーの言語に従います。",

  // ---------------------------------------------------------------------
  // Titres d'onglet des écrans sans état de téléphone
  // ---------------------------------------------------------------------
  "screen.settings": "設定",
  "screen.saving": "保存中…",

  // ---------------------------------------------------------------------
  // Écran d'accueil
  // ---------------------------------------------------------------------
  "home.tagline": "トータルコンバセーション対応のウェブフォン",
  "home.useAccount": "このアカウントを使う",
  "home.newAccount": "新しいアカウントを設定する",
  "home.version": "バージョン {version}",
  "fsl.aria": "Powered by FSL — GitHub の finite-state-language（新しいウィンドウ）",

  // ---------------------------------------------------------------------
  // Écran de configuration
  // ---------------------------------------------------------------------
  "config.title": "設定",
  "config.section.account": "SIP アカウント",
  "config.proxy": "SIP サーバー",
  "config.proxyPlaceholder": "wss://sip.example.jp:8443/ws",
  "config.uri": "SIP アドレス",
  "config.uriPlaceholder": "sip:alice@example.jp",
  "config.uriHint":
    "「sip:」は付けても付けなくてもかまいません。ドメインは認証のレルムを兼ねます。",
  "config.displayName": "お名前",
  "config.authToggle": "認証ユーザー名（{user} と異なる場合）",
  "config.authUserDefault": "アドレスのユーザー部分",
  "config.password": "パスワード",
  "config.passwordSet": "••••••（設定済み）",
  "config.passwordKeep": "現在のパスワードを保つには、空のままにしてください。",
  "config.ha1Note":
    "パスワードそのものは保存されません。暗号化されたダイジェスト（HA1）だけが、このブラウザーに残ります。",

  "config.section.nat": "NAT 越え",
  "config.natHint":
    "SIP 事業者から提供されるサーバーです。これがないと、プライベートネットワーク同士の通話は、つながっても音声が届かないことがあります。",
  "config.stun": "STUN サーバー",
  "config.stunPlaceholder": "stun.example.jp:3478",
  "config.stunHint":
    "任意。ホストのみ、またはホスト:ポート — ポートを省くと 3478 が使われます。",
  "config.turn": "TURN サーバー",
  "config.turnPlaceholder": "turn.example.jp:3478",
  "config.turnHint":
    "任意 — 直接接続できないときにメディアを中継します。使わない場合は空のままにしてください。",
  "config.turnUser": "TURN ユーザー名",
  "config.turnPass": "TURN パスワード",
  "config.turnPassKeep": "現在のパスワードを保つには、空のままにしてください。",
  "config.turnTlsLabel": "TLS 上の TURN",
  "config.turnTlsDesc":
    " — 暗号化された中継（「turns:」）。TLS の通信しか許されない場所でも通ります",
  "config.turnTlsHint": "ポートを指定しない場合は、3478 ではなく 5349 が使われます。",
  "config.turnNote":
    "TURN のパスワードは、これだけは（暗号化して）保存されます。中継は通話のたびに秘密そのものを求めるため、ダイジェストでは足りません。",

  "config.section.alerts": "通知と表示",
  "config.alertsHint":
    "これらの設定は、登録を待たずにすぐ反映されます。ただしフラッシュはアカウントに従います。",
  "config.flashLabel": "着信時に画面をフラッシュ",
  "config.flashDesc": " — 呼び出し中に画面が点滅し、音を消していても着信に気づけます",
  "config.flashHint": "アカウントとともに保存され、端末を変えても引き継がれます。",
  "config.notifications": "システム通知",
  "config.notifEnable": "通知を有効にする",
  "config.notifHint":
    "通知がないと、ウィンドウが隠れているときや最小化されているとき、Trix はお知らせできません。",
  "config.notifOn": "通知は有効です",
  "config.notifBlocked": "ブラウザーが通知をブロックしています",
  "config.notifBlockedHint":
    "ブラウザーのサイト設定で許可し直してください。Trix から改めて許可を求めることはできません。",
  "config.theme": "テーマ",
  "config.themeHint": "「システム」は端末のライト／ダークの設定に従います。",
  "theme.system": "システム",
  "theme.light": "ライト",
  "theme.dark": "ダーク",

  // Diagnostic — réglages locaux, jamais enregistrés avec le compte
  "config.section.diag": "診断",
  "config.traceLabel": "SIP のやり取りをトレースする",
  "config.traceDesc":
    " — 送受信したすべてのパケットと、通話がたどる状態が、ブラウザーのコンソールに表示されます",
  "config.traceHint":
    "通話中でもすぐに反映されます。コンソール（F12）を開くとパケットを読めます。各通話は自分のトレースも履歴とともに暗号化して保持し、消すまで残ります。トレースにはご自身と相手の SIP アドレスが含まれます — 公開するバグ報告からは取り除いてください。",
  "config.save": "保存して接続する",
  "config.saving": "保存中…",
  "config.cancel": "キャンセル",

  // ---------------------------------------------------------------------
  // État du téléphone (pastille de la barre d'en-tête, titre d'onglet)
  // ---------------------------------------------------------------------
  "status.connecting": "接続中…",
  "status.registering": "登録中…",
  "status.ready": "登録済み",
  "status.reconnecting": "再接続中…",
  "status.sleeping": "スリープ中",
  "status.regFailed": "登録に失敗しました",
  "status.unregistering": "切断中…",

  // ---------------------------------------------------------------------
  // État de l'appel
  // ---------------------------------------------------------------------
  "call.dialing": "発信中",
  "call.ringing": "呼び出し中",
  "call.ringingIn": "着信",
  "call.answering": "接続中…",
  "call.connected": "通話中",
  "call.hangingup": "通話終了中",

  // ---------------------------------------------------------------------
  // Écran d'appel
  // ---------------------------------------------------------------------
  "call.targetLabel": "SIP アドレス",
  "call.callerLabel": "発信者",
  "call.domainHint": "「@」がなければ &lt;アドレス&gt;@{domain} にかけます",
  "call.idle": "通話はありません — SIP アドレスを入力してください",
  "call.sleeping": "スリープ中 — 端末の復帰時に登録を再開します",
  "call.sleepingShort": "スリープ中 — 復帰時に再開",
  "call.retryIn": "10 秒後に再接続します…",
  "call.chooseMode": "通話の種類を選ぶ",
  "mode.audio.label": "音声通話",
  "mode.audio.button": "音声で発信する",
  "mode.video.label": "ビデオ通話",
  "mode.video.button": "ビデオで発信する",
  "chat.strip": "チャット — フェーズ 4 で提供",

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------
  "action.settings": "設定",
  "action.logout": "サインアウト",
  "action.retry": "再試行",
  "action.retryNow": "今すぐ再試行",
  "action.fixSettings": "設定を修正する",
  "action.unavailableInCall": "（通話中は使えません）",

  // ---------------------------------------------------------------------
  // Commandes média (barre de surimpression)
  // ---------------------------------------------------------------------
  "ctrl.mic.aria": "マイク",
  "ctrl.mic.mute": "マイクをミュートする",
  "ctrl.mic.unmute": "マイクのミュートを解除する",
  "ctrl.cam.aria": "カメラ",
  "ctrl.cam.add": "ビデオを追加",
  "ctrl.cam.remove": "ビデオを削除",
  "ctrl.cam.pending": "メディアを変更中…",
  "ctrl.selfview.aria": "セルフビュー",
  "ctrl.selfview.hide": "セルフビューを隠す",
  "ctrl.selfview.show": "セルフビューを表示する",
  "ctrl.speaker.aria": "スピーカー",
  "ctrl.speaker.mute": "音声をミュートする",
  "ctrl.speaker.unmute": "音声のミュートを解除する",
  "ctrl.dtmf.aria": "DTMF キーパッド",
  "ctrl.dtmf.label": "DTMF キーパッド — フェーズ 4 で提供",
  "ctrl.fullscreen": "全画面表示",
  "ctrl.hangup": "通話を切る",

  // ---------------------------------------------------------------------
  // 通話中のビデオ追加要求
  // ---------------------------------------------------------------------
  "videoask.title": "{peer} がビデオの追加を求めています",
  "videoask.body": "承諾するとカメラがオンになります。",
  "videoask.accept": "ビデオを承諾する",
  "videoask.reject": "拒否する",

  // ---------------------------------------------------------------------
  // 通話中の一時的なメッセージ
  // ---------------------------------------------------------------------
  "notice.videoDeclined": "{peer} はビデオを受け入れませんでした",
  "notice.videoRefused": "{peer} はこの通話へのビデオ追加を拒否しました",
  "notice.videoAdded": "{peer} がビデオを追加しました",
  "notice.videoRemoved": "{peer} がビデオを削除しました",
  "notice.videoDeclinedHere": "ビデオを拒否しました",
  "notice.videoUnavailable": "現在ビデオを追加できません",

  // ---------------------------------------------------------------------
  // Panneau latéral
  // ---------------------------------------------------------------------
  "panel.aria": "サイドパネル",
  "panel.showChat": "チャットを表示する",
  "panel.hide": "サイドパネルを隠す",
  "panel.handleAria": "パネルの幅",
  "panel.handleTitle": "ドラッグしてパネルを広げます — 画面幅の 33 % まで",

  // ---------------------------------------------------------------------
  // Préférences d'affichage en cours d'appel
  // ---------------------------------------------------------------------
  "prefs.fontSize": "文字の大きさ",
  "prefs.fontDown": "文字を小さくする",
  "prefs.fontUp": "文字を大きくする",

  // ---------------------------------------------------------------------
  // Appel entrant (popup modale)
  // ---------------------------------------------------------------------
  "incoming.kicker.video": "ビデオ通話の着信",
  "incoming.kicker.audio": "音声通話の着信",
  "incoming.answerVideo": "ビデオで応答する",
  "incoming.answerAudio": "音声で応答する",
  "incoming.reject": "拒否する",

  // ---------------------------------------------------------------------
  // Alerte d'appel entrant (titre d'onglet, notification système)
  // ---------------------------------------------------------------------
  "alert.title": "📞 着信 — {caller}",
  "alert.notifTitle": "着信",
  "alert.notifVideo": "{caller} — ビデオ通話",
  "alert.notifAudio": "{caller} — 音声通話",

  // ---------------------------------------------------------------------
  // Annonces aux lecteurs d'écran
  // ---------------------------------------------------------------------
  // Le japonais n'a qu'une forme : `.one` ne sera jamais choisie.
  "announce.inCall.one": "通話中、{n} 分経過",
  "announce.inCall.other": "通話中、{n} 分経過",

  // ---------------------------------------------------------------------
  // Historique d'appels
  // ---------------------------------------------------------------------
  "history.title": "履歴",
  "history.clear": "消去",
  "history.empty": "通話履歴はありません",
  "history.entryTitle": "{target} — {outcome}",

  // Carnet d'un appel : les paquets SIP gardés quand la trace était active
  "trace.open": "この通話の SIP トレースを見る",
  "trace.title": "SIP トレース — {target}",
  "trace.count.one": "{n} パケット",
  "trace.count.other": "{n} パケット",
  "trace.sent": "送信",
  "trace.received": "受信",
  "trace.copy": "コピー",
  "trace.copied": "コピーしました",
  "trace.copyFailed": "コピーできませんでした",
  "trace.close": "閉じる",
  "trace.clipped": "…（パケットを切り詰めました）",
  "trace.truncated": "トレースを打ち切りました。通話が 1 件あたりの保持量を超えました。",
  "outcome.answered": "応答",
  "outcome.missed": "不在着信",
  "outcome.failed": "失敗",
  "outcome.canceled": "取り消し",
  "outcome.dropped": "切断",
  "endedBy.local": "自分が切りました",
  "endedBy.remote": "相手が切りました",
  "endedBy.network": "ネットワークが切断しました",
  "duration.minSec": "{m} 分 {s} 秒",
  "duration.sec": "{s} 秒",

  // ---------------------------------------------------------------------
  // Statistiques média (survol de la pastille « 通話中 »)
  // ---------------------------------------------------------------------
  "stats.hint": "この通話のメディア統計",
  "stats.title": "メディア統計",
  "stats.window": "直近 {s} 秒の平均",
  "stats.recv": "受信",
  "stats.sent": "送信",
  "stats.audio": "音声",
  "stats.video": "映像",
  "stats.codec": "コーデック",
  "stats.bitrate": "ビットレート",
  "stats.loss": "パケット損失",
  "stats.rtt": "往復遅延",
  "stats.lossNote": "送信側の損失は、相手の受信レポートが伝える値です。",
  "stats.pending": "測定中…",
  "stats.none": "測定できたメディアストリームはありません",
  "stats.kbps": "{n} kbit/s",
  "stats.percent": "{n} %",
  "stats.ms": "{n} ms",
  "stats.khz": "{n} kHz",
  "stats.spanCall": "{d} の測定平均",
  "stats.open": "この通話のメディア統計",
  "stats.callTitle": "メディア統計 — {target}",
  "stats.close": "閉じる",
  "stats.copy": "コピー",
  "stats.copied": "コピーしました",
  "stats.copyFailed": "コピーできませんでした",

  // ---------------------------------------------------------------------
  // Erreurs des automates (écrites dans le contexte, rendues par l'UI)
  // ---------------------------------------------------------------------
  "error.invalidUri": "SIP アドレスが不正です（形式：ユーザー@ドメイン）",
  "error.passwordRequired": "パスワードを入力してください",
  "error.saveFailed": "保存できませんでした：{detail}",
  "error.invalidProxy": "プロキシー名が不正です — WSS アドレスを確認してください",
  "error.wssRefused": "プロキシーに接続できません（WSS 接続が拒否されました）",
  "error.wssTimeout": "プロキシーが応答しません（WebSocket タイムアウト）",
  "error.badCredentials": "SIP アドレス、パスワード、または認証ユーザー名が正しくありません",
  "error.regRefused": "登録が拒否されました：{cause}",
  "error.wssLostDuringReg": "登録中に接続が切れました",
  "error.registrarTimeout": "レジストラーが応答しません",
  "error.regLost": "登録が失われました：{cause}",
  "error.proxyLost": "プロキシーとの接続が切れました",
  "error.proxyLostDuringCall": "通話中にプロキシーとの接続が切れました",
  "error.callDropped": "通話が切断されました — プロキシーとの接続が切れました",
  "error.stunInvalid": "STUN サーバーが不正です（形式：ホスト または ホスト:ポート）",
  "error.turnInvalid": "TURN サーバーが不正です（形式：ホスト または ホスト:ポート）",
  "error.turnUserRequired": "TURN ユーザー名を入力してください（中継は必ず認証を求めます）",
  "error.turnPasswordRequired": "TURN パスワードを入力してください",

  // ---------------------------------------------------------------------
  // Motifs de fin d'appel (affichés près du champ d'adresse et en historique)
  // ---------------------------------------------------------------------
  "reason.hungUp": "通話終了",
  "reason.sleep": "スリープへの移行",
  "reason.noAnswer": "応答なし",
  "reason.declined": "通話が拒否されました",
  "reason.missed": "不在着信",
  "reason.missedNoAnswer": "不在着信（応答なし）",
  "reason.setupFailed": "通話を確立できませんでした",
  "reason.callFailed": "発信できませんでした：{detail}",
  "reason.sip": "{cause}（SIP {code}）",

  "misc.raw": "{text}",
};

export default messages;
