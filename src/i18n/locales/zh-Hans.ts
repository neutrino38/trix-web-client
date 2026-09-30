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
  "screen.deleting": "正在删除…",

  // ---------------------------------------------------------------------
  // Écran d'accueil
  // ---------------------------------------------------------------------
  "home.tagline": "全交流网页电话",
  "home.useAccount": "使用此账号",
  "home.newAccount": "设置新账号",
  "home.addAccount": "添加账号",
  "home.editAccount": "修改",
  "home.version": "版本 {version}",
  "fsl.aria": "Powered by FSL — GitHub 上的 finite-state-language（新窗口）",

  // ---------------------------------------------------------------------
  // Écran de configuration
  // ---------------------------------------------------------------------
  "config.title": "设置",
  "config.titleNew": "新账号",
  "config.section.account": "SIP 账号",
  "config.proxy": "SIP 服务器",
  "config.proxyPlaceholder": "wss://sip.example.com:8443/ws",
  "config.uri": "SIP 地址",
  "config.uriPlaceholder": "sip:alice@example.com",
  "config.uriHint": "带不带“sip:”前缀都可以。域名同时用作认证域（realm）。",
  "config.uriHintDomain": "此处只接受 {domain} 域的地址。该域名同时用作认证域（realm）。",
  "config.displayName": "您的姓名",
  "config.authToggle": "认证用户名（与 {user} 不同时填写）",
  "config.authUserDefault": "地址中的用户名部分",
  "config.password": "密码",
  "config.passwordSet": "••••••（已设置）",
  "config.passwordKeep": "留空则保留当前密码。",
  "config.share": "账号共享",
  "config.shareCopy": "复制共享链接",
  "config.shareWarn": "使用此链接将您的账号迁移到另一台设备。",
  "config.shareCopied": "已复制共享链接",
  "config.shareManual": "共享链接，供复制",

  "config.advanced": "高级设置",
  "config.section.nat": "NAT 穿越",
  "config.natHint":
    "当您从经 NAT 连接互联网的专用网络发起呼叫时，用于建立通话的服务器。",
  "config.stun": "STUN 服务器",
  "config.stunPlaceholder": "stun.example.com:3478",
  "config.stunHint": "可选。只填主机，或填主机:端口 — 不填端口则使用 3478。",
  "config.turn": "TURN 服务器",
  "config.turnPlaceholder": "turn.example.com:3478",
  "config.turnHint": "直连失败时中继媒体流。不使用则留空。",
  "config.turnUser": "TURN 用户名",
  "config.turnPass": "TURN 密码",
  "config.turnPassKeep": "留空则保留当前密码。",
  "config.turnTlsLabel": "基于 TLS 的 TURN",
  "config.turnTlsDesc": " — 加密中继（“turns:”），在只允许 TLS 流量的网络中依然通得过",
  "config.turnTlsHint": "未指定端口时，将使用 5349 而不是 3478。",

  "config.section.rtt": "实时文字",
  "config.rttHint": "通话过程中，文字逐字发出、逐字读到。",
  "config.rttTransport": "传输方式",
  "config.rttNone": "无",
  "config.rttNoneDesc": " — 实时文字已关闭",
  "config.rttWs": "经 WebSocket",
  "config.rttWsDesc": " — 实时文字经 WebSocket 交换（非标准）",
  "config.rttDc": "经数据通道",
  "config.rttDcDesc": " — 符合 RFC 8865 标准的实时文字",

  "config.section.alerts": "提醒与显示",
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
  "config.delete": "删除此账号",
  "config.deleteConfirm": "确认：删除 {address} 及其通话记录",

  // ---------------------------------------------------------------------
  // État du téléphone (pastille de la barre d'en-tête, titre d'onglet)
  // ---------------------------------------------------------------------
  "status.connecting": "正在连接…",
  "status.registering": "正在注册…",
  "status.ready": "已注册",
  "status.reconnecting": "正在重新连接…",
  "status.sleeping": "已休眠",
  "status.sleepingSeen": "已休眠 — 联系人看到您离线",
  "status.regFailed": "注册失败",
  "status.unregistering": "正在断开…",
  "status.switching": "正在切换账号…",
  "presence.available": "有空",
  "presence.busy": "忙碌",
  "presence.onThePhone": "通话中",
  "presence.away": "离开",
  "presence.dnd": "请勿打扰",
  "presence.offline": "离线",
  "presence.unknown": "状态未知",
  "presence.invisible": "隐身",
  "presenceMenu.label": "我的状态",
  "presenceMenu.seen": "联系人看到的状态",
  "presenceMenu.busyHint": "来电照常接入",
  "presenceMenu.dndHint": "来电将被拒接并记入通话记录",
  "presenceMenu.invisibleHint": "你显示为离线，但仍可接听来电",
  "presenceMenu.note": "向联系人显示的备注",
  "presenceMenu.clearNote": "清除备注",
  "presenceMenu.auto": "自动",
  "presenceMenu.onThePhone": "通话时显示“通话中”",
  "presenceMenu.onThePhoneHint": "挂断后恢复为所选状态",
  "presenceMenu.awayWhenIdle": "10 分钟无操作后显示“离开”",
  "presenceMenu.sleepHint": "休眠时页面会注销，无论此处如何选择，联系人都会看到你离线。",
  "presenceMenu.noPublish": "此服务器不发布你的状态：联系人看不到它。",
  "announce.statusChanged": "状态：{status}",
  "thread.title": "往来",
  "thread.subtitle": "联系人和通话",
  "thread.search": "搜索联系人",
  "thread.add": "添加联系人",
  "thread.group.today": "今天",
  "thread.group.yesterday": "昨天",
  "thread.group.week": "本周",
  "thread.group.older": "更早",
  "thread.group.none": "尚无往来",
  "thread.notContact": "不在你的联系人中",
  "thread.addToContacts": "添加到联系人",
  "thread.stale": "{status}，{time} 时的状态 — 未更新",
  "thread.pending": "等待对方同意",
  "thread.call": "呼叫 {name}",
  "thread.noMatch": "没有与此搜索匹配的往来。",
  "thread.firstContact": "添加联系人，即可在呼叫前了解对方是否有空。",
  "thread.addLast": "添加 {name}",
  "thread.noPresence": "此服务器不传递在线状态。您仍可呼叫联系人。",
  "thread.noCalls": "与此联系人还没有通话。",
  "thread.subtitleMessages": "联系人、通话和消息",
  "thread.segments": "显示",
  "thread.segment.all": "全部",
  "thread.segment.calls": "通话",
  "thread.segment.messages": "消息",
  "thread.expand": "展开对话",
  "thread.collapse": "返回往来",
  "thread.noEvents": "尚未与此联系人交流。",
  "thread.noMessages": "尚无消息。",
  "thread.unread.one": "{n} 条未读消息",
  "thread.unread.other": "{n} 条未读消息",
  "thread.blocked": "已屏蔽",
  "thread.block": "屏蔽",
  "thread.unblock": "取消屏蔽",
  "thread.noMessaging": "此服务器不转发消息。下次连接时可恢复发送。",
  "message.you": "你：{text}",
  "message.from": "{name}：",
  "message.mine": "你：",
  "message.compose": "发给 {name} 的消息",
  "message.placeholder": "输入消息…",
  "message.send": "发送",
  "message.count": "{n} / {max} 字节",
  "message.state.pending": "等待中",
  "message.state.sent": "已送达服务器",
  "message.state.delivered": "已送达",
  "message.state.displayed": "已读",
  "message.state.failed": "未送达：{reason}",
  "message.retry": "重试",
  "message.offline": "离线：消息将在下次连接时发出。",
  "message.badge.one": "{name} 的 {n} 条消息",
  "message.badge.other": "{name} 的 {n} 条消息",
  "message.badgeMany.one": "{n} 条消息",
  "message.badgeMany.other": "{n} 条消息",
  "message.badgeStranger": "有来自未知地址的消息待处理",
  "message.announce": "来自 {name} 的新消息",
  "message.announceText": "{name}：{text}",
  "message.notifyStranger": "打开 Trix 以接受或拒绝。",
  "stranger.title": "来自未知地址的消息",
  "stranger.named": "{address}（自称“{name}”）",
  "stranger.intro": "{who} 给你发来消息：",
  "stranger.expiry": "如果你不回应，这些消息将在两分钟后删除，发送者不会知道。按 Esc 拒绝。",
  "stranger.accept": "添加到联系人",
  "stranger.refuse": "拒绝",
  "stranger.block": "屏蔽",
  "thread.form.name": "名称",
  "thread.form.address": "SIP 地址或号码",
  "thread.form.save": "添加",
  "thread.form.cancel": "取消",
  "thread.rename": "重命名",
  "thread.renameSave": "保存",
  "thread.remove": "从联系人中移除",
  "thread.yesterday": "昨天",
  "call.contactHint": "{name} · {status}",

  // ---------------------------------------------------------------------
  // 可接听状态（ADR 0006）
  // ---------------------------------------------------------------------
  "reach.none": "您无法接听来电。",
  "reach.title": "无法接听 — Trix",
  "reach.notifTitle": "Trix 已无法接听来电",
  "reach.notifFreeze": "浏览器已让此标签页休眠。在您回到它之前都无法接听来电。",
  "reach.notifSystem": "计算机已进入睡眠。在它唤醒之前都无法接听来电。",
  "reach.notifOffline": "网络连接已中断。在恢复之前都无法接听来电。",
  "reach.notifDiscard": "浏览器为释放内存丢弃了此标签页。回到 Trix 即可重新注册。",
  "reach.notifLost": "注册已丢失。在恢复之前都无法接听来电。",
  "reach.backTitle": "Trix 又可以接听来电了",
  "reach.back": "注册已恢复：您又可以接听来电了。",
  "reach.discarded": "浏览器为节省内存让 Trix 休眠：{from} 至 {to} 期间您无法接听来电。",
  "reach.pinHint": "要避免这种情况：固定此标签页，并把 Trix 加入浏览器的“始终保持活动的网站”。",
  "reach.dismiss": "隐藏此消息",

  // ---------------------------------------------------------------------
  // État de l'appel
  // ---------------------------------------------------------------------
  "call.dialing": "正在呼叫",
  "call.ringing": "正在振铃",
  "call.earlyMedia": "网络提示音",
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
  "mode.text.label": "文字通话",
  "mode.text.button": "发起文字通话",
  "chat.strip": "聊天随通话一起打开",
  "chat.stripRefused": "对方未接受实时文本",
  // ---------------------------------------------------------------------
  // 实时文本（T.140）聊天
  // ---------------------------------------------------------------------
  "chat.tab": "聊天",
  "chat.aria": "与 {peer} 的对话",
  "chat.you": "我",
  "chat.typing": "正在输入",
  "chat.announce": "{who}：{text}",
  "chat.jump.one": "回到底部 — {n} 条",
  "chat.jump.other": "回到底部 — {n} 条",
  "chat.composerAria": "实时文本消息",
  "chat.placeholder": "边打字边发送",
  "chat.placeholderClosed": "本次通话无法使用文本",
  "chat.placeholderEarly": "接通前仅可阅读",
  "chat.enterHint": "回车结束当前气泡",
  "chat.state.open": "边打字边发送",
  "chat.state.connecting": "正在打开实时文本…",
  "chat.state.lost": "连接中断 — 正在恢复",
  "chat.state.closed": "实时文本已关闭",
  "chat.state.refused": "对方不支持实时文本",
  "chat.state.pending": "{s} 秒后发送更正",
  "chat.note.opened": "实时文本已打开",
  "chat.note.lost": "中断期间丢失了文本",
  "chat.note.broken": "文本连接中断 — 正在恢复",
  "chat.note.closed": "实时文本已关闭",
  "chat.note.refused": "对方不支持实时文本",
  "chat.note.alert": "收到提醒",

  "chat.log.open": "回看此次通话的对话",
  "chat.log.title": "对话 — {target}",
  "chat.log.count.one": "{n} 条消息",
  "chat.log.count.other": "{n} 条消息",
  "chat.log.copy": "复制",
  "chat.log.copied": "已复制",
  "chat.log.copyFailed": "复制被拒绝",
  "chat.log.export": "导出",
  "chat.log.exportFailed": "导出被拒绝",
  "chat.log.close": "关闭",
  "chat.log.vttBase": "时间自通话接通起计算 — {at} 的通话。",
  "chat.log.cut": "对话开头未保留",

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------
  "action.settings": "设置",
  "action.logout": "退出登录",
  "action.retry": "重试",
  "action.retryNow": "立即重试",
  "action.fixSettings": "修改设置",
  "action.unavailableInCall": "（通话中不可用）",
  "action.switchAccount": "切换到账号 {address}",

  // ---------------------------------------------------------------------
  // Commandes média (barre de surimpression)
  // ---------------------------------------------------------------------
  "ctrl.mic.aria": "语音",
  "ctrl.mic.add": "添加语音",
  "ctrl.mic.remove": "移除语音",
  "ctrl.cam.aria": "视频",
  "ctrl.cam.add": "添加视频",
  "ctrl.cam.remove": "取消视频",
  "ctrl.share.aria": "屏幕共享",
  "ctrl.share.start": "共享屏幕",
  "ctrl.share.stop": "停止共享",
  "ctrl.share.busy": "对方已在共享屏幕",
  "ctrl.media.pending": "正在更改媒体…",
  "ctrl.media.last": "无法执行：通话将不再承载任何媒体",
  "ctrl.selfview.aria": "本地画面",
  "ctrl.selfview.hide": "隐藏本地画面",
  "ctrl.selfview.show": "显示本地画面",
  "share.stageAria": "{peer} 共享的屏幕",
  "share.zoomGroup": "共享屏幕缩放",
  "share.zoomIn": "放大共享屏幕",
  "share.zoomOut": "缩小共享屏幕",
  "share.zoomReset": "恢复原始大小",
  "share.zoomLevel": "{n}%",
  "share.zoomHint": "双指捏合可放大，方向键可移动",
  "ctrl.swap.aria": "交换屏幕与画面",
  "ctrl.swap.screen": "放大共享的屏幕",
  "ctrl.swap.face": "放大对方画面",
  "ctrl.speaker.aria": "本机收听",
  "ctrl.speaker.mute": "停止收听",
  "ctrl.speaker.unmute": "恢复收听",
  "ctrl.dtmf.aria": "DTMF 拨号键盘",
  "ctrl.dtmf.show": "显示 DTMF 拨号键盘",
  "ctrl.dtmf.hide": "隐藏 DTMF 拨号键盘",
  "ctrl.chat.aria": "聊天",
  "ctrl.chat.show": "显示聊天",
  "ctrl.chat.hide": "隐藏聊天",
  "ctrl.chat.unavailable": "对方未接受实时文本",
  "ctrl.fullscreen": "全屏",
  "ctrl.hangup": "挂断",
  "ctrl.pause": "暂停",
  "ctrl.pause.aria": "暂停",
  "ctrl.resume": "继续",
  "pause.banner": "您已暂停",
  "pause.hint": "您的麦克风和画面已停止。文字仍在传送。",
  "pause.resume": "继续",
  "pause.peer": "{peer} 已暂停",
  "ctrl.group.call": "通话媒体",
  "ctrl.group.device": "本机",
  "ctrl.more": "更多控件",
  "sheet.title": "更多通话控件",

  // ---------------------------------------------------------------------
  // Clavier DTMF
  // ---------------------------------------------------------------------
  "dtmf.aria": "DTMF 拨号键盘",
  "dtmf.sent": "已发送的按键音",
  "dtmf.hint": "点击按键或使用键盘输入",
  "dtmf.keyAria": "按键 {key}",
  "dtmf.star": "星号",
  "dtmf.hash": "井号",

  // ---------------------------------------------------------------------
  // 通话中请求添加视频
  // ---------------------------------------------------------------------
  "mediaask.video.title": "{peer} 希望添加视频",
  "mediaask.video.body": "接受后将开启您的摄像头。",
  "mediaask.video.accept": "接受视频",
  "mediaask.audio.title": "{peer} 希望添加语音",
  "mediaask.audio.body": "接受后将开启您的麦克风。",
  "mediaask.audio.accept": "接受语音",
  "mediaask.both.title": "{peer} 希望添加语音和视频",
  "mediaask.both.body": "接受后将开启您的麦克风和摄像头。",
  "mediaask.both.accept": "两者都接受",
  "mediaask.share.title": "{peer} 想共享屏幕",
  "mediaask.share.body": "对方的屏幕将占据主画面，其视频将移到小窗。拒绝不会改变通话。",
  "mediaask.share.accept": "查看屏幕",
  "mediaask.reject": "拒绝",

  // ---------------------------------------------------------------------
  // 通话中的即时提示
  // ---------------------------------------------------------------------
  "notice.videoDeclined": "{peer} 未接受视频",
  "notice.videoRefused": "{peer} 拒绝为本次通话添加视频",
  "notice.videoAdded": "{peer} 添加了视频",
  "notice.videoRemoved": "{peer} 取消了视频",
  "notice.videoDeclinedHere": "已拒绝视频",
  "notice.videoUnavailable": "目前无法添加视频",
  "notice.shareRefused": "{peer} 未接受屏幕共享",
  "notice.shareUnavailable": "目前无法共享屏幕",
  "notice.sharePeerStarted": "{peer} 正在共享屏幕",
  "notice.sharePeerStopped": "{peer} 已停止共享屏幕",
  "notice.shareDeclinedHere": "已拒绝屏幕共享",
  "notice.audioDeclined": "{peer} 未接受语音",
  "notice.audioRefused": "{peer} 拒绝为此通话添加语音",
  "notice.audioAdded": "{peer} 添加了语音",
  "notice.audioRemoved": "{peer} 移除了语音",
  "notice.audioDeclinedHere": "已拒绝语音",
  "notice.audioUnavailable": "目前无法添加语音",
  "notice.dtmfFailed": "无法发送按键音 {tone}",

  // ---------------------------------------------------------------------
  // Panneau latéral
  // ---------------------------------------------------------------------
  "panel.aria": "侧边栏",
  "panel.showChat": "显示聊天",
  "panel.show": "显示侧边栏",
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
  "incoming.kicker.audioText": "语音 + 文字来电",
  "incoming.kicker.videoText": "视频 + 文字来电",
  "incoming.kicker.text": "文字来电",
  "incoming.answerVideo": "用视频接听",
  "incoming.answerAudio": "用语音接听",
  "incoming.answerText": "用文字接听",
  "incoming.reject": "拒接",

  // ---------------------------------------------------------------------
  // Alerte d'appel entrant (titre d'onglet, notification système)
  // ---------------------------------------------------------------------
  "alert.title": "📞 来电 — {caller}",
  "alert.notifTitle": "来电",
  "alert.notifVideo": "{caller} — 视频通话",
  "alert.notifAudio": "{caller} — 语音通话",
  "alert.notifText": "{caller} — 文字通话",

  // ---------------------------------------------------------------------
  // Annonces aux lecteurs d'écran
  // ---------------------------------------------------------------------
  // Le chinois n'a qu'une forme : `.one` ne sera jamais choisie.
  "announce.inCall.one": "通话中，已进行 {n} 分钟",
  "announce.inCall.other": "通话中，已进行 {n} 分钟",

  // ---------------------------------------------------------------------
  // Historique d'appels
  // ---------------------------------------------------------------------
  "history.clear": "清除",
  "history.entryTitle": "{target} — {outcome}",

  // Carnet d'un appel : les paquets SIP gardés quand la trace était active
  "trace.open": "查看此次通话的 SIP 记录",
  "trace.title": "SIP 记录 — {target}",
  "trace.count.one": "{n} 个数据包",
  "trace.count.other": "{n} 个数据包",
  "trace.sent": "已发送",
  "trace.received": "已接收",
  "trace.error": "WebRTC 错误",
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
  "outcome.declined": "已拒接",
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
  "stats.share": "共享屏幕",
  "stats.text": "文本",
  "stats.missing": "缺失文本",
  "stats.codec": "编解码器",
  "stats.bitrate": "码率",
  "stats.loss": "丢包",
  "stats.rtt": "往返时延",
  "stats.sync": "音视频偏差",
  "stats.syncHint": "低于 {n} 毫秒时，唇读和手语不受影响（F.703 §5.2.2）。",
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
  "selftest.section": "麦克风与摄像头",
  "selftest.open": "测试我的麦克风和摄像头",
  "selftest.sectionHint": "通话前的自检：与其通话中才发现麦克风没声音，不如现在就确认。",
  "selftest.title": "麦克风与摄像头测试",
  "selftest.sub": "不会发送任何内容：测试只在本设备上进行。",
  "selftest.close": "关闭",
  "selftest.starting": "正在启动设备…",
  "selftest.hint": "请说话：音量条应有反应，画面中应能看到自己。",
  "selftest.levelAria": "麦克风音量",
  "selftest.mic": "麦克风",
  "selftest.cam": "摄像头",
  "selftest.unnamed": "未命名设备",
  "selftest.absent": "无",
  "selftest.noCamera": "未检测到摄像头：仅测试麦克风。",
  "selftest.denied": "麦克风和摄像头权限被拒绝。请在浏览器中允许后重新测试。",
  "selftest.missing": "本设备未检测到麦克风或摄像头。",
  "selftest.busy": "麦克风或摄像头正被其他应用占用。",
  "selftest.failed": "无法测试：{detail}",

  // ---------------------------------------------------------------------
  // Erreurs des automates (écrites dans le contexte, rendues par l'UI)
  // ---------------------------------------------------------------------
  "error.invalidUri": "SIP 地址无效（应为 用户@域名）",
  "error.wrongDomain": "该地址必须属于 {domain} 域",
  "error.duplicateAccount": "{address} 已登记为另一个账号",
  "error.passwordRequired": "请输入密码",
  "error.saveFailed": "无法保存：{detail}",
  "error.invalidProxy": "代理服务器名称无效 — 请检查 WSS 地址",
  "error.wssRefused": "无法连接到代理服务器（WSS 连接被拒绝）",
  "error.wssTimeout": "代理服务器无响应（WebSocket 超时）",
  "error.badCredentials": "SIP 地址、密码或认证用户名不正确",
  "error.missingSha256": "此服务器要求 SHA-256 认证，而本账户没有相应的摘要。请重新输入密码以计算它。",
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
  "reason.offerUnsupported": "媒体提议缺少 {detail}：与 WebRTC 不兼容",
  "reason.callFailed": "无法呼叫：{detail}",
  "reason.sip": "{cause}（SIP {code}）",
  "message.reason.noAnswer": "无应答",
  "message.reason.notFound": "地址未知",
  "message.reason.unreachable": "无法联系",
  "message.reason.refused": "被拒绝",
  "message.reason.format": "格式被拒绝",
  "message.reason.unsupported": "服务器不转发消息",
  "message.reason.failed": "失败（SIP {code}）",
  "message.reason.tooLong": "消息过长",
  "message.reason.invalid": "地址无效",
  "message.reason.interrupted": "收到答复前连接已断开",

  // ---------------------------------------------------------------------
  // 账号共享页面（share_account.html）
  // ---------------------------------------------------------------------
  "share.title": "共享的账号",
  "share.intro": "该链接包含一个 SIP 账号的设置。请先核对，再在此设备上创建该账号。",
  "share.address": "SIP 地址",
  "share.displayName": "显示名称",
  "share.proxy": "SIP 服务器",
  "share.authUsername": "认证用户名",
  "share.ice": "NAT 穿越",
  "share.rtt": "实时文本",
  "share.none": "无",
  "share.warn": "该链接包含在此账号上完成认证所需的一切。账号创建后，请不要保留，也不要再转发。",
  "share.create": "创建此账号",
  "share.creating": "正在创建…",
  "share.open": "打开 Trix",
  "share.noLink": "该链接不包含任何账号。",
  "share.malformed": "无法读取该链接：多半在传递途中被截断了。请对方重新发送完整链接。",
  "share.version": "该链接来自更新版本的 Trix。请先更新应用再打开。",
  "share.wrongDomain": "该账号属于 {domain} 域，此 Trix 安装不接受该域。",
  "share.exists": "{address} 已登记在此设备上，未做任何更改。",
  "share.full": "此设备已保存 {max} 个账号。请先在设置中删除一个，再添加这个。",
  "share.saveFailed": "无法保存账号：{detail}",

  "misc.raw": "{text}",
};

export default messages;
