/**
 * The core's messages — Simplified Chinese (ADR 0011, D9). Typed against the French
 * reference: a key missing here fails the build.
 */

import type { CoreDictionary } from "../../i18n/types.js";

const messages: CoreDictionary = {
  // ---------------------------------------------------------------------
  // Errors of the machines and of the SIP port (`errors.last`)
  // ---------------------------------------------------------------------
  "error.invalidUri": "SIP 地址无效（应为 用户@域名）",
  "error.wrongDomain": "该地址必须属于 {domain} 域",
  "error.duplicateAccount": "{address} 已登记为另一个账号",
  "error.passwordRequired": "请输入密码",
  "error.saveFailed": "无法保存：{detail}",
  "error.vaultUnreadable": "无法读取账户：{detail}",
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
  "error.offline": "网络不可用——不是设置的问题",
  "error.proxyLostDuringCall": "通话期间与代理服务器的连接已中断",
  "error.callDropped": "通话中断 — 与代理服务器的连接已断开",
  "error.stunInvalid": "STUN 服务器无效（应为 主机 或 主机:端口）",
  "error.turnInvalid": "TURN 服务器无效（应为 主机 或 主机:端口）",
  "error.turnUserRequired": "请输入 TURN 用户名（中继始终需要认证）",
  "error.turnPasswordRequired": "请输入 TURN 密码",

  // ---------------------------------------------------------------------
  // Why a call ended (`CallLogEntry.reason`, `errors.call`)
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

  // ---------------------------------------------------------------------
  // Why a message did not leave (ADR 0008, D3)
  // ---------------------------------------------------------------------
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
  // Passing messages of the call (`CallView.notice`)
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
  // Real-time text: the thread's notes and the transcript (`core/conversation.ts`)
  // ---------------------------------------------------------------------
  "chat.you": "我",
  "chat.note.opened": "实时文本已打开",
  "chat.note.lost": "中断期间丢失了文本",
  "chat.note.broken": "文本连接中断 — 正在恢复",
  "chat.note.closed": "实时文本已关闭",
  "chat.note.refused": "对方不支持实时文本",
  "chat.note.alert": "收到提醒",
  "chat.log.title": "对话 — {target}",
  "chat.log.vttBase": "时间自通话接通起计算 — {at} 的通话。",
  "chat.log.cut": "对话开头未保留",

  // ---------------------------------------------------------------------
  // Reachability (ADR 0006): the sentence of `reachSentence`
  // ---------------------------------------------------------------------
  "reach.none": "您无法接听来电。",

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
