/**
 * Dictionnaire arabe (arabe standard moderne, الفصحى).
 *
 * Commentaires en français, comme le reste du dépôt : ils s'adressent à qui
 * maintient cette traduction en regard du français de référence, pas à qui
 * la lit à l'écran.
 *
 * Ce n'est pas un décalque du français. Trois écarts assumés :
 *
 * - **Les libellés d'action sont des noms verbaux** (مصدر), pas des
 *   impératifs : « إنهاء المكالمة », non « أنهِ المكالمة ». C'est la forme
 *   des boutons dans toutes les interfaces arabes sérieuses ; l'impératif
 *   y sonne comme un ordre donné à l'utilisateur.
 * - **Les états en cours prennent « جارٍ… »** — « جارٍ التسجيل… » pour
 *   « Enregistrement… » —, qui rend le progressif que l'arabe n'a pas.
 * - **L'arabe ignore la majuscule.** Le « kicker » de l'appel entrant,
 *   capitalisé en français par le CSS (`text-transform`), ne peut compter
 *   que sur son corps et son interlettrage ; le texte, lui, se suffit
 *   d'être court et sans ambiguïté.
 *
 * Le pluriel demande six formes (`zero`, `one`, `two`, `few`, `many`,
 * `other`) là où le français en compte deux. `tn()` les choisit par
 * `Intl.PluralRules` ; celles que le français n'a pas sont déclarées ici et
 * nulle part ailleurs (voir `Translation` dans `../types.ts`). D'où, pour
 * les formes `one` et `two`, un libellé **sans `{n}`** : « depuis une
 * minute », « depuis deux minutes » — l'arabe porte le nombre dans le mot,
 * et répéter le chiffre serait une faute de langue, pas une économie.
 *
 * Le sens d'écriture ne se règle pas ici : `useLocale()` pose `dir="rtl"`
 * sur `<html>` d'après la balise, et la mise en page suit (propriétés
 * logiques du CSS). Les formats de date et d'heure viennent d'`Intl` avec
 * la balise `ar` : le système de numération est celui que CLDR associe à la
 * langue — chiffres arabes orientaux (١٤:٣٢) dans les navigateurs, qui les
 * embarquent tous.
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
  "lang.label": "لغة الواجهة",
  "lang.auto": "تلقائيًا (لغة المتصفّح)",
  "lang.autoDetected": "تلقائيًا — {name}",
  "lang.hint": "يتبع خيار «تلقائيًا» لغة متصفّحك.",

  // ---------------------------------------------------------------------
  // Titres d'onglet des écrans sans état de téléphone
  // ---------------------------------------------------------------------
  "screen.settings": "الإعدادات",
  "screen.saving": "جارٍ الحفظ…",

  // ---------------------------------------------------------------------
  // Écran d'accueil
  // ---------------------------------------------------------------------
  "home.tagline": "هاتف ويب للمحادثة الشاملة",
  "home.useAccount": "استخدام هذا الحساب",
  "home.newAccount": "إعداد حساب جديد",
  "home.version": "الإصدار {version}",
  "fsl.aria": "مدعوم بـ FSL — finite-state-language على GitHub (نافذة جديدة)",

  // ---------------------------------------------------------------------
  // Écran de configuration
  // ---------------------------------------------------------------------
  "config.title": "الإعدادات",
  "config.section.account": "حساب SIP",
  "config.proxy": "خادم SIP",
  "config.proxyPlaceholder": "wss://sip.example.fr:8443/ws",
  "config.uri": "عنوان SIP",
  "config.uriPlaceholder": "sip:alice@example.fr",
  "config.uriHint": "مع البادئة «sip:» أو من دونها. ويُستخدم النطاق مجالَ مصادقة (realm).",
  "config.displayName": "اسمك",
  "config.authToggle": "معرّف المصادقة (إن اختلف عن {user})",
  "config.authUserDefault": "اسم المستخدم في العنوان",
  "config.password": "كلمة المرور",
  "config.passwordSet": "•••••• (محفوظة من قبل)",
  "config.passwordKeep": "اتركها فارغة للإبقاء على كلمة المرور الحالية.",
  "config.ha1Note":
    "لا تُحفَظ كلمة المرور؛ لا يُخزَّن في هذا المتصفّح سوى بصمتها (HA1) مشفَّرةً.",

  "config.section.nat": "اجتياز NAT",
  "config.natHint":
    "خوادم يوفّرها مشغّل SIP لديك. من دونها قد تنجح مكالمة بين شبكتين خاصّتين من دون أن يمرّ أيّ صوت.",
  "config.stun": "خادم STUN",
  "config.stunPlaceholder": "stun.example.fr:3478",
  "config.stunHint": "اختياري. المضيف وحده أو المضيف:المنفذ — وبلا منفذ يُستخدم 3478.",
  "config.turn": "خادم TURN",
  "config.turnPlaceholder": "turn.example.fr:3478",
  "config.turnHint":
    "اختياري — لترحيل تدفّقات الوسائط عند تعذّر الاتصال المباشر. اتركه فارغًا لعدم استخدام أيّ مُرحِّل.",
  "config.turnUser": "معرّف TURN",
  "config.turnPass": "كلمة مرور TURN",
  "config.turnPassKeep": "اتركها فارغة للإبقاء على كلمة المرور الحالية.",
  "config.turnTlsLabel": "TURN عبر TLS",
  "config.turnTlsDesc": " — ترحيل مشفَّر («turns:») يمرّ حيث لا يُسمح إلا بحركة TLS",
  "config.turnTlsHint": "ومن دون منفذ صريح، يُستخدم عندئذٍ 5349 بدل 3478.",
  "config.turnNote":
    "أما كلمة مرور TURN فتُحفَظ (مشفَّرة): إذ يطلب المُرحِّل السرّ نفسه في كل مكالمة، ولا تكفيه بصمة.",

  "config.section.alerts": "التنبيهات والعرض",
  "config.alertsHint":
    "تسري هذه الإعدادات فورًا من دون انتظار الحفظ — ما عدا الوميض، فهو تابع للحساب.",
  "config.flashLabel": "وميض مرئيّ عند ورود مكالمة",
  "config.flashDesc": " — تومض الشاشة أثناء الرنين للتنبيه من دون صوت",
  "config.flashHint": "يُحفَظ مع الحساب: فيرافقك من جهاز إلى آخر.",
  "config.notifications": "إشعارات النظام",
  "config.notifEnable": "تفعيل الإشعارات",
  "config.notifHint": "من دونها لا يستطيع Trix تنبيهك عندما تكون النافذة مخفيّة أو مصغَّرة.",
  "config.notifOn": "الإشعارات مفعَّلة",
  "config.notifBlocked": "الإشعارات محظورة من المتصفّح",
  "config.notifBlockedHint":
    "يلزم استعادتها من إعدادات الموقع في المتصفّح: لا يستطيع Trix طلب الإذن من جديد بنفسه.",
  "config.theme": "المظهر",
  "config.themeHint": "يتبع خيار «النظام» إعداد الفاتح/الداكن في جهازك.",
  "theme.system": "النظام",
  "theme.light": "فاتح",
  "theme.dark": "داكن",
  "config.save": "الحفظ والاتصال",
  "config.saving": "جارٍ الحفظ…",
  "config.cancel": "إلغاء",

  // ---------------------------------------------------------------------
  // État du téléphone (pastille de la barre d'en-tête, titre d'onglet)
  // ---------------------------------------------------------------------
  "status.connecting": "جارٍ الاتصال…",
  "status.registering": "جارٍ التسجيل…",
  "status.ready": "مُسجَّل",
  "status.reconnecting": "جارٍ إعادة الاتصال…",
  "status.sleeping": "في وضع السكون",
  "status.regFailed": "فشل التسجيل",
  "status.unregistering": "جارٍ تسجيل الخروج…",

  // ---------------------------------------------------------------------
  // État de l'appel
  // ---------------------------------------------------------------------
  "call.dialing": "جارٍ الاتصال",
  "call.ringing": "رنين",
  "call.ringingIn": "مكالمة واردة",
  "call.answering": "جارٍ إنشاء الاتصال…",
  "call.connected": "مكالمة جارية",
  "call.hangingup": "جارٍ إنهاء المكالمة",

  // ---------------------------------------------------------------------
  // Écran d'appel
  // ---------------------------------------------------------------------
  "call.targetLabel": "عنوان SIP",
  "call.callerLabel": "المتّصل",
  // Le fragment « <adresse>@domaine » du français est remplacé par une phrase :
  // une suite latine encadrée de chevrons au milieu d'un texte arabe se lit à
  // l'envers une fois l'algorithme bidi passé.
  "call.domainHint": "من دون «@» يُضاف النطاق {domain} إلى العنوان",
  "call.idle": "لا مكالمة جارية — أدخِل عنوان SIP",
  "call.sleeping": "سكون — يُستأنف التسجيل عند الاستيقاظ",
  "call.sleepingShort": "سكون — يُستأنف عند الاستيقاظ",
  "call.retryIn": "إعادة المحاولة بعد 10 ثوانٍ…",
  "call.chooseMode": "اختيار نوع المكالمة",
  "mode.audio.label": "مكالمة صوتية",
  "mode.audio.button": "الاتصال بالصوت",
  "mode.video.label": "مكالمة فيديو",
  "mode.video.button": "الاتصال بالفيديو",
  "chat.strip": "الدردشة — ستتوفّر في المرحلة 4",

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------
  "action.settings": "الإعدادات",
  "action.logout": "تسجيل الخروج",
  "action.retry": "إعادة المحاولة",
  "action.retryNow": "إعادة المحاولة الآن",
  "action.fixSettings": "تصحيح الإعدادات",
  "action.unavailableInCall": " (غير متاح أثناء المكالمة)",

  // ---------------------------------------------------------------------
  // Commandes média (barre de surimpression)
  // ---------------------------------------------------------------------
  "ctrl.mic.aria": "الميكروفون",
  "ctrl.mic.mute": "كتم الميكروفون",
  "ctrl.mic.unmute": "إلغاء كتم الميكروفون",
  "ctrl.cam.aria": "الكاميرا",
  "ctrl.cam.mute": "إيقاف الكاميرا",
  "ctrl.cam.unmute": "تشغيل الكاميرا",
  "ctrl.selfview.aria": "صورتك",
  "ctrl.selfview.hide": "إخفاء صورتك",
  "ctrl.selfview.show": "إظهار صورتك",
  "ctrl.speaker.aria": "مكبّر الصوت",
  "ctrl.speaker.mute": "كتم الصوت",
  "ctrl.speaker.unmute": "إلغاء كتم الصوت",
  "ctrl.dtmf.aria": "لوحة أرقام DTMF",
  "ctrl.dtmf.label": "لوحة أرقام DTMF — ستتوفّر في المرحلة 4",
  "ctrl.fullscreen": "ملء الشاشة",
  "ctrl.hangup": "إنهاء المكالمة",

  // ---------------------------------------------------------------------
  // Panneau latéral
  // ---------------------------------------------------------------------
  "panel.aria": "اللوحة الجانبية",
  "panel.showChat": "إظهار الدردشة",
  "panel.hide": "إخفاء اللوحة الجانبية",
  "panel.handleAria": "عرض اللوحة",
  "panel.handleTitle": "اسحب لتوسيع اللوحة — حتى 33٪ من عرض الشاشة",

  // ---------------------------------------------------------------------
  // Préférences d'affichage en cours d'appel
  // ---------------------------------------------------------------------
  "prefs.fontSize": "حجم النص",
  "prefs.fontDown": "تصغير النص",
  "prefs.fontUp": "تكبير النص",

  // ---------------------------------------------------------------------
  // Appel entrant (popup modale)
  // ---------------------------------------------------------------------
  "incoming.kicker.video": "مكالمة فيديو واردة",
  "incoming.kicker.audio": "مكالمة صوتية واردة",
  "incoming.answerVideo": "الرد بالفيديو",
  "incoming.answerAudio": "الرد بالصوت",
  "incoming.reject": "رفض المكالمة",

  // ---------------------------------------------------------------------
  // Alerte d'appel entrant (titre d'onglet, notification système)
  // ---------------------------------------------------------------------
  "alert.title": "📞 مكالمة واردة — {caller}",
  "alert.notifTitle": "مكالمة واردة",
  "alert.notifVideo": "{caller} — مكالمة فيديو",
  "alert.notifAudio": "{caller} — مكالمة صوتية",

  // ---------------------------------------------------------------------
  // Annonces aux lecteurs d'écran
  // ---------------------------------------------------------------------
  // Six formes : « دقيقة » au singulier, « دقيقتان » au duel, « دقائق » de
  // trois à dix, puis « دقيقة » de nouveau au-delà. Les deux premières se
  // passent du chiffre — le mot le porte.
  "announce.inCall.zero": "في مكالمة منذ أقل من دقيقة",
  "announce.inCall.one": "في مكالمة منذ دقيقة واحدة",
  "announce.inCall.two": "في مكالمة منذ دقيقتين",
  "announce.inCall.few": "في مكالمة منذ {n} دقائق",
  "announce.inCall.many": "في مكالمة منذ {n} دقيقة",
  "announce.inCall.other": "في مكالمة منذ {n} دقيقة",

  // ---------------------------------------------------------------------
  // Historique d'appels
  // ---------------------------------------------------------------------
  "history.title": "السجلّ",
  "history.clear": "مسح",
  "history.empty": "لا مكالمات مسجَّلة",
  "history.entryTitle": "{target} — {outcome}",
  "outcome.answered": "تمّ الردّ",
  "outcome.missed": "فائتة",
  "outcome.failed": "فشلت",
  "outcome.canceled": "أُلغيت",
  "outcome.dropped": "انقطعت",
  "endedBy.local": "أنهيتَ المكالمة",
  "endedBy.remote": "أنهى الطرف الآخر المكالمة",
  "endedBy.network": "قطعتها الشبكة",
  "duration.minSec": "{m} د {s} ث",
  "duration.sec": "{s} ث",

  // ---------------------------------------------------------------------
  // Erreurs des automates (écrites dans le contexte, rendues par l'UI)
  // ---------------------------------------------------------------------
  "error.invalidUri": "عنوان SIP غير صالح (المتوقَّع: user@domain)",
  "error.passwordRequired": "كلمة المرور مطلوبة",
  "error.saveFailed": "تعذّر الحفظ: {detail}",
  "error.invalidProxy": "اسم الوسيط غير صالح — تحقّق من عنوان WSS",
  "error.wssRefused": "تعذّر الاتصال بالوسيط (رُفض اتصال WSS)",
  "error.wssTimeout": "الوسيط لا يستجيب (انتهت مهلة WebSocket)",
  "error.badCredentials": "عنوان SIP أو كلمة المرور أو معرّف المصادقة غير صحيح",
  "error.regRefused": "رُفض التسجيل: {cause}",
  "error.wssLostDuringReg": "انقطع الاتصال أثناء التسجيل",
  "error.registrarTimeout": "خادم التسجيل لا يستجيب",
  "error.regLost": "فُقد التسجيل: {cause}",
  "error.proxyLost": "انقطع الاتصال بالوسيط",
  "error.proxyLostDuringCall": "انقطع الاتصال بالوسيط أثناء المكالمة",
  "error.callDropped": "انقطعت المكالمة — فُقد الاتصال بالوسيط",
  "error.stunInvalid": "خادم STUN غير صالح (المتوقَّع: المضيف أو المضيف:المنفذ)",
  "error.turnInvalid": "خادم TURN غير صالح (المتوقَّع: المضيف أو المضيف:المنفذ)",
  "error.turnUserRequired": "معرّف TURN مطلوب (المُرحِّل يطلب المصادقة دائمًا)",
  "error.turnPasswordRequired": "كلمة مرور TURN مطلوبة",

  // ---------------------------------------------------------------------
  // Motifs de fin d'appel (affichés près du champ d'adresse et en historique)
  // ---------------------------------------------------------------------
  "reason.hungUp": "أُنهيت المكالمة",
  "reason.sleep": "الدخول في وضع السكون",
  "reason.noAnswer": "لا ردّ",
  "reason.declined": "رُفضت المكالمة",
  "reason.missed": "مكالمة فائتة",
  "reason.missedNoAnswer": "مكالمة فائتة (بلا ردّ)",
  "reason.setupFailed": "تعذّر إنشاء المكالمة",
  "reason.callFailed": "تعذّر إجراء المكالمة: {detail}",
  "reason.sip": "{cause} (SIP {code})",

  "misc.raw": "{text}",
};

export default messages;
