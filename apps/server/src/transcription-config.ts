import type { MeetingLanguage } from './meeting-store.js';

// OpenAI's transcription API accepts a single ISO-639-1 `language` code, not a list of hints —
// passing the dominant spoken language (even for a code-switched Marathi/Hindi/English meeting)
// measurably improves accuracy and lets the model commit to a script instead of guessing per
// utterance. 'auto' deliberately returns undefined so the model detects the language itself.
export function openAiLanguageCode(language: MeetingLanguage): string | undefined {
  if (language === 'mr-en') return 'mr';
  if (language === 'hi-en') return 'hi';
  if (language === 'en') return 'en';
  return undefined;
}

export function openAiVocabulary(value = process.env.OPENAI_TRANSCRIPTION_VOCABULARY ?? ''): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))].slice(0, 100);
}

// `prompt` only reaches the fast/rebuild pass (gpt-transcribe) — OpenAI's docs explicitly say it
// isn't supported for gpt-4o-transcribe-diarize, so this can't help the final speaker-labeled pass.
// When no single language is forced (Auto-detect), naming the likely candidates here gives the
// model a soft steer without hard-committing it to one script the way `language` would.
export function transcriptionPrompt(language: MeetingLanguage, vocabulary: string[]): string | undefined {
  const parts = [
    language === 'auto' ? 'This recording may mix Marathi, Hindi, and English.' : undefined,
    vocabulary.length ? vocabulary.join(', ') : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(' ') : undefined;
}
