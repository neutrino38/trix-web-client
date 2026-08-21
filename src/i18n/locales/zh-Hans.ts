/**
 * Dictionnaire chinois — mandarin standard en caractères simplifiés
 * (简体中文).
 *
 * Commentaires en français, comme le reste du dépôt : ils s'adressent à qui
 * maintient cette traduction en regard du français de référence, pas à qui
 * la lit à l'écran.
 *
 * **Le fichier s'appelle `zh-Hans`, pas `zh`.** L'écriture, ici, distingue
 * mieux que le pays : le même mandarin s'écrit en simplifié sur le
 * continent et à Singapour, en traditionnel à Taïwan et à Hong Kong, et
 * `Intl.DisplayNames` nomme la balise « 简体中文 » — ce qu'un lecteur
 * cherche dans le sélecteur. La détection n'en souffre pas : un navigateur
 * réglé sur `zh-CN` retombe sur cette langue par sa sous-étiquette
 * primaire, comme `fr-CA` retombe sur `fr`. Le jour où un `zh-Hant.ts`
 * paraîtra, les deux cohabiteront sans que rien change ici.
 *
 * Ce n'est pas un décalque du français. Trois écarts assumés :
 *
 * - **La ponctuation est pleine chasse** — ，。、：（）—, et les guillemets
 *   sont les doubles courbes “ ” de l'usage continental, non les 「 」 du
 *   traditionnel et du japonais.
 * - **Une espace sépare le latin du chinois** — « SIP 地址 », « {n} 分钟 » :
 *   c'est l'usage typographique, et le rendu en souffre sans.
 * - **« 全交流 »** rend « conversation totale » (Total Conversation, F.703).
 *   Le terme est rare en chinois ; il est retenu parce qu'il est celui des
 *   traductions de l'UIT, et non une invention de ce fichier.
 *
 * Le chinois **ne décline pas le pluriel** : `Intl.PluralRules` ne lui rend
 * que la forme `other`. Les clés `.one` restent pourtant obligatoires — le
 * type les tient du français (voir `Translation` dans `../types.ts`) — et
 * portent ici le même texte que `.other`, qui seul sera choisi.
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
  "lang.label": "界面语言",
  "lang.auto": "自动（浏览器语言）",
  "lang.autoDetected": "自动 — {name}",
  "lang.hint": "“自动”会跟随浏览器的语言。",

  // ---------------------------------------------------------------------
  // Titres d'onglet des écrans sans état de téléphone
  // ---------------------------------------------------------------------
  "screen.settings": "设置",
  "screen.saving": "正在保存…",

  // ---------------------------------------------------------------------
  // Écran d'accueil
  // ---------------------------------------------------------------------
  "home.tagline": "全交流网页电话",
  "home.useAccount": "使用此账号",
  "home.newAccount": "设置新账号",
  "home.version": "版本 {version}",
  "fsl.aria": "Powered by FSL — GitHub 上的 finite-state-language（新窗口）",

  // ---------------------------------------------------------------------
  // Écran de configuration
  // ---------------------------------------------------------------------
  "config.title": "设置",
  "config.section.account": "SIP 账号",
  "config.proxy": "SIP 服务器",
  "config.proxyPlaceholder": "wss://sip.example.com:8443/ws",
  "config.uri": "SIP 地址",
  "config.uriPlaceholder": "sip:alice@example.com",
  "config.uriHint": "带不带“sip:”前缀都可以。域名同时用作认证域（realm）。",
  "config.displayName": "您的姓名",
  "config.authToggle": "认证用户名（与 {user} 不同时填写）",
  "config.authUserDefault": "地址中的用户名部分",
  "config.password": "密码",
  "config.passwordSet": "••••••（已设置）",
  "config.passwordKeep": "留空则保留当前密码。",
  "config.ha1Note": "密码本身不会保存，只有加密后的摘要（HA1）留在此浏览器中。",

  "config.section.nat": "NAT 穿越",
  "config.natHint":
    "由您的 SIP 运营商提供的服务器。没有它们，两个专用网络之间的通话可能接通了却听不到声音。",
  "config.stun": "STUN 服务器",
  "config.stunPlaceholder": "stun.example.com:3478",
  "config.stunHint": "可选。只填主机，或填主机:端口 — 不填端口则使用 3478。",
  "config.turn": "TURN 服务器",
  "config.turnPlaceholder": "turn.example.com:3478",
  "config.turnHint": "可选 — 直连失败时中继媒体流。不使用则留空。",
  "config.turnUser": "TURN 用户名",
  "config.turnPass": "TURN 密码",
  "config.turnPassKeep": "留空则保留当前密码。",
  "config.turnTlsLabel": "基于 TLS 的 TURN",
  "config.turnTlsDesc": " — 加密中继（“turns:”），在只允许 TLS 流量的网络中依然通得过",
  "config.turnTlsHint": "未指定端口时，将使用 5349 而不是 3478。",
  "config.turnNote":
    "TURN 密码则会（加密）保存：中继在每次通话时都要求密码本身，摘要不够用。",

  "config.section.alerts": "提醒与显示",
  "config.alertsHint": "这些设置立即生效，无需等待注册 — 闪烁提醒除外，它随账号保存。",
  "config.flashLabel": "来电时闪烁屏幕",
  "config.flashDesc": " — 振铃期间屏幕闪烁，即使关掉声音也能察觉来电",
  "config.flashHint": "随账号保存，换一台设备也会跟着您。",
  "config.notifications": "系统通知",
  "config.notifEnable": "启用通知",
  "config.notifHint": "没有通知，窗口被遮挡或最小化时 Trix 就无法提醒您。",
  "config.notifOn": "通知已启用",
  "config.notifBlocked": "浏览器已阻止通知",
  "config.notifBlockedHint": "请在浏览器的网站设置中重新允许，Trix 无法自行再次请求授权。",
  "config.theme": "主题",
  "config.themeHint": "“系统”跟随设备的浅色/深色设置。",
  "theme.system": "系统",
  "theme.light": "浅色",
  "theme.dark": "深色",

  // Diagnostic — réglages locaux, jamais enregistrés avec le compte
  "config.section.diag": "诊断",
  "config.traceLabel": "记录 SIP 消息",
  "config.traceDesc": " — 收发的每个数据包，以及通话经过的各个状态，都会输出到浏览器控制台",
  "config.traceHint":
    "立即生效，通话中也一样：打开控制台（F12）即可查看数据包。每次通话还会把自己的记录加密保存在历史记录里，直到您清除为止。记录中含有您和对方的 SIP 地址 — 提交公开的缺陷报告前请先删去。",
  "config.save": "保存并连接",
  "config.saving": "正在保存…",
  "config.cancel": "取消",

  // ---------------------------------------------------------------------
  // État du téléphone (pastille de la barre d'en-tête, titre d'onglet)
  // ---------------------------------------------------------------------
  "status.connecting": "正在连接…",
  "status.registering": "正在注册…",
  "status.ready": "已注册",
  "status.reconnecting": "正在重新连接…",
  "status.sleeping": "已休眠",
  "status.regFailed": "注册失败",
  "status.unregistering": "正在断开…",

  // ---------------------------------------------------------------------
  // État de l'appel
  // ---------------------------------------------------------------------
  "call.dialing": "正在呼叫",
  "call.ringing": "正在振铃",
  "call.ringingIn": "来电",
  "call.answering": "正在接通…",
  "call.connected": "通话中",
  "call.hangingup": "正在挂断",

  // ---------------------------------------------------------------------
  // Écran d'appel
  // ---------------------------------------------------------------------
  "call.targetLabel": "SIP 地址",
  "call.callerLabel": "主叫方",
  "call.domainHint": "不带“@”时将呼叫 &lt;地址&gt;@{domain}",
  "call.idle": "当前没有通话 — 请输入 SIP 地址",
  "call.sleeping": "已休眠 — 设备唤醒后将恢复注册",
  "call.sleepingShort": "已休眠 — 唤醒后恢复",
  "call.retryIn": "10 秒后重新连接…",
  "call.chooseMode": "选择通话方式",
  "mode.audio.label": "语音通话",
  "mode.audio.button": "发起语音通话",
  "mode.video.label": "视频通话",
  "mode.video.button": "发起视频通话",
  "chat.strip": "聊天 — 第 4 阶段推出",

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------
  "action.settings": "设置",
  "action.logout": "退出登录",
  "action.retry": "重试",
  "action.retryNow": "立即重试",
  "action.fixSettings": "修改设置",
  "action.unavailableInCall": "（通话中不可用）",

  // ---------------------------------------------------------------------
  // Commandes média (barre de surimpression)
  // ---------------------------------------------------------------------
  "ctrl.mic.aria": "麦克风",
  "ctrl.mic.mute": "关闭麦克风",
  "ctrl.mic.unmute": "打开麦克风",
  "ctrl.cam.aria": "摄像头",
  "ctrl.cam.add": "添加视频",
  "ctrl.cam.remove": "取消视频",
  "ctrl.cam.pending": "正在更改媒体…",
  "ctrl.selfview.aria": "本地画面",
  "ctrl.selfview.hide": "隐藏本地画面",
  "ctrl.selfview.show": "显示本地画面",
  "ctrl.speaker.aria": "扬声器",
  "ctrl.speaker.mute": "关闭声音",
  "ctrl.speaker.unmute": "打开声音",
  "ctrl.dtmf.aria": "DTMF 拨号键盘",
  "ctrl.dtmf.label": "DTMF 拨号键盘 — 第 4 阶段推出",
  "ctrl.fullscreen": "全屏",
  "ctrl.hangup": "挂断",

  // ---------------------------------------------------------------------
  // 通话中请求添加视频
  // ---------------------------------------------------------------------
  "videoask.title": "{peer} 希望添加视频",
  "videoask.body": "接受后将打开你的摄像头。",
  "videoask.accept": "接受视频",
  "videoask.reject": "拒绝",

  // ---------------------------------------------------------------------
  // 通话中的即时提示
  // ---------------------------------------------------------------------
  "notice.videoDeclined": "{peer} 未接受视频",
  "notice.videoRefused": "{peer} 拒绝为本次通话添加视频",
  "notice.videoAdded": "{peer} 添加了视频",
  "notice.videoRemoved": "{peer} 取消了视频",
  "notice.videoDeclinedHere": "已拒绝视频",
  "notice.videoUnavailable": "目前无法添加视频",

  // ---------------------------------------------------------------------
  // Panneau latéral
  // ---------------------------------------------------------------------
  "panel.aria": "侧边栏",
  "panel.showChat": "显示聊天",
  "panel.hide": "隐藏侧边栏",
  "panel.handleAria": "侧边栏宽度",
  "panel.handleTitle": "拖动可加宽侧边栏 — 最多占屏幕宽度的 33%",

  // ---------------------------------------------------------------------
  // Préférences d'affichage en cours d'appel
  // ---------------------------------------------------------------------
  "prefs.fontSize": "文字大小",
  "prefs.fontDown": "缩小文字",
  "prefs.fontUp": "放大文字",

  // ---------------------------------------------------------------------
  // Appel entrant (popup modale)
  // ---------------------------------------------------------------------
  "incoming.kicker.video": "视频来电",
  "incoming.kicker.audio": "语音来电",
  "incoming.answerVideo": "用视频接听",
  "incoming.answerAudio": "用语音接听",
  "incoming.reject": "拒接",

  // ---------------------------------------------------------------------
  // Alerte d'appel entrant (titre d'onglet, notification système)
  // ---------------------------------------------------------------------
  "alert.title": "📞 来电 — {caller}",
  "alert.notifTitle": "来电",
  "alert.notifVideo": "{caller} — 视频通话",
  "alert.notifAudio": "{caller} — 语音通话",

  // ---------------------------------------------------------------------
  // Annonces aux lecteurs d'écran
  // ---------------------------------------------------------------------
  // Le chinois n'a qu'une forme : `.one` ne sera jamais choisie.
  "announce.inCall.one": "通话中，已进行 {n} 分钟",
  "announce.inCall.other": "通话中，已进行 {n} 分钟",

  // ---------------------------------------------------------------------
  // Historique d'appels
  // ---------------------------------------------------------------------
  "history.title": "历史记录",
  "history.clear": "清除",
  "history.empty": "暂无通话记录",
  "history.entryTitle": "{target} — {outcome}",

  // Carnet d'un appel : les paquets SIP gardés quand la trace était active
  "trace.open": "查看此次通话的 SIP 记录",
  "trace.title": "SIP 记录 — {target}",
  "trace.count.one": "{n} 个数据包",
  "trace.count.other": "{n} 个数据包",
  "trace.sent": "已发送",
  "trace.received": "已接收",
  "trace.copy": "复制",
  "trace.copied": "已复制",
  "trace.copyFailed": "复制被拒绝",
  "trace.close": "关闭",
  "trace.clipped": "…（数据包已截断）",
  "trace.truncated": "记录已中断：本次通话超出了单次通话的保存上限。",
  "outcome.answered": "已接听",
  "outcome.missed": "未接",
  "outcome.failed": "失败",
  "outcome.canceled": "已取消",
  "outcome.dropped": "已中断",
  "endedBy.local": "您挂断了",
  "endedBy.remote": "对方挂断了",
  "endedBy.network": "被网络中断",
  "duration.minSec": "{m} 分 {s} 秒",
  "duration.sec": "{s} 秒",

  // ---------------------------------------------------------------------
  // Statistiques média (survol de la pastille « 通话中 »)
  // ---------------------------------------------------------------------
  "stats.hint": "此次通话的媒体统计",
  "stats.title": "媒体统计",
  "stats.window": "最近 {s} 秒的平均值",
  "stats.recv": "接收",
  "stats.sent": "发送",
  "stats.audio": "音频",
  "stats.video": "视频",
  "stats.codec": "编解码器",
  "stats.bitrate": "码率",
  "stats.loss": "丢包",
  "stats.rtt": "往返时延",
  "stats.lossNote": "发送侧的丢包，取自对方接收报告所给的数值。",
  "stats.pending": "正在测量…",
  "stats.none": "未测得媒体流",
  "stats.kbps": "{n} kbit/s",
  "stats.percent": "{n} %",
  "stats.ms": "{n} ms",
  "stats.khz": "{n} kHz",
  "stats.spanCall": "{d} 内的平均值",
  "stats.open": "此次通话的媒体统计",
  "stats.callTitle": "媒体统计 — {target}",
  "stats.close": "关闭",
  "stats.copy": "复制",
  "stats.copied": "已复制",
  "stats.copyFailed": "复制被拒绝",

  // ---------------------------------------------------------------------
  // Erreurs des automates (écrites dans le contexte, rendues par l'UI)
  // ---------------------------------------------------------------------
  "error.invalidUri": "SIP 地址无效（应为 用户@域名）",
  "error.passwordRequired": "请输入密码",
  "error.saveFailed": "无法保存：{detail}",
  "error.invalidProxy": "代理服务器名称无效 — 请检查 WSS 地址",
  "error.wssRefused": "无法连接到代理服务器（WSS 连接被拒绝）",
  "error.wssTimeout": "代理服务器无响应（WebSocket 超时）",
  "error.badCredentials": "SIP 地址、密码或认证用户名不正确",
  "error.regRefused": "注册被拒绝：{cause}",
  "error.wssLostDuringReg": "注册期间连接中断",
  "error.registrarTimeout": "注册服务器无响应",
  "error.regLost": "注册已失效：{cause}",
  "error.proxyLost": "与代理服务器的连接已中断",
  "error.proxyLostDuringCall": "通话期间与代理服务器的连接已中断",
  "error.callDropped": "通话中断 — 与代理服务器的连接已断开",
  "error.stunInvalid": "STUN 服务器无效（应为 主机 或 主机:端口）",
  "error.turnInvalid": "TURN 服务器无效（应为 主机 或 主机:端口）",
  "error.turnUserRequired": "请输入 TURN 用户名（中继始终需要认证）",
  "error.turnPasswordRequired": "请输入 TURN 密码",

  // ---------------------------------------------------------------------
  // Motifs de fin d'appel (affichés près du champ d'adresse et en historique)
  // ---------------------------------------------------------------------
  "reason.hungUp": "已挂断",
  "reason.sleep": "进入休眠",
  "reason.noAnswer": "无人接听",
  "reason.declined": "通话被拒接",
  "reason.missed": "未接来电",
  "reason.missedNoAnswer": "未接来电（无人接听）",
  "reason.setupFailed": "无法建立通话",
  "reason.callFailed": "无法呼叫：{detail}",
  "reason.sip": "{cause}（SIP {code}）",

  "misc.raw": "{text}",
};

export default messages;
