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
  "screen.deleting": "جارٍ الحذف…",

  // ---------------------------------------------------------------------
  // Écran d'accueil
  // ---------------------------------------------------------------------
  "home.tagline": "هاتف ويب للمحادثة الشاملة",
  "home.useAccount": "استخدام هذا الحساب",
  "home.newAccount": "إعداد حساب جديد",
  "home.addAccount": "إضافة حساب",
  "home.editAccount": "تعديل",
  "home.version": "الإصدار {version}",
  "fsl.aria": "مدعوم بـ FSL — finite-state-language على GitHub (نافذة جديدة)",

  // ---------------------------------------------------------------------
  // Écran de configuration
  // ---------------------------------------------------------------------
  "config.title": "الإعدادات",
  "config.titleNew": "حساب جديد",
  "config.section.account": "حساب SIP",
  "config.proxy": "خادم SIP",
  "config.proxyPlaceholder": "wss://sip.example.fr:8443/ws",
  "config.uri": "عنوان SIP",
  "config.uriPlaceholder": "sip:alice@example.fr",
  "config.uriHint": "مع البادئة «sip:» أو من دونها. ويُستخدم النطاق مجالَ مصادقة (realm).",
  "config.uriHintDomain":
    "لا تُقبَل هنا إلا العناوين ضمن النطاق {domain}. ويُستخدم هذا النطاق مجالَ مصادقة (realm).",
  "config.displayName": "اسمك",
  "config.authToggle": "معرّف المصادقة (إن اختلف عن {user})",
  "config.authUserDefault": "اسم المستخدم في العنوان",
  "config.password": "كلمة المرور",
  "config.passwordSet": "•••••• (محفوظة من قبل)",
  "config.passwordKeep": "اتركها فارغة للإبقاء على كلمة المرور الحالية.",
  "config.ha1Note":
    "لا تُحفَظ كلمة المرور؛ لا يُخزَّن في هذا المتصفّح سوى بصمتيها (HA1 بخوارزميتي MD5 و‏SHA-256) مشفَّرتين.",
  "config.share": "مشاركة الحساب",
  "config.shareCopy": "نسخ رابط المشاركة",
  "config.shareWarn":
    "يحمل هذا الرابط ما يكفي للمصادقة على هذا الحساب: فهو يعادل كلمة المرور. لا تُرسله إلّا لمن يحتاج إليه، وعبر وسيلة آمنة.",
  "config.shareCopied": "نُسِخ رابط المشاركة",
  "config.shareManual": "رابط المشاركة، للنسخ",

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

  "config.section.rtt": "النصّ في الزمن الحقيقي",
  "config.rttHint":
    "يُكتَب النصّ ويُقرَأ حرفًا بحرف أثناء المكالمة. أمّا الطريق الذي يسلكه فيتوقّف على المنصّة التي تتّصل بها.",
  "config.rttTransport": "النقل",
  "config.rttNone": "بلا",
  "config.rttNoneDesc": " — تجري المكالمة كما كانت: لا يُضاف شيء إلى ما يُتفاوَض عليه",
  "config.rttWs": "عبر WebSocket",
  "config.rttWsDesc":
    " — الصيغة غير القياسيّة للبوّابات المنشورة سلفًا: وهي ما تفهمه الخدمات القائمة",
  "config.rttDc": "عبر قناة البيانات",
  "config.rttDcDesc":
    " — المعيار (RFC 8865)، وهو الخيار للتحدّث إلى عميل نصّ في الزمن الحقيقي قياسيّ",
  "config.rttNote":
    "يُحفَظ مع الحساب. عند الشكّ اتركه على «بلا»: فعرض النصّ يغيّر عرض كلّ مكالماتك، وقد يسيء خادم لا يتوقّعه فهمَ ذلك.",

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
  "config.reachLabel": "نبّهني عندما أصبح غير قابل للاتصال",
  "config.reachDesc":
    " — إشعار من النظام عندما يُنيم المتصفّح علامة التبويب أو يسقط التسجيل، وإشعار آخر عند عودة كل شيء",
  "config.reachHint":
    "الإذن نفسه المستخدَم للمكالمات الواردة، لكن الإعداد منفصل: أن تُنبَّه بأن أحدهم يتصل بك شيء، وأن تُنبَّه بأنه لم يعد بإمكان أحد ذلك شيء آخر.",
  "config.theme": "المظهر",
  "config.themeHint": "يتبع خيار «النظام» إعداد الفاتح/الداكن في جهازك.",
  "theme.system": "النظام",
  "theme.light": "فاتح",
  "theme.dark": "داكن",

  // التشخيص — إعدادات محلّية لا تُحفَظ مع الحساب
  "config.section.diag": "التشخيص",
  "config.traceLabel": "تتبّع رسائل SIP",
  "config.traceDesc":
    " — تُعرَض في طرفية المتصفّح كلّ حزمة مُرسَلة ومُستقبَلة، وكذلك الحالات الّتي تمرّ بها المكالمة",
  "config.traceHint":
    "يسري المفعول فورًا، حتّى أثناء مكالمة جارية: افتح الطرفية (F12) لقراءة الحزم. تحتفظ كلّ مكالمة أيضًا بحزمها في سجلّها، مُعمّاةً، إلى أن تمسحه. تحمل هذه الحزم عنوان SIP الخاصّ بك وبمُراسليك، فاحذفها من أيّ تقرير علّة عموميّ.",
  "config.save": "الحفظ والاتصال",
  "config.saving": "جارٍ الحفظ…",
  "config.cancel": "إلغاء",
  "config.delete": "حذف هذا الحساب",
  "config.deleteConfirm": "تأكيد: حذف {address} وسجلّ مكالماته",

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
  "status.switching": "جارٍ تبديل الحساب…",
  "presence.available": "متاح",
  "presence.busy": "مشغول",
  "presence.onThePhone": "في مكالمة",
  "presence.away": "غائب",
  "presence.dnd": "عدم الإزعاج",
  "presence.offline": "غير متصل",
  "presence.unknown": "الحالة غير معروفة",
  "presence.invisible": "مخفي",
  "presenceMenu.label": "حالتي",
  "presenceMenu.seen": "ما تراه جهات اتصالك",
  "presenceMenu.busyHint": "تصلك المكالمات كالمعتاد",
  "presenceMenu.dndHint": "تُرفض المكالمات الواردة وتُسجَّل في السجل",
  "presenceMenu.invisibleHint": "تظهر غير متصل، لكن يمكن الوصول إليك",
  "presenceMenu.note": "ملاحظة تظهر لجهات اتصالك",
  "presenceMenu.clearNote": "امسح الملاحظة",
  "presenceMenu.auto": "تلقائيًا",
  "presenceMenu.onThePhone": "«في مكالمة» أثناء المكالمة",
  "presenceMenu.onThePhoneHint": "ثم العودة إلى حالتك المختارة عند إنهاء المكالمة",
  "presenceMenu.awayWhenIdle": "«غائب» بعد 10 دقائق دون نشاط",
  "presenceMenu.sleepHint": "في وضع السكون تُلغي الصفحة تسجيلها، فتراك جهات اتصالك غير متصل مهما كان اختيارك هنا.",
  "presenceMenu.noPublish": "هذا الخادم لا ينشر حالتك: لا تراها جهات اتصالك.",
  "announce.statusChanged": "الحالة: {status}",

  // ---------------------------------------------------------------------
  // إمكانية الوصول إليك (ADR 0006)
  // ---------------------------------------------------------------------
  "reach.none": "لا يمكنك استقبال المكالمات.",
  "reach.title": "غير قابل للاتصال — Trix",
  "reach.notifTitle": "لم يعد Trix قادرًا على استقبال المكالمات",
  "reach.notifFreeze":
    "أنام المتصفّح علامة التبويب هذه. ستبقى غير قابل للاتصال حتى تعود إليها.",
  "reach.notifSystem":
    "دخل الحاسوب في وضع السكون. ستبقى غير قابل للاتصال حتى يستيقظ.",
  "reach.notifOffline":
    "انقطع الاتصال بالشبكة. ستبقى غير قابل للاتصال حتى يعود.",
  "reach.notifDiscard":
    "تخلّص المتصفّح من علامة التبويب هذه لتحرير الذاكرة. عُد إلى Trix ليُعاد التسجيل.",
  "reach.notifLost":
    "فُقد التسجيل. ستبقى غير قابل للاتصال حتى يُستعاد.",
  "reach.backTitle": "بات Trix قادرًا على استقبال مكالماتك من جديد",
  "reach.back": "استُؤنف التسجيل: صرت قابلًا للاتصال من جديد.",
  "reach.discarded":
    "أنام المتصفّح Trix توفيرًا للذاكرة: لم تكن قادرًا على استقبال المكالمات من {from} إلى {to}.",
  "reach.pinHint":
    "لتفادي ذلك: ثبّت علامة التبويب هذه، وأضف Trix إلى «المواقع النشطة دائمًا» في متصفّحك.",
  "reach.dismiss": "إخفاء هذه الرسالة",

  // ---------------------------------------------------------------------
  // État de l'appel
  // ---------------------------------------------------------------------
  "call.dialing": "جارٍ الاتصال",
  "call.ringing": "رنين",
  "call.earlyMedia": "رسالة من الشبكة",
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
  "mode.text.label": "مكالمة نصية",
  "mode.text.button": "الاتصال بالنص",
  "chat.strip": "تُفتح الدردشة مع المكالمة",
  "chat.stripRefused": "لم يقبل المراسِل النصّ الفوري",
  // ---------------------------------------------------------------------
  // دردشة النص الفوري (T.140)
  // ---------------------------------------------------------------------
  "chat.tab": "الدردشة",
  "chat.aria": "محادثة مع {peer}",
  "chat.you": "أنت",
  "chat.typing": "يكتب الآن",
  "chat.announce": "{who}: {text}",
  "chat.jump.zero": "النزول إلى الأسفل",
  "chat.jump.one": "النزول إلى الأسفل — رسالة واحدة",
  "chat.jump.two": "النزول إلى الأسفل — رسالتان",
  "chat.jump.few": "النزول إلى الأسفل — {n} رسائل",
  "chat.jump.many": "النزول إلى الأسفل — {n} رسالة",
  "chat.jump.other": "النزول إلى الأسفل — {n} رسالة",
  "chat.composerAria": "رسالة نصّ فوري",
  "chat.placeholder": "اكتب — يُرسَل النصّ أثناء الكتابة",
  "chat.placeholderClosed": "النصّ غير متاح في هذه المكالمة",
  "chat.placeholderEarly": "للقراءة فقط حتى يتم الرد على المكالمة",
  "chat.enterHint": "مفتاح الإدخال يُثبّت الفقاعة",
  "chat.state.open": "يُرسَل أثناء الكتابة",
  "chat.state.connecting": "جارٍ فتح النصّ الفوري…",
  "chat.state.lost": "انقطع الاتصال — جارٍ الاستئناف",
  "chat.state.closed": "أُغلِق النصّ الفوري",
  "chat.state.refused": "لا يدعم هذا المراسِل النصّ الفوري",
  "chat.state.pending": "التصحيح خلال {s} ثانية",
  "chat.note.opened": "فُتح النصّ الفوري",
  "chat.note.lost": "ضاع نصّ أثناء الانقطاع",
  "chat.note.broken": "انقطع اتصال النصّ — جارٍ الاستئناف",
  "chat.note.closed": "أُغلِق النصّ الفوري",
  "chat.note.refused": "لا يدعم هذا المراسِل النصّ الفوري",
  "chat.note.alert": "وصل تنبيه",

  "chat.log.open": "قراءة محادثة هذه المكالمة",
  "chat.log.title": "المحادثة — {target}",
  "chat.log.count.zero": "لا رسائل",
  "chat.log.count.one": "رسالة واحدة",
  "chat.log.count.two": "رسالتان",
  "chat.log.count.few": "{n} رسائل",
  "chat.log.count.many": "{n} رسالة",
  "chat.log.count.other": "{n} رسالة",
  "chat.log.copy": "نسخ",
  "chat.log.copied": "تمّ النسخ",
  "chat.log.copyFailed": "تعذّر النسخ",
  "chat.log.export": "تصدير",
  "chat.log.exportFailed": "تعذّر التصدير",
  "chat.log.close": "إغلاق",
  "chat.log.vttBase": "الأوقات محسوبة من بداية المكالمة — مكالمة {at}.",
  "chat.log.cut": "بداية المحادثة غير محفوظة",

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------
  "action.settings": "الإعدادات",
  "action.logout": "تسجيل الخروج",
  "action.retry": "إعادة المحاولة",
  "action.retryNow": "إعادة المحاولة الآن",
  "action.fixSettings": "تصحيح الإعدادات",
  "action.unavailableInCall": " (غير متاح أثناء المكالمة)",
  "action.switchAccount": "الانتقال إلى الحساب {address}",

  // ---------------------------------------------------------------------
  // Commandes média (barre de surimpression)
  // ---------------------------------------------------------------------
  "ctrl.mic.aria": "الصوت",
  "ctrl.mic.add": "إضافة الصوت",
  "ctrl.mic.remove": "إزالة الصوت",
  "ctrl.cam.aria": "الفيديو",
  "ctrl.cam.add": "إضافة الفيديو",
  "ctrl.cam.remove": "إزالة الفيديو",
  "ctrl.share.aria": "مشاركة الشاشة",
  "ctrl.share.start": "مشاركة الشاشة",
  "ctrl.share.stop": "إيقاف المشاركة",
  "ctrl.share.busy": "المحادث يشارك شاشته بالفعل",
  "ctrl.media.pending": "جارٍ تغيير الوسائط…",
  "ctrl.media.last": "غير ممكن: لن تحمل المكالمة أي وسيط",
  "ctrl.selfview.aria": "صورتك",
  "ctrl.selfview.hide": "إخفاء صورتك",
  "ctrl.selfview.show": "إظهار صورتك",
  "share.stageAria": "شاشة يشاركها {peer}",
  "share.zoomGroup": "تكبير الشاشة المشتركة",
  "share.zoomIn": "تكبير الشاشة المشتركة",
  "share.zoomOut": "تصغير الشاشة المشتركة",
  "share.zoomReset": "العودة إلى الحجم الأصلي",
  "share.zoomLevel": "‏{n} ٪",
  "share.zoomHint": "اقرص للتكبير، واستخدم مفاتيح الأسهم للتنقّل",
  "ctrl.swap.aria": "تبديل الشاشة والصورة",
  "ctrl.swap.screen": "تكبير الشاشة المشتركة",
  "ctrl.swap.face": "تكبير صورة المحادث",
  "ctrl.speaker.aria": "الاستماع على هذا الجهاز",
  "ctrl.speaker.mute": "إيقاف الاستماع",
  "ctrl.speaker.unmute": "استئناف الاستماع",
  "ctrl.dtmf.aria": "لوحة أرقام DTMF",
  "ctrl.dtmf.show": "إظهار لوحة أرقام DTMF",
  "ctrl.dtmf.hide": "إخفاء لوحة أرقام DTMF",
  "ctrl.chat.aria": "الدردشة",
  "ctrl.chat.show": "إظهار الدردشة",
  "ctrl.chat.hide": "إخفاء الدردشة",
  "ctrl.chat.unavailable": "لم يقبل المراسِل النصّ الفوري",
  "ctrl.fullscreen": "ملء الشاشة",
  "ctrl.hangup": "إنهاء المكالمة",
  "ctrl.pause": "إيقاف مؤقت",
  "ctrl.pause.aria": "إيقاف مؤقت",
  "ctrl.resume": "استئناف",
  "pause.banner": "أنت في وضع الإيقاف المؤقت",
  "pause.hint": "الميكروفون والصورة متوقفان. أما النص فيستمر.",
  "pause.resume": "استئناف",
  "pause.peer": "{peer} في وضع الإيقاف المؤقت",
  "ctrl.group.call": "وسائط المكالمة",
  "ctrl.group.device": "هذا الجهاز",
  "ctrl.more": "عناصر تحكم أخرى",
  "sheet.title": "عناصر تحكم أخرى بالمكالمة",

  // ---------------------------------------------------------------------
  // Clavier DTMF
  // ---------------------------------------------------------------------
  "dtmf.aria": "لوحة أرقام DTMF",
  "dtmf.sent": "النغمات المُرسَلة",
  "dtmf.hint": "اطلب بالأزرار أو بلوحة المفاتيح",
  "dtmf.keyAria": "المفتاح {key}",
  "dtmf.star": "نجمة",
  "dtmf.hash": "مربّع",

  // ---------------------------------------------------------------------
  // طلب إضافة الفيديو أثناء المكالمة
  // ---------------------------------------------------------------------
  "mediaask.video.title": "يريد {peer} إضافة الفيديو",
  "mediaask.video.body": "ستؤدي الموافقة إلى تشغيل الكاميرا.",
  "mediaask.video.accept": "قبول الفيديو",
  "mediaask.audio.title": "يريد {peer} إضافة الصوت",
  "mediaask.audio.body": "ستؤدي الموافقة إلى تشغيل الميكروفون.",
  "mediaask.audio.accept": "قبول الصوت",
  "mediaask.both.title": "يريد {peer} إضافة الصوت والفيديو",
  "mediaask.both.body": "ستؤدي الموافقة إلى تشغيل الميكروفون والكاميرا.",
  "mediaask.both.accept": "قبول كليهما",
  "mediaask.share.title": "يريد {peer} مشاركة شاشته",
  "mediaask.share.body": "ستشغل شاشته المساحة الكبيرة، وستنتقل صورته إلى مربّع صغير. الرفض لا يغيّر شيئًا في المكالمة.",
  "mediaask.share.accept": "عرض الشاشة",
  "mediaask.reject": "رفض",

  // ---------------------------------------------------------------------
  // رسائل عابرة أثناء المكالمة
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
  // Panneau latéral
  // ---------------------------------------------------------------------
  "panel.aria": "اللوحة الجانبية",
  "panel.showChat": "إظهار الدردشة",
  "panel.show": "إظهار اللوحة الجانبية",
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
  "incoming.kicker.audioText": "مكالمة صوتية ونصية واردة",
  "incoming.kicker.videoText": "مكالمة فيديو ونصية واردة",
  "incoming.kicker.text": "مكالمة نصية واردة",
  "incoming.answerVideo": "الرد بالفيديو",
  "incoming.answerAudio": "الرد بالصوت",
  "incoming.answerText": "الرد بالنص",
  "incoming.reject": "رفض المكالمة",

  // ---------------------------------------------------------------------
  // Alerte d'appel entrant (titre d'onglet, notification système)
  // ---------------------------------------------------------------------
  "alert.title": "📞 مكالمة واردة — {caller}",
  "alert.notifTitle": "مكالمة واردة",
  "alert.notifVideo": "{caller} — مكالمة فيديو",
  "alert.notifAudio": "{caller} — مكالمة صوتية",
  "alert.notifText": "{caller} — مكالمة نصية",

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

  // دفتر المكالمة: حزم SIP المحفوظة عندما كان التتبّع مُفعَّلًا
  "trace.open": "عرض تتبّع SIP لهذه المكالمة",
  "trace.title": "تتبّع SIP — {target}",
  "trace.count.zero": "لا حزم",
  "trace.count.one": "حزمة واحدة",
  "trace.count.two": "حزمتان",
  "trace.count.few": "{n} حزم",
  "trace.count.many": "{n} حزمة",
  "trace.count.other": "{n} حزمة",
  "trace.sent": "مُرسَلة",
  "trace.received": "مُستقبَلة",
  "trace.error": "خطأ WebRTC",
  "trace.copy": "نسخ",
  "trace.copied": "تمّ النسخ",
  "trace.copyFailed": "تعذّر النسخ",
  "trace.close": "إغلاق",
  "trace.clipped": "… (حزمة مقطوعة)",
  "trace.truncated": "توقّف التتبّع: تجاوزت المكالمة الحدّ المحفوظ لكلّ مكالمة.",
  "outcome.answered": "تمّ الردّ",
  "outcome.missed": "فائتة",
  "outcome.failed": "فشلت",
  "outcome.canceled": "أُلغيت",
  "outcome.dropped": "انقطعت",
  "outcome.declined": "رُفضت",
  "endedBy.local": "أنهيتَ المكالمة",
  "endedBy.remote": "أنهى الطرف الآخر المكالمة",
  "endedBy.network": "قطعتها الشبكة",
  "duration.minSec": "{m} د {s} ث",
  "duration.sec": "{s} ث",

  // ---------------------------------------------------------------------
  // Statistiques média (survol de la pastille « En communication »)
  // ---------------------------------------------------------------------
  "stats.hint": "إحصاءات الوسائط لهذه المكالمة",
  "stats.title": "إحصاءات الوسائط",
  "stats.window": "متوسّط على {s} ث",
  "stats.recv": "المستلَم",
  "stats.sent": "المُرسَل",
  "stats.audio": "الصوت",
  "stats.video": "الفيديو",
  "stats.share": "الشاشة المشتركة",
  "stats.text": "نص",
  "stats.missing": "نص مفقود",
  "stats.codec": "الترميز",
  "stats.bitrate": "معدّل البتّ",
  "stats.loss": "الفقد",
  "stats.rtt": "زمن الذهاب والإياب",
  "stats.sync": "الفارق بين الصوت والصورة",
  "stats.syncHint": "دون {n} مللي ثانية، تبقى قراءة الشفاه ولغة الإشارة مريحة (F.703 §5.2.2).",
  "stats.lossNote": "فقد الإرسال وفق تقارير الاستقبال الواردة من الطرف الآخر.",
  "stats.pending": "جارٍ القياس…",
  "stats.none": "لا يوجد تدفّق وسائط مقيس",
  "stats.kbps": "{n} كبت/ث",
  "stats.percent": "{n} ٪",
  "stats.ms": "{n} م.ث",
  "stats.khz": "{n} كھرتز",
  "stats.spanCall": "متوسّط على {d} مقيسة",
  "stats.open": "إحصاءات الوسائط لهذه المكالمة",
  "stats.callTitle": "إحصاءات الوسائط — {target}",
  "stats.close": "إغلاق",
  "stats.copy": "نسخ",
  "stats.copied": "تمّ النسخ",
  "stats.copyFailed": "تعذّر النسخ",
  "selftest.section": "الميكروفون والكاميرا",
  "selftest.open": "اختبار الميكروفون والكاميرا",
  "selftest.sectionHint": "اختبار خارج المكالمة: اكتشاف ميكروفون صامت الآن أفضل من اكتشافه أثناء المحادثة.",
  "selftest.title": "اختبار الميكروفون والكاميرا",
  "selftest.sub": "لا يُرسَل شيء: يبقى هذا الاختبار على هذا الجهاز.",
  "selftest.close": "إغلاق",
  "selftest.starting": "جارٍ تشغيل الأجهزة…",
  "selftest.hint": "تكلَّم: ينبغي أن يتحرك المؤشر، وأن ترى نفسك في الصورة.",
  "selftest.levelAria": "مستوى الميكروفون",
  "selftest.mic": "الميكروفون",
  "selftest.cam": "الكاميرا",
  "selftest.unnamed": "جهاز بلا اسم",
  "selftest.absent": "لا يوجد",
  "selftest.noCamera": "لا توجد كاميرا: يُختبر الميكروفون وحده.",
  "selftest.denied": "تم رفض الوصول إلى الميكروفون والكاميرا. اسمح به في المتصفح ثم أعد الاختبار.",
  "selftest.missing": "لم يُعثر على ميكروفون أو كاميرا على هذا الجهاز.",
  "selftest.busy": "الميكروفون أو الكاميرا قيد الاستخدام من تطبيق آخر.",
  "selftest.failed": "تعذّر الاختبار: {detail}",

  // ---------------------------------------------------------------------
  // Erreurs des automates (écrites dans le contexte, rendues par l'UI)
  // ---------------------------------------------------------------------
  "error.invalidUri": "عنوان SIP غير صالح (المتوقَّع: user@domain)",
  "error.wrongDomain": "يجب أن يكون هذا العنوان ضمن النطاق {domain}",
  "error.duplicateAccount": "{address} مسجَّل بالفعل في الحساب الآخر",
  "error.passwordRequired": "كلمة المرور مطلوبة",
  "error.saveFailed": "تعذّر الحفظ: {detail}",
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
  "reason.offerUnsupported": "عرض وسائط بدون {detail}: غير متوافق مع WebRTC",
  "reason.callFailed": "تعذّر إجراء المكالمة: {detail}",
  "reason.sip": "{cause} (SIP {code})",

  // ---------------------------------------------------------------------
  // صفحة مشاركة الحساب (share_account.html)
  // ---------------------------------------------------------------------
  "share.title": "حساب مُشارَك",
  "share.intro": "يحمل هذا الرابط إعدادات حساب SIP. تحقّق منها، ثم أنشئ الحساب على هذا الجهاز.",
  "share.address": "عنوان SIP",
  "share.displayName": "الاسم المعروض",
  "share.proxy": "خادم SIP",
  "share.authUsername": "معرّف المصادقة",
  "share.ice": "اجتياز NAT",
  "share.rtt": "النصّ الفوري",
  "share.none": "بلا",
  "share.warn":
    "يحمل هذا الرابط ما يكفي للمصادقة على هذا الحساب. بعد إنشاء الحساب، لا تحتفظ به ولا تُعِد إرساله.",
  "share.create": "إنشاء هذا الحساب",
  "share.creating": "جارٍ الإنشاء…",
  "share.open": "فتح Trix",
  "share.noLink": "لا يحمل هذا الرابط أيّ حساب.",
  "share.malformed":
    "تعذّرت قراءة هذا الرابط: الأرجح أنّه اقتُطع في الطريق. اطلب إرساله كاملًا من جديد.",
  "share.version": "يأتي هذا الرابط من إصدار أحدث من Trix. حدِّث التطبيق لفتحه.",
  "share.wrongDomain": "هذا الحساب ضمن النطاق {domain}، وهو نطاق لا يقبله هذا التنصيب من Trix.",
  "share.exists": "{address} مسجَّل بالفعل على هذا الجهاز. لم يتغيّر شيء.",
  "share.full": "يحتفظ هذا الجهاز بـ {max} حسابات بالفعل. احذف أحدها من الإعدادات قبل إضافة هذا.",
  "share.saveFailed": "تعذّر حفظ الحساب: {detail}",

  "misc.raw": "{text}",
};

export default messages;
