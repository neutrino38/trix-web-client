/**
 * The core's messages — Arabic (ADR 0011, D9). Typed against the French
 * reference: a key missing here fails the build.
 */

import type { CoreDictionary } from "../../i18n/types.js";

const messages: CoreDictionary = {
  // ---------------------------------------------------------------------
  // Errors of the machines and of the SIP port (`errors.last`)
  // ---------------------------------------------------------------------
  "error.invalidUri": "عنوان SIP غير صالح (المتوقَّع: user@domain)",
  "error.wrongDomain": "يجب أن يكون هذا العنوان ضمن النطاق {domain}",
  "error.duplicateAccount": "{address} مسجَّل بالفعل في الحساب الآخر",
  "error.passwordRequired": "كلمة المرور مطلوبة",
  "error.saveFailed": "تعذّر الحفظ: {detail}",
  "error.vaultUnreadable": "تعذّرت قراءة الحسابات: {detail}",
  "error.invalidProxy": "اسم الوسيط غير صالح — تحقّق من عنوان WSS",
  "error.wssRefused": "تعذّر الاتصال بالوسيط (رُفض اتصال WSS)",
  "error.wssTimeout": "الوسيط لا يستجيب (انتهت مهلة WebSocket)",
  "error.badCredentials": "عنوان SIP أو كلمة المرور أو معرّف المصادقة غير صحيح",
  "error.missingSha256":
    "يطلب هذا الخادم مصادقة SHA-256، ولا يملك هذا الحساب بصمتها. أعد إدخال كلمة المرور لحسابها.",
  "error.regRefused": "رُفض التسجيل: {cause}",
  "error.wssLostDuringReg": "انقطع الاتصال أثناء التسجيل",
  "error.registrarTimeout": "خادم التسجيل لا يستجيب",
  "error.regLost": "فُقد التسجيل: {cause}",
  "error.proxyLost": "انقطع الاتصال بالوسيط",
  "error.offline": "لا توجد شبكة — الإعدادات ليست السبب",
  "error.proxyLostDuringCall": "انقطع الاتصال بالوسيط أثناء المكالمة",
  "error.callDropped": "انقطعت المكالمة — فُقد الاتصال بالوسيط",
  "error.stunInvalid": "خادم STUN غير صالح (المتوقَّع: المضيف أو المضيف:المنفذ)",
  "error.turnInvalid": "خادم TURN غير صالح (المتوقَّع: المضيف أو المضيف:المنفذ)",
  "error.turnUserRequired": "معرّف TURN مطلوب (المُرحِّل يطلب المصادقة دائمًا)",
  "error.turnPasswordRequired": "كلمة مرور TURN مطلوبة",
  "error.fileStoreInvalid": "خادم ملفات غير صالح (المتوقع: عنوان https://)",

  // ---------------------------------------------------------------------
  // Why a call ended (`CallLogEntry.reason`, `errors.call`)
  // ---------------------------------------------------------------------
  "reason.hungUp": "أُنهيت المكالمة",
  "reason.sleep": "الدخول في وضع السكون",
  "reason.noAnswer": "لا ردّ",
  "reason.declined": "رُفضت المكالمة",
  "reason.missed": "مكالمة فائتة",
  "reason.missedNoAnswer": "مكالمة فائتة (بلا ردّ)",
  "reason.setupFailed": "تعذّر إنشاء المكالمة",
  "reason.offerUnsupported": "عرض وسائط بدون {detail}: غير متوافق مع WebRTC",
  "reason.callFailed": "تعذّر إجراء المكالمة: {detail}",
  "reason.sip": "{cause} (SIP {code})",

  // ---------------------------------------------------------------------
  // Why a message did not leave (ADR 0008, D3)
  // ---------------------------------------------------------------------
  "message.reason.noAnswer": "لا ردّ",
  "message.reason.notFound": "عنوان غير معروف",
  "message.reason.unreachable": "تعذّر الوصول",
  "message.reason.refused": "مرفوض",
  "message.reason.format": "صيغة مرفوضة",
  "message.reason.unsupported": "الخادم لا ينقل الرسائل",
  "message.reason.failed": "فشل (SIP {code})",
  "message.reason.tooLong": "الرسالة طويلة جدًا",
  "message.reason.invalid": "عنوان غير صالح",
  "message.reason.interrupted": "انقطع الاتصال قبل الردّ",
  "message.reason.fileTooLarge": "الملف كبير جدًا على الخادم",
  "message.reason.fileCredentials": "يرفض خادم الملفات بيانات اعتمادك",
  "message.reason.fileStore": "لم يقبله خادم الملفات",
  "message.reason.fileLost": "فُقد الملف عند إعادة تحميل الصفحة",

  // ---------------------------------------------------------------------
  // Passing messages of the call (`CallView.notice`)
  // ---------------------------------------------------------------------
  "notice.videoDeclined": "لم يقبل {peer} الفيديو",
  "notice.videoRefused": "رفض {peer} إضافة الفيديو إلى هذه المكالمة",
  "notice.videoAdded": "أضاف {peer} الفيديو",
  "notice.videoRemoved": "أزال {peer} الفيديو",
  "notice.videoDeclinedHere": "تم رفض الفيديو",
  "notice.videoUnavailable": "يتعذّر إضافة الفيديو في الوقت الحالي",
  "notice.shareRefused": "لم يقبل {peer} مشاركة الشاشة",
  "notice.shareUnavailable": "يتعذّر بدء مشاركة الشاشة في الوقت الحالي",
  "notice.sharePeerStarted": "يشارك {peer} شاشته",
  "notice.sharePeerStopped": "أوقف {peer} مشاركة شاشته",
  "notice.shareDeclinedHere": "تم رفض المشاركة",
  "notice.audioDeclined": "لم يقبل {peer} الصوت",
  "notice.audioRefused": "يرفض {peer} إضافة الصوت إلى هذه المكالمة",
  "notice.audioAdded": "أضاف {peer} الصوت",
  "notice.audioRemoved": "أزال {peer} الصوت",
  "notice.audioDeclinedHere": "تم رفض الصوت",
  "notice.audioUnavailable": "يتعذّر إضافة الصوت في الوقت الحالي",
  "notice.dtmfFailed": "تعذّر إرسال النغمة {tone}",

  // ---------------------------------------------------------------------
  // Real-time text: the thread's notes and the transcript (`core/conversation.ts`)
  // ---------------------------------------------------------------------
  "chat.you": "أنت",
  "chat.note.opened": "فُتح النصّ الفوري",
  "chat.note.lost": "ضاع نصّ أثناء الانقطاع",
  "chat.note.broken": "انقطع اتصال النصّ — جارٍ الاستئناف",
  "chat.note.closed": "أُغلِق النصّ الفوري",
  "chat.note.refused": "لا يدعم هذا المراسِل النصّ الفوري",
  "chat.note.alert": "وصل تنبيه",
  "chat.log.title": "المحادثة — {target}",
  "chat.log.vttBase": "الأوقات محسوبة من بداية المكالمة — مكالمة {at}.",
  "chat.log.cut": "بداية المحادثة غير محفوظة",

  // ---------------------------------------------------------------------
  // Reachability (ADR 0006): the sentence of `reachSentence`
  // ---------------------------------------------------------------------
  "reach.none": "لا يمكنك استقبال المكالمات.",

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
