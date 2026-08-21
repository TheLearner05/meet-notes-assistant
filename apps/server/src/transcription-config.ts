import type { MeetingLanguage } from './meeting-store.js';

export function openAiLanguageHints(language: MeetingLanguage): string[] {
  if (language === 'mr-en') return ['mr', 'en'];
  if (language === 'hi-en') return ['hi', 'en'];
  if (language === 'en') return ['en'];
  return ['mr', 'hi', 'en'];
}

export function openAiVocabulary(value = process.env.OPENAI_TRANSCRIPTION_VOCABULARY ?? ''): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))].slice(0, 100);
}
