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
  "screen.deleting": "削除中…",

  // ---------------------------------------------------------------------
  // Écran d'accueil
  // ---------------------------------------------------------------------
  "home.tagline": "トータルコンバセーション対応のウェブフォン",
  "home.useAccount": "このアカウントを使う",
  "home.newAccount": "新しいアカウントを設定する",
  "home.addAccount": "アカウントを追加する",
  "home.editAccount": "編集",
  "home.version": "バージョン {version}",
  "fsl.aria": "Powered by FSL — GitHub の finite-state-language（新しいウィンドウ）",

  // ---------------------------------------------------------------------
  // Écran de configuration
  // ---------------------------------------------------------------------
  "config.title": "設定",
  "config.titleNew": "新しいアカウント",
  "config.section.account": "SIP アカウント",
  "config.proxy": "SIP サーバー",
  "config.proxyPlaceholder": "wss://sip.example.jp:8443/ws",
  "config.uri": "SIP アドレス",
  "config.uriPlaceholder": "sip:alice@example.jp",
  "config.uriHint":
    "「sip:」は付けても付けなくてもかまいません。ドメインは認証のレルムを兼ねます。",
  "config.uriHintDomain":
    "ここでは {domain} ドメインのアドレスだけを受け付けます。このドメインは認証のレルムを兼ねます。",
  "config.displayName": "お名前",
  "config.authToggle": "認証ユーザー名（{user} と異なる場合）",
  "config.authUserDefault": "アドレスのユーザー部分",
  "config.password": "パスワード",
  "config.passwordSet": "••••••（設定済み）",
  "config.passwordKeep": "現在のパスワードを保つには、空のままにしてください。",
  "config.share": "アカウントの共有",
  "config.shareCopy": "共有リンクをコピー",
  "config.shareWarn":
    "このリンクを使って、アカウントを別の端末に移行できます。",
  "config.shareCopied": "共有リンクをコピーしました",
  "config.shareManual": "共有リンク（コピー用）",

  "config.advanced": "詳細設定",
  "config.section.nat": "NAT 越え",
  "config.natHint":
    "NAT 経由でインターネットに接続したプライベートネットワークから発信するときに、通話を確立できるようにするサーバーです。",
  "config.stun": "STUN サーバー",
  "config.stunPlaceholder": "stun.example.jp:3478",
  "config.stunHint":
    "任意。ホストのみ、またはホスト:ポート — ポートを省くと 3478 が使われます。",
  "config.turn": "TURN サーバー",
  "config.turnPlaceholder": "turn.example.jp:3478",
  "config.turnHint":
    "直接接続できないときにメディアを中継します。使わない場合は空のままにしてください。",
  "config.turnUser": "TURN ユーザー名",
  "config.turnPass": "TURN パスワード",
  "config.turnPassKeep": "現在のパスワードを保つには、空のままにしてください。",
  "config.turnTlsLabel": "TLS 上の TURN",
  "config.turnTlsDesc":
    " — 暗号化された中継（「turns:」）。TLS の通信しか許されない場所でも通ります",
  "config.turnTlsHint": "ポートを指定しない場合は、3478 ではなく 5349 が使われます。",

  "config.section.rtt": "リアルタイム文字",
  "config.rttHint": "文字は通話中に一文字ずつ書かれ、読まれます。",
  "config.rttTransport": "転送方式",
  "config.rttNone": "なし",
  "config.rttNoneDesc": " — リアルタイムテキストは無効",
  "config.rttWs": "WebSocket 経由",
  "config.rttWsDesc": " — リアルタイムテキストを WebSocket でやり取りします（非標準）",
  "config.rttDc": "データチャネル経由",
  "config.rttDcDesc": " — RFC 8865 標準のリアルタイムテキスト",

  "config.section.alerts": "通知と表示",
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
  "config.delete": "このアカウントを削除する",
  "config.deleteConfirm": "確認：{address} と通話履歴を削除する",

  // ---------------------------------------------------------------------
  // État du téléphone (pastille de la barre d'en-tête, titre d'onglet)
  // ---------------------------------------------------------------------
  "status.connecting": "接続中…",
  "status.registering": "登録中…",
  "status.ready": "登録済み",
  "status.reconnecting": "再接続中…",
  "status.sleeping": "スリープ中",
  "status.sleepingSeen": "スリープ中 — 連絡先からはオフラインに見えます",
  "status.regFailed": "登録に失敗しました",
  "status.unregistering": "切断中…",
  "status.switching": "アカウントを切り替え中…",
  "presence.available": "連絡可能",
  "presence.busy": "取り込み中",
  "presence.onThePhone": "通話中",
  "presence.away": "退席中",
  "presence.dnd": "応答不可",
  "presence.offline": "オフライン",
  "presence.unknown": "在席状況不明",
  "presence.invisible": "非表示",
  "presenceMenu.label": "自分の状態",
  "presenceMenu.seen": "連絡先に表示される状態",
  "presenceMenu.busyHint": "着信は通常どおり届きます",
  "presenceMenu.dndHint": "着信は拒否され、履歴に記録されます",
  "presenceMenu.invisibleHint": "オフラインと表示されますが、着信は受けられます",
  "presenceMenu.note": "連絡先に表示するメモ",
  "presenceMenu.clearNote": "メモを消去",
  "presenceMenu.auto": "自動",
  "presenceMenu.onThePhone": "通話中は「通話中」にする",
  "presenceMenu.onThePhoneHint": "終話後は選んだ状態に戻ります",
  "presenceMenu.awayWhenIdle": "操作が10分ないと「退席中」にする",
  "presenceMenu.sleepHint": "スリープ中はページの登録が解除され、ここでの選択にかかわらず連絡先からはオフラインに見えます。",
  "presenceMenu.noPublish": "このサーバーはあなたの状態を配信しません。連絡先には表示されません。",
  "announce.statusChanged": "状態：{status}",
  "thread.title": "やり取り",
  "thread.subtitle": "連絡先と通話",
  "thread.search": "連絡先を検索",
  "thread.add": "連絡先を追加",
  "thread.group.today": "今日",
  "thread.group.yesterday": "昨日",
  "thread.group.week": "今週",
  "thread.group.older": "それ以前",
  "thread.group.none": "やり取りなし",
  "thread.notContact": "連絡先にありません",
  "thread.addToContacts": "連絡先に追加",
  "thread.stale": "{status}（{time} 時点）— 未更新",
  "thread.pending": "相手の承認待ち",
  "thread.call": "{name} に発信",
  "thread.noMatch": "この検索に一致するやり取りはありません。",
  "thread.firstContact": "連絡先を追加すると、発信前に相手が対応可能かわかります。",
  "thread.addLast": "{name} を追加",
  "thread.noPresence": "このサーバーは在席状況を中継しません。連絡先への発信は引き続き可能です。",
  "thread.noCalls": "この連絡先との通話はまだありません。",
  "thread.subtitleMessages": "連絡先・通話・メッセージ",
  "thread.segments": "表示",
  "thread.segment.all": "すべて",
  "thread.segment.calls": "通話",
  "thread.segment.messages": "メッセージ",
  "thread.noEvents": "この連絡先とのやり取りはまだありません。",
  "thread.noMessages": "メッセージはまだありません。",
  "thread.unread.one": "未読メッセージ {n} 件",
  "thread.unread.other": "未読メッセージ {n} 件",
  "thread.blocked": "ブロック中",
  "thread.block": "ブロック",
  "thread.unblock": "ブロック解除",
  "thread.noMessaging": "このサーバーはメッセージを転送しません。次の接続で書き込みが再開されます。",
  "message.you": "あなた：{text}",
  "message.from": "{name}：",
  "message.mine": "あなた：",
  "message.compose": "{name} へのメッセージ",
  "message.placeholder": "メッセージを入力…",
  "message.send": "送信",
  "message.count": "{n} / {max} バイト",
  "message.state.pending": "送信待ち",
  "message.state.sent": "サーバーに配信済み",
  "message.state.failed": "未配信：{reason}",
  "message.retry": "再試行",
  "message.offline": "オフライン：次の接続時にメッセージが送信されます。",
  "thread.form.name": "名前",
  "thread.form.address": "SIP アドレスまたは番号",
  "thread.form.save": "追加",
  "thread.form.cancel": "キャンセル",
  "thread.rename": "名前を変更",
  "thread.renameSave": "保存",
  "thread.remove": "連絡先から削除",
  "thread.yesterday": "昨日",
  "call.contactHint": "{name} · {status}",

  // ---------------------------------------------------------------------
  // 着信可能性（ADR 0006）
  // ---------------------------------------------------------------------
  "reach.none": "着信を受けられません。",
  "reach.title": "着信不可 — Trix",
  "reach.notifTitle": "Trix は着信を受けられません",
  "reach.notifFreeze":
    "ブラウザーがこのタブをスリープさせました。タブに戻るまで着信を受けられません。",
  "reach.notifSystem":
    "コンピューターがスリープしました。復帰するまで着信を受けられません。",
  "reach.notifOffline":
    "ネットワーク接続が切れました。回復するまで着信を受けられません。",
  "reach.notifDiscard":
    "ブラウザーがメモリーを空けるためにこのタブを破棄しました。Trix に戻ると再登録されます。",
  "reach.notifLost": "登録が失われました。回復するまで着信を受けられません。",
  "reach.backTitle": "Trix はふたたび着信を受けられます",
  "reach.back": "登録が再開しました。ふたたび着信を受けられます。",
  "reach.discarded":
    "ブラウザーがメモリー節約のため Trix をスリープさせました。{from} から {to} まで着信を受けられませんでした。",
  "reach.pinHint":
    "防ぐには、このタブをピン留めし、ブラウザーの「常にアクティブなサイト」に Trix を追加してください。",
  "reach.dismiss": "このメッセージを隠す",

  // ---------------------------------------------------------------------
  // État de l'appel
  // ---------------------------------------------------------------------
  "call.dialing": "発信中",
  "call.ringing": "呼び出し中",
  "call.earlyMedia": "ネットワークの音声案内",
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
  "mode.text.label": "テキスト通話",
  "mode.text.button": "テキストで発信する",
  "chat.strip": "チャットは通話とともに開きます",
  "chat.stripRefused": "相手がリアルタイムテキストを受け入れませんでした",
  // ---------------------------------------------------------------------
  // リアルタイムテキスト（T.140）のチャット
  // ---------------------------------------------------------------------
  "chat.tab": "チャット",
  "chat.aria": "{peer} との会話",
  "chat.you": "自分",
  "chat.typing": "入力中",
  "chat.announce": "{who}：{text}",
  "chat.jump.one": "最新へ — {n} 件",
  "chat.jump.other": "最新へ — {n} 件",
  "chat.composerAria": "リアルタイムテキストのメッセージ",
  "chat.placeholder": "入力すると、そのまま相手に届きます",
  "chat.placeholderClosed": "この通話ではテキストを使えません",
  "chat.placeholderEarly": "応答されるまでは読み取り専用です",
  "chat.enterHint": "Enter で吹き出しを確定",
  "chat.state.open": "入力しながら送信中",
  "chat.state.connecting": "リアルタイムテキストを開いています…",
  "chat.state.lost": "接続が切れました — 復旧中",
  "chat.state.closed": "リアルタイムテキストは終了しました",
  "chat.state.refused": "この相手はリアルタイムテキストに対応していません",
  "chat.state.pending": "{s} 秒後に修正を送信",
  "chat.note.opened": "リアルタイムテキストを開始しました",
  "chat.note.lost": "切断中にテキストが失われました",
  "chat.note.broken": "テキストの接続が切れました — 復旧中",
  "chat.note.closed": "リアルタイムテキストは終了しました",
  "chat.note.refused": "この相手はリアルタイムテキストに対応していません",
  "chat.note.alert": "注意喚起を受信しました",

  "chat.log.open": "この通話の会話を読み返す",
  "chat.log.title": "会話 — {target}",
  "chat.log.count.one": "{n} 件のメッセージ",
  "chat.log.count.other": "{n} 件のメッセージ",
  "chat.log.copy": "コピー",
  "chat.log.copied": "コピーしました",
  "chat.log.copyFailed": "コピーできませんでした",
  "chat.log.export": "書き出す",
  "chat.log.exportFailed": "書き出せませんでした",
  "chat.log.close": "閉じる",
  "chat.log.vttBase": "時刻は通話開始からの経過時間 — {at} の通話。",
  "chat.log.cut": "会話の冒頭は保存されていません",

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------
  "action.settings": "設定",
  "action.logout": "サインアウト",
  "action.retry": "再試行",
  "action.retryNow": "今すぐ再試行",
  "action.fixSettings": "設定を修正する",
  "action.unavailableInCall": "（通話中は使えません）",
  "action.switchAccount": "アカウント {address} に切り替える",

  // ---------------------------------------------------------------------
  // Commandes média (barre de surimpression)
  // ---------------------------------------------------------------------
  "ctrl.mic.aria": "音声",
  "ctrl.mic.add": "音声を追加",
  "ctrl.mic.remove": "音声を削除",
  "ctrl.cam.aria": "ビデオ",
  "ctrl.cam.add": "ビデオを追加",
  "ctrl.cam.remove": "ビデオを削除",
  "ctrl.share.aria": "画面共有",
  "ctrl.share.start": "画面を共有",
  "ctrl.share.stop": "共有を停止",
  "ctrl.share.busy": "相手がすでに画面を共有しています",
  "ctrl.media.pending": "メディアを変更しています…",
  "ctrl.media.last": "できません：通話に何も残らなくなります",
  "ctrl.selfview.aria": "セルフビュー",
  "ctrl.selfview.hide": "セルフビューを隠す",
  "ctrl.selfview.show": "セルフビューを表示する",
  "share.stageAria": "{peer}さんが共有している画面",
  "share.zoomGroup": "共有画面の拡大",
  "share.zoomIn": "共有画面を拡大",
  "share.zoomOut": "共有画面を縮小",
  "share.zoomReset": "元の大きさに戻す",
  "share.zoomLevel": "{n} %",
  "share.zoomHint": "ピンチで拡大、矢印キーで移動できます",
  "ctrl.swap.aria": "画面と映像を入れ替える",
  "ctrl.swap.screen": "共有画面を大きく表示",
  "ctrl.swap.face": "相手の映像を大きく表示",
  "ctrl.speaker.aria": "この端末での受話",
  "ctrl.speaker.mute": "受話を止める",
  "ctrl.speaker.unmute": "受話を再開する",
  "ctrl.dtmf.aria": "DTMF キーパッド",
  "ctrl.dtmf.show": "DTMF キーパッドを表示",
  "ctrl.dtmf.hide": "DTMF キーパッドを閉じる",
  "ctrl.chat.aria": "チャット",
  "ctrl.chat.show": "チャットを表示する",
  "ctrl.chat.hide": "チャットを閉じる",
  "ctrl.chat.unavailable": "相手がリアルタイムテキストを受け入れませんでした",
  "ctrl.fullscreen": "全画面表示",
  "ctrl.hangup": "通話を切る",
  "ctrl.pause": "一時停止",
  "ctrl.pause.aria": "一時停止",
  "ctrl.resume": "再開",
  "pause.banner": "一時停止中です",
  "pause.hint": "マイクと映像は停止しています。テキストはそのまま届きます。",
  "pause.resume": "再開",
  "pause.peer": "{peer} は一時停止中です",
  "ctrl.group.call": "通話のメディア",
  "ctrl.group.device": "この端末",
  "ctrl.more": "その他の操作",
  "sheet.title": "通話のその他の操作",

  // ---------------------------------------------------------------------
  // Clavier DTMF
  // ---------------------------------------------------------------------
  "dtmf.aria": "DTMF キーパッド",
  "dtmf.sent": "送信したトーン",
  "dtmf.hint": "キーまたはキーボードで入力してください",
  "dtmf.keyAria": "{key} キー",
  "dtmf.star": "アスタリスク",
  "dtmf.hash": "シャープ",

  // ---------------------------------------------------------------------
  // 通話中のビデオ追加要求
  // ---------------------------------------------------------------------
  "mediaask.video.title": "{peer} がビデオの追加を希望しています",
  "mediaask.video.body": "承諾するとカメラがオンになります。",
  "mediaask.video.accept": "ビデオを承諾",
  "mediaask.audio.title": "{peer} が音声の追加を希望しています",
  "mediaask.audio.body": "承諾するとマイクがオンになります。",
  "mediaask.audio.accept": "音声を承諾",
  "mediaask.both.title": "{peer} が音声とビデオの追加を希望しています",
  "mediaask.both.body": "承諾するとマイクとカメラがオンになります。",
  "mediaask.both.accept": "両方を承諾",
  "mediaask.share.title": "{peer}さんが画面を共有しようとしています",
  "mediaask.share.body": "共有画面が大きく表示され、相手の映像は小さな枠に移ります。拒否しても通話はそのまま続きます。",
  "mediaask.share.accept": "画面を見る",
  "mediaask.reject": "拒否",

  // ---------------------------------------------------------------------
  // 通話中の一時的なメッセージ
  // ---------------------------------------------------------------------
  "notice.videoDeclined": "{peer} はビデオを受け入れませんでした",
  "notice.videoRefused": "{peer} はこの通話へのビデオ追加を拒否しました",
  "notice.videoAdded": "{peer} がビデオを追加しました",
  "notice.videoRemoved": "{peer} がビデオを削除しました",
  "notice.videoDeclinedHere": "ビデオを拒否しました",
  "notice.videoUnavailable": "現在ビデオを追加できません",
  "notice.shareRefused": "{peer} は画面共有を受け入れませんでした",
  "notice.shareUnavailable": "現在画面を共有できません",
  "notice.sharePeerStarted": "{peer}さんが画面を共有しています",
  "notice.sharePeerStopped": "{peer}さんが画面共有を終了しました",
  "notice.shareDeclinedHere": "画面共有を拒否しました",
  "notice.audioDeclined": "{peer} は音声を受け入れませんでした",
  "notice.audioRefused": "{peer} はこの通話への音声の追加を拒否しています",
  "notice.audioAdded": "{peer} が音声を追加しました",
  "notice.audioRemoved": "{peer} が音声を削除しました",
  "notice.audioDeclinedHere": "音声を拒否しました",
  "notice.audioUnavailable": "現在、音声を追加できません",
  "notice.dtmfFailed": "トーン {tone} を送信できませんでした",

  // ---------------------------------------------------------------------
  // Panneau latéral
  // ---------------------------------------------------------------------
  "panel.aria": "サイドパネル",
  "panel.showChat": "チャットを表示する",
  "panel.show": "サイドパネルを表示する",
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
  "incoming.kicker.audioText": "音声＋テキスト通話の着信",
  "incoming.kicker.videoText": "ビデオ＋テキスト通話の着信",
  "incoming.kicker.text": "テキスト通話の着信",
  "incoming.answerVideo": "ビデオで応答する",
  "incoming.answerAudio": "音声で応答する",
  "incoming.answerText": "テキストで応答する",
  "incoming.reject": "拒否する",

  // ---------------------------------------------------------------------
  // Alerte d'appel entrant (titre d'onglet, notification système)
  // ---------------------------------------------------------------------
  "alert.title": "📞 着信 — {caller}",
  "alert.notifTitle": "着信",
  "alert.notifVideo": "{caller} — ビデオ通話",
  "alert.notifAudio": "{caller} — 音声通話",
  "alert.notifText": "{caller} — テキスト通話",

  // ---------------------------------------------------------------------
  // Annonces aux lecteurs d'écran
  // ---------------------------------------------------------------------
  // Le japonais n'a qu'une forme : `.one` ne sera jamais choisie.
  "announce.inCall.one": "通話中、{n} 分経過",
  "announce.inCall.other": "通話中、{n} 分経過",

  // ---------------------------------------------------------------------
  // Historique d'appels
  // ---------------------------------------------------------------------
  "history.clear": "消去",
  "history.entryTitle": "{target} — {outcome}",

  // Carnet d'un appel : les paquets SIP gardés quand la trace était active
  "trace.open": "この通話の SIP トレースを見る",
  "trace.title": "SIP トレース — {target}",
  "trace.count.one": "{n} パケット",
  "trace.count.other": "{n} パケット",
  "trace.sent": "送信",
  "trace.received": "受信",
  "trace.error": "WebRTC エラー",
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
  "outcome.declined": "拒否",
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
  "stats.share": "共有画面",
  "stats.text": "テキスト",
  "stats.missing": "欠落テキスト",
  "stats.codec": "コーデック",
  "stats.bitrate": "ビットレート",
  "stats.loss": "パケット損失",
  "stats.rtt": "往復遅延",
  "stats.sync": "音声と映像のずれ",
  "stats.syncHint": "{n} ms 未満なら読唇と手話に支障がありません（F.703 §5.2.2）。",
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
  "selftest.section": "マイクとカメラ",
  "selftest.open": "マイクとカメラをテストする",
  "selftest.sectionHint": "通話前の確認です。マイクが無音であることは、通話中ではなく今気づくほうが確実です。",
  "selftest.title": "マイクとカメラのテスト",
  "selftest.sub": "送信は行われません。このテストは端末内で完結します。",
  "selftest.close": "閉じる",
  "selftest.starting": "デバイスを起動しています…",
  "selftest.hint": "話してみてください。バーが動き、映像にご自身が映るはずです。",
  "selftest.levelAria": "マイクの入力レベル",
  "selftest.mic": "マイク",
  "selftest.cam": "カメラ",
  "selftest.unnamed": "名称のないデバイス",
  "selftest.absent": "なし",
  "selftest.noCamera": "カメラがありません。マイクのみをテストします。",
  "selftest.denied": "マイクとカメラへのアクセスが拒否されました。ブラウザーで許可してから、もう一度テストしてください。",
  "selftest.missing": "この端末にマイクもカメラも見つかりません。",
  "selftest.busy": "マイクまたはカメラが他のアプリで使用中です。",
  "selftest.failed": "テストできません：{detail}",

  // ---------------------------------------------------------------------
  // Erreurs des automates (écrites dans le contexte, rendues par l'UI)
  // ---------------------------------------------------------------------
  "error.invalidUri": "SIP アドレスが不正です（形式：ユーザー@ドメイン）",
  "error.wrongDomain": "このアドレスは {domain} ドメインのものである必要があります",
  "error.duplicateAccount": "{address} はもう一方のアカウントとして登録済みです",
  "error.passwordRequired": "パスワードを入力してください",
  "error.saveFailed": "保存できませんでした：{detail}",
  "error.invalidProxy": "プロキシー名が不正です — WSS アドレスを確認してください",
  "error.wssRefused": "プロキシーに接続できません（WSS 接続が拒否されました）",
  "error.wssTimeout": "プロキシーが応答しません（WebSocket タイムアウト）",
  "error.badCredentials": "SIP アドレス、パスワード、または認証ユーザー名が正しくありません",
  "error.missingSha256":
    "このサーバーは SHA-256 認証を要求していますが、このアカウントにはその要約がありません。パスワードを入力し直して計算してください。",
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
  "reason.offerUnsupported": "{detail} のないメディアオファー：WebRTC 非対応",
  "reason.callFailed": "発信できませんでした：{detail}",
  "reason.sip": "{cause}（SIP {code}）",
  "message.reason.noAnswer": "応答なし",
  "message.reason.notFound": "不明なアドレス",
  "message.reason.unreachable": "連絡がつきません",
  "message.reason.refused": "拒否されました",
  "message.reason.format": "形式が拒否されました",
  "message.reason.unsupported": "サーバーがメッセージを転送しません",
  "message.reason.failed": "失敗（SIP {code}）",
  "message.reason.tooLong": "メッセージが長すぎます",
  "message.reason.invalid": "無効なアドレス",
  "message.reason.interrupted": "応答前に接続が切れました",

  // ---------------------------------------------------------------------
  // アカウント共有ページ（share_account.html）
  // ---------------------------------------------------------------------
  "share.title": "共有されたアカウント",
  "share.intro": "このリンクには SIP アカウントの設定が入っています。内容を確かめてから、この端末にアカウントを作成してください。",
  "share.address": "SIP アドレス",
  "share.displayName": "表示名",
  "share.proxy": "SIP サーバー",
  "share.authUsername": "認証ユーザー名",
  "share.ice": "NAT 越え",
  "share.rtt": "リアルタイムテキスト",
  "share.none": "なし",
  "share.warn": "このリンクには、このアカウントで認証するのに必要なものが入っています。アカウントを作成したら、保存せず、転送もしないでください。",
  "share.create": "このアカウントを作成する",
  "share.creating": "作成中…",
  "share.open": "Trix を開く",
  "share.noLink": "このリンクにはアカウントが入っていません。",
  "share.malformed": "このリンクは読み取れません。途中で切れた可能性があります。全文を送り直してもらってください。",
  "share.version": "このリンクは新しいバージョンの Trix で作られています。アプリを更新してから開いてください。",
  "share.wrongDomain": "このアカウントは {domain} ドメインのものですが、この Trix では受け付けられません。",
  "share.exists": "{address} はこの端末にすでに登録されています。何も変更していません。",
  "share.full": "この端末はすでに {max} 件のアカウントを保持しています。設定でどちらかを削除してから追加してください。",
  "share.saveFailed": "アカウントを保存できませんでした：{detail}",

  "misc.raw": "{text}",
};

export default messages;
