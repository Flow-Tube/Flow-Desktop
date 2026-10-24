/**
 * Languages the site can write its text in, by the host language Flow sends. Each has
 * an upload-date table on the backend; regional variants other than Portuguese and
 * Chinese collapse to their language, as the site's own picker does.
 */
export const CONTENT_LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "af", label: "Afrikaans" }, { value: "am", label: "አማርኛ" }, { value: "ar", label: "العربية" },
  { value: "az", label: "Azərbaycan" }, { value: "be", label: "Беларуская" }, { value: "bg", label: "Български" },
  { value: "bn", label: "বাংলা" }, { value: "bs", label: "Bosanski" }, { value: "ca", label: "Català" },
  { value: "cs", label: "Čeština" }, { value: "da", label: "Dansk" }, { value: "de", label: "Deutsch" },
  { value: "el", label: "Ελληνικά" }, { value: "es", label: "Español" }, { value: "et", label: "Eesti" },
  { value: "eu", label: "Euskara" }, { value: "fa", label: "فارسی" }, { value: "fi", label: "Suomi" },
  { value: "fil", label: "Filipino" }, { value: "fr", label: "Français" }, { value: "gl", label: "Galego" },
  { value: "gu", label: "ગુજરાતી" }, { value: "hi", label: "हिन्दी" }, { value: "hr", label: "Hrvatski" },
  { value: "hu", label: "Magyar" }, { value: "hy", label: "Հայերեն" }, { value: "id", label: "Bahasa Indonesia" },
  { value: "is", label: "Íslenska" }, { value: "it", label: "Italiano" }, { value: "iw", label: "עברית" },
  { value: "ja", label: "日本語" }, { value: "ka", label: "ქართული" }, { value: "kk", label: "Қазақ" },
  { value: "km", label: "ខ្មែរ" }, { value: "kn", label: "ಕನ್ನಡ" }, { value: "ko", label: "한국어" },
  { value: "ky", label: "Кыргызча" }, { value: "lo", label: "ລາວ" }, { value: "lt", label: "Lietuvių" },
  { value: "lv", label: "Latviešu" }, { value: "mk", label: "Македонски" }, { value: "ml", label: "മലയാളം" },
  { value: "mn", label: "Монгол" }, { value: "mr", label: "मराठी" }, { value: "ms", label: "Bahasa Melayu" },
  { value: "my", label: "မြန်မာ" }, { value: "ne", label: "नेपाली" }, { value: "nl", label: "Nederlands" },
  { value: "no", label: "Norsk" }, { value: "pa", label: "ਪੰਜਾਬੀ" }, { value: "pl", label: "Polski" },
  { value: "pt-BR", label: "Português (Brasil)" }, { value: "pt", label: "Português (Portugal)" },
  { value: "ro", label: "Română" }, { value: "ru", label: "Русский" }, { value: "si", label: "සිංහල" },
  { value: "sk", label: "Slovenčina" }, { value: "sl", label: "Slovenščina" }, { value: "sq", label: "Shqip" },
  { value: "sr", label: "Српски" }, { value: "sv", label: "Svenska" }, { value: "sw", label: "Kiswahili" },
  { value: "ta", label: "தமிழ்" }, { value: "te", label: "తెలుగు" }, { value: "th", label: "ไทย" },
  { value: "tr", label: "Türkçe" }, { value: "uk", label: "Українська" }, { value: "ur", label: "اردو" },
  { value: "uz", label: "Oʻzbek" }, { value: "vi", label: "Tiếng Việt" }, { value: "zh-CN", label: "中文 (简体)" },
  { value: "zh-HK", label: "中文 (香港)" }, { value: "zh-TW", label: "中文 (繁體)" }, { value: "zu", label: "isiZulu" },
];
