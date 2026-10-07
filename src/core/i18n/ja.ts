/**
 * The core's messages — Japanese (ADR 0011, D9). Typed against the French
 * reference: a key missing here fails the build.
 */

import type { CoreDictionary } from "../../i18n/types.js";

const messages: CoreDictionary = {
  // ---------------------------------------------------------------------
  // Errors of the machines and of the SIP port (`errors.last`)
  // ---------------------------------------------------------------------
  "error.invalidUri": "SIP アドレスが不正です（形式：ユーザー@ドメイン）",
  "error.wrongDomain": "このアドレスは {domain} ドメインのものである必要があります",
  "error.duplicateAccount": "{address} はもう一方のアカウントとして登録済みです",
  "error.passwordRequired": "パスワードを入力してください",
  "error.saveFailed": "保存できませんでした：{detail}",
  "error.vaultUnreadable": "アカウントを読み込めませんでした：{detail}",
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
  "error.offline": "ネットワークに接続されていません（設定の問題ではありません）",
  "error.proxyLostDuringCall": "通話中にプロキシーとの接続が切れました",
  "error.callDropped": "通話が切断されました — プロキシーとの接続が切れました",
  "error.stunInvalid": "STUN サーバーが不正です（形式：ホスト または ホスト:ポート）",
  "error.turnInvalid": "TURN サーバーが不正です（形式：ホスト または ホスト:ポート）",
  "error.turnUserRequired": "TURN ユーザー名を入力してください（中継は必ず認証を求めます）",
  "error.turnPasswordRequired": "TURN パスワードを入力してください",
  "error.fileStoreInvalid": "ファイルサーバーが無効です（https:// のアドレスが必要です）",

  // ---------------------------------------------------------------------
  // Why a call ended (`CallLogEntry.reason`, `errors.call`)
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

  // ---------------------------------------------------------------------
  // Why a message did not leave (ADR 0008, D3)
  // ---------------------------------------------------------------------
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
  "message.reason.fileTooLarge": "ファイルがサーバーには大きすぎます",
  "message.reason.fileCredentials": "ファイルサーバーが認証情報を拒否しました",
  "message.reason.fileStore": "ファイルサーバーが受け付けませんでした",
  "message.reason.fileLost": "ページの再読み込みでファイルが失われました",

  // ---------------------------------------------------------------------
  // Passing messages of the call (`CallView.notice`)
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
  // Real-time text: the thread's notes and the transcript (`core/conversation.ts`)
  // ---------------------------------------------------------------------
  "chat.you": "自分",
  "chat.note.opened": "リアルタイムテキストを開始しました",
  "chat.note.lost": "切断中にテキストが失われました",
  "chat.note.broken": "テキストの接続が切れました — 復旧中",
  "chat.note.closed": "リアルタイムテキストは終了しました",
  "chat.note.refused": "この相手はリアルタイムテキストに対応していません",
  "chat.note.alert": "注意喚起を受信しました",
  "chat.log.title": "会話 — {target}",
  "chat.log.vttBase": "時刻は通話開始からの経過時間 — {at} の通話。",
  "chat.log.cut": "会話の冒頭は保存されていません",

  // ---------------------------------------------------------------------
  // Reachability (ADR 0006): the sentence of `reachSentence`
  // ---------------------------------------------------------------------
  "reach.none": "着信を受けられません。",

  // ---------------------------------------------------------------------
  // Raw text
  // ---------------------------------------------------------------------
  /**
   * Technical text with no translation (a JsSIP cause, a history entry
   * older than the i18n): shown as it is, rather than lost.
   */
  "misc.raw": "{text}",
};

export default messages;
