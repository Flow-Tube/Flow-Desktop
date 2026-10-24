/** Audio track languages offered in settings, by the BCP 47 code the backend matches tracks on. */
const AUDIO_LANGUAGE_CODES = [
  "af", "am", "ar", "az", "be", "bg", "bn", "bs", "ca", "cs", "cy", "da", "de", "el", "en", "es",
  "et", "eu", "fa", "fi", "fil", "fr", "gl", "gu", "ha", "he", "hi", "hr", "hu", "hy", "id", "ig",
  "is", "it", "ja", "jv", "ka", "kk", "km", "kn", "ko", "ku", "ky", "lo", "lt", "lv", "mk", "ml",
  "mn", "mr", "ms", "my", "ne", "nl", "no", "or", "pa", "pl", "ps", "pt", "ro", "ru", "rw", "sd",
  "si", "sk", "sl", "so", "sq", "sr", "su", "sv", "sw", "ta", "te", "tg", "th", "tk", "tr", "uk",
  "ur", "uz", "vi", "yo", "zh", "zh-Hant", "zu",
] as const;

/** Names come from the platform's CLDR data so they follow the UI language without string files. */
export function audioLanguageOptions(locale: string): { value: string; label: string }[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([locale], { type: "language" });
  } catch {
    names = null;
  }
  const collator = new Intl.Collator(locale);
  return AUDIO_LANGUAGE_CODES
    .map((code) => ({ value: code, label: names?.of(code) ?? code }))
    .sort((a, b) => collator.compare(a.label, b.label));
}
