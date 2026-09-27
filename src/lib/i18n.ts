/**
 * Languages: English and Hindi.
 *
 * gettext-style: the English text is the key, so a string that hasn't been
 * translated yet simply shows in English instead of a key name or a blank.
 * Placeholders are {name}; the Hindi must use the same names (tests check it).
 *
 * Tone for the Hindi: how people in India actually talk about music apps —
 * conversational Hindi with the English words everyone already uses left in
 * English (song, playlist, skip, save, mood, beta, app, email, password).
 * Strings marked in HI_REVIEW are ones worth a native read before launch.
 *
 * Mirrored in mobile/src/lib/i18n.ts (scripts/check-mirrors.mjs).
 */

export type Lang = "en" | "hi";

export const LANGS: { id: Lang; label: string; native: string }[] = [
  { id: "en", label: "English", native: "English" },
  { id: "hi", label: "Hindi", native: "हिन्दी" },
];

/** Device/browser language → ours. Anything Hindi means Hindi; everything else English. */
export function detectLang(locales: readonly string[] | string | null | undefined): Lang {
  const list = typeof locales === "string" ? [locales] : locales ?? [];
  return list.some((l) => /^hi\b/i.test(l)) ? "hi" : "en";
}

export function isLang(v: unknown): v is Lang {
  return v === "en" || v === "hi";
}

type Vars = Record<string, string | number>;

function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Translate `text` (the English source) into `lang`, filling {placeholders}. */
export function translate(lang: Lang, text: string, vars?: Vars): string {
  const base = lang === "hi" ? HI[text] ?? text : text;
  return fill(base, vars);
}

/** Placeholder names used in a string, for the consistency test. */
export function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

/** Hindi strings a native speaker should read before launch (tone or word choice). */
export const HI_REVIEW: string[] = [
  "not feeling it?",
  "hate it?",
  ", then push",
  "Haptics",
  "a card every",
  "Last check",
  "Keep them on — I get it",
  "Every song starts at its hook.",
  "hear the hook",
  "Skip the tour",
  "what are you in the mood for?",
  "Not in the beta yet? Apply",
  "Got an invite? Create your account",
  "Hook of the day",
  "{title} · presented by {brand}",
  "obsession?",
  "what do you listen",
  "in?",
  "off the map?",
  "Tender",
  "Sunny",
  "loud room, no thinking",
  "Nothing in here yet. Hit Discover into this — every song you swipe down will land right here.",
];

/** English → Hindi. Keys are the exact English strings used in the apps. */
export const HI: Record<string, string> = {
  // ---- navigation & common
  Home: "होम",
  Discover: "डिस्कवर",
  Settings: "सेटिंग्स",
  Profile: "प्रोफ़ाइल",
  Back: "वापस",
  Close: "बंद करें",
  Cancel: "रद्द करें",
  Done: "हो गया",
  Save: "सेव",
  Next: "आगे",
  Language: "भाषा",
  "Sign in": "साइन इन",
  "Sign out": "साइन आउट",
  Email: "ईमेल",
  Password: "पासवर्ड",
  show: "दिखाएँ",
  hide: "छुपाएँ",
  on: "चालू",
  off: "बंद",

  // ---- deck & gestures
  "Every song starts at its hook.": "हर गाना अपने hook से शुरू होता है।",
  SKIP: "स्किप",
  SAVED: "सेव हुआ",
  "MORE LIKE THIS": "ऐसे और",
  NEVER: "कभी नहीं",
  "Finding more like this": "ऐसे और गाने ढूँढ रहे हैं",
  "Never again": "अब कभी नहीं",
  "keep listening": "सुनते रहें",
  "provided courtesy of iTunes": "iTunes के सौजन्य से",
  PROMOTED: "प्रमोटेड",
  "what are you in the mood for?": "आज कैसा mood है?",
  "push toward a face": "किसी चेहरे की तरफ़ खींचें",
  "hear the hook": "hook सुनें",

  // ---- moods
  Party: "पार्टी",
  Hyped: "जोश",
  Sunny: "खिला-खिला",
  Chill: "सुकून",
  Tender: "नरम",
  Sleepy: "नींद",
  Any: "कोई भी",

  // ---- home
  "Start discovering": "डिस्कवर करना शुरू करें",
  "{n} songs queued for you": "आपके लिए {n} गाने तैयार हैं",
  "What's the mood?": "आज कैसा mood है?",
  "Your library": "आपकी लाइब्रेरी",
  "Fresh for you": "आपके लिए नए",
  "Because you wanted more": "आपको और चाहिए था",
  "Recently saved": "हाल ही में सेव किए",
  "Any — no mood on the deck": "कोई भी — डेक पर कोई mood नहीं",
  "tap to play": "चलाने के लिए टैप करें",
  "Nothing saved yet": "अभी कुछ सेव नहीं किया",
  "Swipe a song down to keep it. Tap here, or hold +, to start a playlist.":
    "गाना रखना है तो नीचे स्वाइप करें। प्लेलिस्ट बनाने के लिए यहाँ टैप करें या + दबाकर रखें।",

  // ---- library & playlists
  "Liked Songs": "पसंदीदा गाने",
  Discoveries: "नई खोजें",
  "{n} song": "{n} गाना",
  "{n} songs": "{n} गाने",
  "~{m} min of music": "~{m} मिनट का संगीत",
  Play: "चलाएँ",
  Shuffle: "शफ़ल",
  Export: "एक्सपोर्ट",
  "Discover into this": "इसमें डिस्कवर करें",
  "Delete playlist": "प्लेलिस्ट हटाएँ",
  "Delete “{title}”?": "“{title}” हटाएँ?",
  "The songs in it leave your library too.": "इसके गाने भी आपकी लाइब्रेरी से हट जाएँगे।",
  "Discovery rules": "डिस्कवरी के नियम",
  "remove {title}": "{title} हटाएँ",
  back: "वापस",
  "strict — no repeats, no buried, no blocked": "सख़्त — न दोहराव, न छोड़े हुए, न ब्लॉक किए",
  strict: "सख़्त",
  "{list} allowed": "{list} की छूट",
  repeats: "दोहराव",
  buried: "छोड़े हुए",
  blocked: "ब्लॉक किए",
  edit: "बदलें",
  "Allow songs to reappear": "गानों को दोबारा आने दें",
  "saved songs can come back around": "सेव किए गाने फिर से आ सकते हैं",
  "Deal buried songs": "छोड़े हुए गाने भी दिखाएँ",
  "left-swiped songs can return": "बाएँ स्वाइप किए गाने लौट सकते हैं",
  "Deal blocked artists": "ब्लॉक किए आर्टिस्ट भी दिखाएँ",
  "blocked artists can return": "ब्लॉक किए आर्टिस्ट लौट सकते हैं",
  "Applies while this playlist is your swipe-down target.": "यह तभी लागू होता है जब नीचे स्वाइप किए गाने इसी प्लेलिस्ट में जाते हैं।",
  collection: "कलेक्शन",
  playlist: "प्लेलिस्ट",
  "saving here": "यहीं सेव हो रहा है",
  "Nothing in here yet. Hit Discover into this — every song you swipe down will land right here.":
    "अभी यहाँ कुछ नहीं है। 'इसमें डिस्कवर करें' दबाएँ — जो भी गाना आप नीचे स्वाइप करेंगे, सीधे यहीं आएगा।",
  "Playing {title}": "{title} चल रहा है",
  "{i} of {n}": "{n} में से {i}",
  "Stop playing {title}": "{title} बंद करें",

  // ---- export
  "Take this playlist anywhere": "यह प्लेलिस्ट कहीं भी ले जाएँ",
  "Copy the list, then paste it into TuneMyMusic or Soundiiz — both are free for playlists this size and can add it to Spotify, Apple Music or YouTube Music.":
    "लिस्ट कॉपी करें, फिर TuneMyMusic या Soundiiz में पेस्ट करें — इस साइज़ की प्लेलिस्ट के लिए दोनों फ्री हैं और इसे Spotify, Apple Music या YouTube Music में जोड़ सकते हैं।",
  "Copy list": "लिस्ट कॉपी करें",
  "Copied": "कॉपी हो गया",
  "Download CSV": "CSV डाउनलोड करें",
  "Share list": "लिस्ट शेयर करें",
  "Open TuneMyMusic": "TuneMyMusic खोलें",
  "Open Soundiiz": "Soundiiz खोलें",
  "1. Copy the list.": "1. लिस्ट कॉपी करें।",
  "2. In TuneMyMusic choose “Free text” as the source and paste.":
    "2. TuneMyMusic में source के तौर पर “Free text” चुनें और पेस्ट करें।",
  "3. Pick where it goes — Spotify, Apple Music, YouTube Music — and confirm.":
    "3. चुनें कहाँ भेजना है — Spotify, Apple Music, YouTube Music — और कन्फ़र्म करें।",

  // ---- indie hook of the week, sponsored mood decks (lib/features.ts)
  "indie hook of the week": "इस हफ़्ते का indie hook",
  "Sponsored": "प्रायोजित",
  "{title} · presented by {brand}": "{title} · {brand} की ओर से",

  // ---- hook of the day
  "Hook of the day": "आज का hook",
  "Picked for you today": "आज आपके लिए चुना गया",
  "Play it": "चलाएँ",
  "Your hook of the day is ready": "आपका आज का hook तैयार है",
  "Notifications": "नोटिफ़िकेशन",
  "Hook of the day notification": "आज के hook का नोटिफ़िकेशन",
  "One song a day, picked for you, at the time you choose.":
    "रोज़ एक गाना, आपके लिए चुना हुआ, आपके चुने समय पर।",
  "Turn on notifications?": "नोटिफ़िकेशन चालू करें?",
  "HookedCue will send one notification a day with a song picked for you. Nothing else, and you can turn it off here any time.":
    "HookedCue रोज़ सिर्फ़ एक नोटिफ़िकेशन भेजेगा, आपके लिए चुने गाने के साथ। इसके अलावा कुछ नहीं, और आप इसे यहीं कभी भी बंद कर सकते हैं।",
  "Turn on": "चालू करें",
  "Not now": "अभी नहीं",
  "Notifications are blocked for HookedCue. Allow them in your phone's settings to get your hook of the day.":
    "HookedCue के नोटिफ़िकेशन बंद हैं। आज का hook पाने के लिए फ़ोन की सेटिंग्स में इन्हें चालू करें।",
  "Show on Home": "होम पर दिखाएँ",
  "Time": "समय",

  // ---- settings
  "App language": "ऐप की भाषा",
  "Follow my phone": "फ़ोन की भाषा के हिसाब से",
  "Follow my browser": "ब्राउज़र की भाषा के हिसाब से",
  Appearance: "दिखावट",
  Playback: "प्लेबैक",
  Gestures: "जेस्चर",
  "Data & privacy": "डेटा और प्राइवेसी",
  "Support HookedCue": "HookedCue को सपोर्ट करें",
  "Delete my account": "मेरा अकाउंट हटाएँ",

  // ---- sign in / access
  "welcome back": "फिर से स्वागत है",
  "Sign in to pick up your library where you left it.": "साइन इन करें और अपनी लाइब्रेरी वहीं से शुरू करें जहाँ छोड़ी थी।",
  "Not in the beta yet? Apply": "अभी बीटा में नहीं हैं? अप्लाई करें",
  "Got an invite? Create your account": "इनवाइट मिला है? अपना अकाउंट बनाएँ",
  "forgot it? send a reset link": "भूल गए? रीसेट लिंक भेजें",
  "Create account": "अकाउंट बनाएँ",
  "Apply for the beta": "बीटा के लिए अप्लाई करें",
  "Your swipes and library sync to the cloud": "आपके स्वाइप और लाइब्रेरी क्लाउड में सेव रहते हैं",

  // ---- onboarding
  "Skip the tour": "टूर छोड़ें",
  "Let's start": "चलिए शुरू करें",
  "Skip this": "इसे छोड़ें",

  // ---- report
  "Report this song": "इस गाने की शिकायत करें",
  "Thanks — we'll look at it.": "धन्यवाद — हम इसे देखेंगे।",

  // ---- greetings & home headline
  "up late": "देर रात तक जाग रहे हो",
  "good morning": "गुड मॉर्निंग",
  "good afternoon": "गुड आफ़्टरनून",
  "good evening": "गुड ईवनिंग",
  "what's your next": "आपका अगला",
  "obsession?": "फ़ेवरेट गाना?",

  // ---- deck stamps & sheets
  skip: "स्किप",
  saved: "सेव",
  "more like this": "ऐसे और",
  never: "कभी नहीं",
  "Hear the whole thing": "पूरा गाना सुनें",
  "Previews stop at 30 seconds; pick where to keep listening.":
    "प्रीव्यू 30 सेकंड में रुक जाता है; चुनें कि आगे कहाँ सुनना है।",
  "preview provided courtesy of iTunes": "प्रीव्यू iTunes के सौजन्य से",
  Promoted: "प्रमोटेड",
  "An independent artist paid to have this song heard. It's labelled so you always know. Turn promoted songs off in Settings → Support.":
    "एक इंडिपेंडेंट आर्टिस्ट ने यह गाना सुनवाने के लिए पैसे दिए हैं। इसलिए इस पर लेबल है ताकि आपको हमेशा पता रहे। प्रमोटेड गाने सेटिंग्स → सपोर्ट में बंद कर सकते हैं।",
  "Cloud sync hiccuped — kept on this device": "क्लाउड सिंक में दिक्कत आई — इस डिवाइस पर सेव है",
  "That track's audio is gone — skipped": "इस गाने का ऑडियो नहीं मिला — स्किप कर दिया",
  "Brought back the last song": "पिछला गाना वापस आ गया",

  // ---- mood lines & time of day
  "shoulders back, volume up": "कंधे पीछे, आवाज़ ऊँची",
  "loud room, no thinking": "तेज़ म्यूज़िक, कोई टेंशन नहीं",
  "good mood, keep it there": "अच्छा mood, बनाए रखो",
  "easy, warm, in the background": "हल्का, सुकून भरा, बैकग्राउंड में",
  "the sad ones, on purpose": "जानबूझकर उदास गाने",
  "lights off, volume down": "लाइट बंद, आवाज़ धीमी",
  "It's late. Something quiet?": "रात हो गई है। कुछ धीमा सुनें?",
  "Morning. Start it bright?": "सुबह हो गई। कुछ ताज़ा सुनें?",
  "Afternoon slump. Something loud?": "दोपहर की सुस्ती। कुछ तेज़ सुनें?",
  "Evening. Turn it up?": "शाम हो गई। आवाज़ बढ़ाएँ?",
  "Winding down. The slow ones?": "दिन ढल रहा है। धीमे गाने?",
  Off: "बंद",
  Suggest: "सुझाव दें",
  "Always on": "हमेशा चालू",
  "The clock never touches the deck": "समय का डेक पर कोई असर नहीं",
  "Offer a mood for the hour; tap to take it": "इस वक़्त के हिसाब से mood सुझाएँ; चाहें तो टैप करें",
  "Lean the deck toward the hour without asking": "बिना पूछे डेक को वक़्त के हिसाब से ढालें",
  "right now that's {mood}, because it's {part}": "अभी {mood}, क्योंकि अभी {part} है",
  late: "देर रात",
  morning: "सुबह",
  afternoon: "दोपहर",
  evening: "शाम",
  night: "रात",

  // ---- sign in / create account (lib/authForms.ts)
  "8 or more characters": "8 या उससे ज़्यादा अक्षर",
  "Already have an account? Sign in": "पहले से अकाउंट है? साइन इन करें",
  "Choose a password.": "पासवर्ड चुनें।",
  "Create your account with the email your invite was sent to.":
    "उसी ईमेल से अकाउंट बनाएँ जिस पर आपका इनवाइट आया था।",
  "Creating…": "बना रहे हैं…",
  "Enter your password.": "अपना पासवर्ड डालें।",
  "Forgot password?": "पासवर्ड भूल गए?",
  "Reset link sent — check your inbox (and spam).": "रीसेट लिंक भेज दिया — इनबॉक्स (और स्पैम) देखें।",
  "Signing in…": "साइन इन हो रहा है…",
  "Something went wrong. Try again?": "कुछ गड़बड़ हो गई। फिर से कोशिश करें?",
  "That email and password don't match.": "ईमेल और पासवर्ड मेल नहीं खा रहे।",
  "That email doesn't look right.": "यह ईमेल सही नहीं लग रहा।",
  "The two passwords don't match.": "दोनों पासवर्ड एक जैसे नहीं हैं।",
  "There's already an account for this email. Sign in instead.":
    "इस ईमेल से पहले से अकाउंट है। साइन इन करें।",
  "Too many tries. Wait a minute and try again.": "बहुत बार कोशिश हो गई। एक मिनट रुककर फिर कोशिश करें।",
  "Use at least 8 characters.": "कम से कम 8 अक्षर रखें।",
  "your password": "आपका पासवर्ड",
  "the one you signed up with": "जिससे आपने साइन अप किया था",
  "you're in": "आप अंदर हैं",
  "This email isn't approved yet — apply for the beta and we'll email you when you're in.":
    "यह ईमेल अभी अप्रूव नहीं हुआ है — बीटा के लिए अप्लाई करें, अप्रूव होते ही हम आपको ईमेल करेंगे।",

  // ---- report a song (lib/contentReport.ts)
  Copyright: "कॉपीराइट",
  "If it breaks the rules it comes out of the deck for everyone.": "अगर यह नियम तोड़ता है तो इसे सबके डेक से हटा दिया जाएगा।",
  "Offensive or hateful": "आपत्तिजनक या नफ़रत भरा",
  "Pick a reason first.": "पहले कोई वजह चुनें।",
  "Send report": "रिपोर्ट भेजें",
  "Sending…": "भेज रहे हैं…",
  "Sexual content": "यौन सामग्री",
  "Something else": "कुछ और",
  "Spam or misleading": "स्पैम या गुमराह करने वाला",
  "What's wrong with it? A person looks at every report.": "इसमें क्या गलत है? हर रिपोर्ट एक इंसान देखता है।",
  "anything else": "कुछ भी और",
  "explicit art or lyrics that break the rules": "ऐसी तस्वीर या बोल जो नियम तोड़ते हैं",
  "hate, harassment or violence": "नफ़रत, उत्पीड़न या हिंसा",
  "it's someone else's work and shouldn't be here": "यह किसी और का काम है और यहाँ नहीं होना चाहिए",
  "optional — what we should know": "ज़रूरी नहीं — हमें क्या जानना चाहिए",
  "tell us in the note": "नोट में बताएँ",
  "wrong song, fake artist, a scam": "गलत गाना, नकली आर्टिस्ट, धोखा",

  // ---- the tour (lib/tourCopy.ts)
  "A rough steer, not a filter — everything else still shows up, just further down the deck.":
    "यह बस एक इशारा है, फ़िल्टर नहीं — बाकी सब भी आएगा, बस डेक में थोड़ा आगे।",
  "Hold the card, push toward a face, let go. The whole deck switches to that mood — every song that fits comes first — until you tap the mood to clear it.":
    "कार्ड दबाकर रखें, किसी चेहरे की तरफ़ खींचें और छोड़ दें। पूरा डेक उस mood में बदल जाएगा — जो गाने फ़िट होते हैं वो पहले आएँगे — जब तक आप mood पर टैप करके उसे हटा न दें।",
  "Pick as many as you like. This matters more than genre — being fed songs in a language you don't speak gets old fast.":
    "जितनी चाहें चुनें। यह genre से ज़्यादा ज़रूरी है — ऐसी भाषा के गाने जो आप समझते ही नहीं, जल्दी बोर कर देते हैं।",
  "Show me how": "दिखाओ कैसे",
  "We play you the best part of songs you've never heard. Four swipes teach us exactly what you love.":
    "हम आपको उन गानों का सबसे अच्छा हिस्सा सुनाते हैं जो आपने कभी नहीं सुने। चार स्वाइप से हम समझ जाते हैं कि आपको क्या पसंद है।",
  "and what": "और कैसा",
  "how far": "कितना",
  "in?": "में?",
  "off the map?": "हटकर?",
  "one swipe away": "बस एक स्वाइप दूर",
  "sounds?": "संगीत?",
  "what do you listen": "आप किस भाषा",
  "your next favorite song is": "आपका अगला फ़ेवरेट गाना है",

  // ---- taste questions (data/taste.ts)
  English: "English",
  Hindi: "हिन्दी",
  Punjabi: "पंजाबी",
  Tamil: "तमिल",
  Telugu: "तेलुगु",
  Arabic: "अरबी",
  Korean: "कोरियन",
  Spanish: "स्पैनिश",
  Portuguese: "पुर्तगाली",
  Mandarin: "मैंडरिन",
  Pop: "पॉप",
  "Hip-hop & rap": "हिप-हॉप और रैप",
  "R&B & soul": "R&B और सोल",
  "Dance & electronic": "डांस और इलेक्ट्रॉनिक",
  Rock: "रॉक",
  "Indie & alternative": "इंडी और अल्टरनेटिव",
  "Country & folk": "कंट्री और फ़ोक",
  Latin: "लैटिन",
  Desi: "देसी",
  "Everything else": "बाकी सब",
  "The hits": "हिट गाने",
  "A bit of both": "दोनों थोड़ा-थोड़ा",
  "Take me deep": "कुछ हटकर",
  "Songs plenty of people already know": "ऐसे गाने जो बहुत लोग जानते हैं",
  "Familiar names, songs you missed": "जाने-पहचाने नाम, छूटे हुए गाने",
  "The further off the chart the better": "चार्ट से जितना दूर, उतना अच्छा",

  // ---- settings (hub, pages, prefs)
  listening: "सुनना",
  you: "आप",
  "Sound & taste": "साउंड और पसंद",
  Account: "अकाउंट",
  "sign in to keep your taste forever": "साइन इन करें ताकि आपकी पसंद हमेशा सेव रहे",
  "export, reset, delete account": "एक्सपोर्ट, रीसेट, अकाउंट हटाएँ",
  "house ads off": "हाउस ऐड बंद",
  "house ads on": "हाउस ऐड चालू",
  "languages, genres, blocked artists, replays": "भाषाएँ, genre, ब्लॉक किए आर्टिस्ट, दोबारा सुनना",
  "How HookedCue looks on this screen.": "इस स्क्रीन पर HookedCue कैसा दिखता है।",
  "How songs behave in the deck.": "डेक में गाने कैसे चलते हैं।",
  "Tune the four swipes to your wrist.": "चारों स्वाइप को अपने हिसाब से सेट करें।",
  "Time of day": "दिन का समय",
  "Creator dashboard": "क्रिएटर डैशबोर्ड",
  "put your own music in the deck": "अपना संगीत डेक में डालें",
  "Admin dashboard": "एडमिन डैशबोर्ड",
  Often: "अक्सर",
  Normal: "नॉर्मल",
  Rarely: "कभी-कभार",
  Full: "पूरा",
  Reduced: "कम",
  Subtle: "हल्का",
  Pronounced: "तेज़",

  // ---- new playlist sheet
  "New playlist": "नई प्लेलिस्ट",
  "Every song you swipe down is saved here until you pick another.":
    "जो भी गाना आप नीचे स्वाइप करेंगे वो यहीं सेव होगा, जब तक आप कोई और न चुनें।",
  mood: "mood",

  // ---- settings rows & labels
  "Auto-advance": "अपने आप अगला",
  "jump to the next song when a preview ends": "प्रीव्यू खत्म होते ही अगला गाना",
  Volume: "आवाज़",
  "Swipe down saves to": "नीचे स्वाइप करने पर सेव होगा",
  change: "बदलें",
  "Mood by the clock": "समय के हिसाब से mood",
  Languages: "भाषाएँ",
  Adventure: "कितना हटकर",
  "House ads": "हाउस ऐड",
  "How often": "कितनी बार",
  "Your own pace": "अपनी रफ़्तार",
  "Before you go…": "जाने से पहले…",
  Playlists: "प्लेलिस्ट",
  "Blocked artists": "ब्लॉक किए आर्टिस्ट",
  "{n} created": "{n} बनाईं",
  "{n} never again": "{n} कभी नहीं",

  // ---- tour: gestures, hold, done
  "not feeling it?": "पसंद नहीं आया?",
  "swipe up": "ऊपर स्वाइप करें",
  "love it?": "बहुत पसंद आया?",
  "swipe down": "नीचे स्वाइप करें",
  "want more like it?": "ऐसे और चाहिए?",
  "swipe right": "दाएँ स्वाइप करें",
  "hate it?": "बिल्कुल पसंद नहीं?",
  "swipe left": "बाएँ स्वाइप करें",
  "Skips to the next song instantly. No hard feelings — we learn from it anyway.": "तुरंत अगला गाना। कोई बात नहीं — इससे भी हम आपकी पसंद समझते हैं।",
  "Saves it to your Liked Songs or a playlist — you choose where in settings.": "गाना आपके पसंदीदा गानों या किसी प्लेलिस्ट में सेव हो जाता है — कहाँ, ये आप सेटिंग्स में चुनते हैं।",
  "Doesn't save it — just tells the algorithm to chase this exact vibe.": "सेव नहीं होता — बस algorithm को बताता है कि ऐसी ही vibe के और गाने लाओ।",
  "Never plays it again, and steers your feed far away from it.": "ये गाना फिर कभी नहीं बजेगा, और आपकी feed इससे दूर रहेगी।",
  "and": "और",
  "hold": "दबाकर रखें",
  ", then push": ", फिर खिसकाएँ",
  "press and hold": "दबाकर रखें",
  "Nice — we'll open with {mood}. Hold any card to change it, any time.": "बढ़िया — शुरुआत {mood} से करेंगे। बदलना हो तो कभी भी किसी कार्ड को दबाकर रखें।",
  "you're": "आप",
  "ready.": "तैयार हैं।",
  "Four swipes and a hold. The ↩ button up top always brings back the last song, in case you go too fast.": "चार स्वाइप और एक होल्ड। ऊपर वाला ↩ बटन हमेशा पिछला गाना वापस लाता है, अगर आप जल्दी में आगे निकल जाएँ।",
  "Swipe the card to continue": "आगे बढ़ने के लिए कार्ड स्वाइप करें",
  "Hold the card to continue": "आगे बढ़ने के लिए कार्ड दबाकर रखें",

  // ---- sheets & deck
  "Swipe down saves to…": "नीचे स्वाइप करने पर यहाँ सेव होगा…",
  "Pick where a ↓ swipe sends the song.": "चुनें कि ↓ स्वाइप करने पर गाना कहाँ जाए।",
  "Discoveries playlist": "नई खोजें प्लेलिस्ट",
  "new playlist name…": "नई प्लेलिस्ट का नाम…",
  "create": "बनाएँ",
  "your taste": "आपकी पसंद",
  "recently saved": "हाल ही में सेव किए",
  "name": "नाम",
  "late night drives, gym, focus…": "देर रात की ड्राइव, जिम, पढ़ाई…",
  "Swipe down to save here. The deck leans {mood} while you fill it.": "यहाँ सेव करने के लिए नीचे स्वाइप करें। जब तक आप इसे भरते हैं, डेक {mood} की तरफ़ झुका रहेगा।",
  "fewer options": "कम विकल्प",
  "more options": "और विकल्प",
  "{n} on": "{n} चालू",
  "nothing left to deal": "दिखाने को कुछ नहीं बचा",
  "You've ruled out every artist in the catalog. Unblock some in Settings, or remove songs from your library to hear them again.": "आपने कैटलॉग के सारे आर्टिस्ट हटा दिए हैं। सेटिंग्स में कुछ को अनब्लॉक करें, या लाइब्रेरी से गाने हटाएँ ताकि वो फिर सुनाई दें।",
  "never play this artist": "ये आर्टिस्ट फिर कभी नहीं",
  "Create a playlist": "प्लेलिस्ट बनाएँ",

  // ---- sharing (growth)
  "Share this song": "ये गाना शेयर करें",
  "opens at the hook": "hook से शुरू होता है",
  "story image for Instagram": "Instagram के लिए story इमेज",

  // ---- settings pages
  "auto-advance on · volume · save target": "अपने आप अगला: चालू · आवाज़ · सेव की जगह",
  "auto-advance off · volume · save target": "अपने आप अगला: बंद · आवाज़ · सेव की जगह",
  "auto-advance on · save target": "अपने आप अगला: चालू · सेव की जगह",
  "auto-advance off · save target": "अपने आप अगला: बंद · सेव की जगह",
  "swipe distance · haptics {h}": "स्वाइप की दूरी · वाइब्रेशन {h}",
  "accent · motion {m}": "रंग · मोशन {m}",
  "full": "पूरा",
  "reduced": "कम",
  "subtle": "हल्का",
  "Back to settings": "सेटिंग्स पर वापस",
  "back to settings": "सेटिंग्स पर वापस",
  "Accent": "रंग",
  "accent colour": "accent रंग",
  "From each song": "हर गाने से",
  "Fixed colour": "एक ही रंग",
  "Motion": "मोशन",
  "off also skips the vinyl save animation": "बंद करने पर vinyl वाला सेव एनीमेशन भी नहीं दिखेगा",
  "volume": "आवाज़",
  "time of day": "दिन का समय",
  "Swipe distance": "स्वाइप की दूरी",
  "swipe distance sensitivity": "स्वाइप की दूरी",
  "feather-light flicks": "हल्का-सा झटका काफ़ी",
  "deliberate drags": "पूरा खींचना पड़े",
  "the shipped default": "डिफ़ॉल्ट सेटिंग",
  "Haptics": "वाइब्रेशन",
  "The deck tilts toward these answers without ever walling anything out.": "डेक इन जवाबों की तरफ़ झुकता है, पर किसी चीज़ को पूरी तरह बंद नहीं करता।",
  "languages": "भाषाएँ",
  "genres": "genre",
  "Genres": "Genre",
  "discovery rules": "डिस्कवरी के नियम",
  "The deck's default strictness. Playlists can relax these for themselves, per playlist.": "डेक कितना सख़्त रहे, ये उसकी डिफ़ॉल्ट सेटिंग है। हर प्लेलिस्ट अपने लिए इन्हें ढीला कर सकती है।",
  "songs you swiped left can return": "जिन गानों को बाएँ स्वाइप किया, वो लौट सकते हैं",
  "artists you blocked can return": "जिन आर्टिस्ट को ब्लॉक किया, वो लौट सकते हैं",
  "blocked artists": "ब्लॉक किए आर्टिस्ट",
  "their songs never reach your deck": "उनके गाने आपके डेक तक कभी नहीं आते",
  "unblock": "अनब्लॉक",
  "The cards that keep the deck independent.": "वो कार्ड जिनसे डेक आज़ाद रहता है।",
  "house ads": "हाउस ऐड",
  "less frequent": "कम बार",
  "more frequent": "ज़्यादा बार",
  "On — keep HookedCue independent": "चालू — HookedCue को आज़ाद रखें",
  "a card every": "एक कार्ड हर",
  "swipes": "स्वाइप",
  "minutes": "मिनट",
  "hours": "घंटे",
  "pick a unit, set the number — the daily and weekly ceilings set by HookedCue always hold, and music never stops for a card": "इकाई चुनें, नंबर सेट करें — HookedCue की रोज़ और हफ़्ते की लिमिट हमेशा लागू रहती है, और किसी कार्ड के लिए संगीत कभी नहीं रुकता",
  "HookedCue has no investors and no label money. Those few quiet cards between songs are what pay for the servers, the licences and the hours this takes. Turning them off won't cost you anything — but if a few hundred people do, this deck goes quiet with them.": "HookedCue के पीछे न कोई investor है, न किसी लेबल का पैसा। गानों के बीच के ये कुछ शांत कार्ड ही सर्वर, लाइसेंस और इसमें लगने वाले घंटों का खर्च उठाते हैं। इन्हें बंद करने से आपका कुछ नहीं जाएगा — लेकिन अगर कुछ सौ लोग ऐसा करें, तो ये डेक भी उनके साथ चुप हो जाएगा।",
  "Whatever you choose, the music keeps playing. That's a promise.": "आप जो भी चुनें, संगीत चलता रहेगा। ये वादा है।",
  "Keep them on — I get it": "चालू रखें — बात समझ आती है",
  "Turn them off anyway": "फिर भी बंद करें",
  "What HookedCue keeps about you, and what you can do about it.": "HookedCue आपके बारे में क्या रखता है, और आप उसका क्या कर सकते हैं।",
  "Export my library": "मेरी लाइब्रेरी एक्सपोर्ट करें",
  "your lists and answers as JSON": "आपकी लिस्ट और जवाब, JSON फ़ाइल में",
  "Use it on the web": "वेब पर इस्तेमाल करें",
  "save": "सेव",
  "open": "खोलें",
  "Get it on your phone": "फ़ोन पर पाएँ",
  "join the android closed test": "Android closed test में जुड़ें",
  "Replay the swipe tutorial": "स्वाइप ट्यूटोरियल फिर से देखें",
  "relearn the four gestures": "चारों जेस्चर फिर से सीखें",
  "Privacy & terms": "प्राइवेसी और शर्तें",
  "what we store, and how to get it deleted": "हम क्या रखते हैं, और उसे कैसे हटवाएँ",
  "Reset local data": "लोकल डेटा रीसेट करें",
  "cloud library is untouched": "क्लाउड लाइब्रेरी को कुछ नहीं होगा",
  "removes your library, playlists and history for good": "आपकी लाइब्रेरी, प्लेलिस्ट और हिस्ट्री हमेशा के लिए हटा देता है",
  "Clear this device?": "इस डिवाइस से सब हटाएँ?",
  "Your local library and history on this device are removed. Anything synced to your account stays.": "इस डिवाइस की लाइब्रेरी और हिस्ट्री हट जाएगी। जो आपके अकाउंट में सिंक है, वो बना रहेगा।",
  "Clear": "हटाएँ",
  "Delete your account?": "अपना अकाउंट हटाएँ?",
  "Your account and everything in it goes. This can't be undone.": "आपका अकाउंट और उसमें सब कुछ चला जाएगा। इसे वापस नहीं लाया जा सकता।",
  "Continue": "आगे बढ़ें",
  "Last check": "आख़िरी बार पूछ रहे हैं",
  "Your library, playlists and swipe history are deleted for good.": "आपकी लाइब्रेरी, प्लेलिस्ट और स्वाइप हिस्ट्री हमेशा के लिए हट जाएँगी।",
  "live stats, users, permissions, catalog": "लाइव आँकड़े, यूज़र, परमिशन, कैटलॉग",
  "Analytics": "एनालिटिक्स",
  "live deck numbers · your tracks": "डेक के लाइव नंबर · आपके ट्रैक",
  "on the web, at app.hookedcue.com": "वेब पर, app.hookedcue.com पर",
  "Notifications are off on the web — the card on Home is your hook of the day here.": "वेब पर नोटिफ़िकेशन नहीं आते — यहाँ होम वाला कार्ड ही आपका आज का hook है।",
  "Every day at {time}": "रोज़ {time} बजे",
};
