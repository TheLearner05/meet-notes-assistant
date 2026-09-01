import { describe, expect, it } from 'vitest';
import { openAiLanguageCode, openAiVocabulary, transcriptionPrompt } from './transcription-config.js';

describe('OpenAI transcription configuration', () => {
  it('leaves the language unset for automatic meetings so the model detects it', () => {
    expect(openAiLanguageCode('auto')).toBeUndefined();
  });

  it('selects Marathi as the dominant language for Marathi-English meetings', () => {
    expect(openAiLanguageCode('mr-en')).toBe('mr');
  });

  it('selects Hindi as the dominant language for Hindi-English meetings', () => {
    expect(openAiLanguageCode('hi-en')).toBe('hi');
  });

  it('selects English for English-only meetings', () => {
    expect(openAiLanguageCode('en')).toBe('en');
  });

  it('normalizes duplicate custom vocabulary', () => {
    expect(openAiVocabulary('NitroCool, Sumit, NitroCool, ')).toEqual(['NitroCool', 'Sumit']);
  });
});

describe('transcriptionPrompt', () => {
  it('describes the likely language mix when no single language is forced', () => {
    expect(transcriptionPrompt('auto', [])).toBe('This recording may mix Marathi, Hindi, and English.');
  });

  it('says nothing about language mix once a single language is already selected', () => {
    expect(transcriptionPrompt('mr-en', [])).toBeUndefined();
    expect(transcriptionPrompt('hi-en', [])).toBeUndefined();
    expect(transcriptionPrompt('en', [])).toBeUndefined();
  });

  it('appends custom vocabulary after the language-mix hint', () => {
    expect(transcriptionPrompt('auto', ['NitroCool', 'Sumit'])).toBe('This recording may mix Marathi, Hindi, and English. NitroCool, Sumit');
  });

  it('includes vocabulary on its own when a language is already selected', () => {
    expect(transcriptionPrompt('mr-en', ['NitroCool'])).toBe('NitroCool');
  });

  it('returns undefined when there is nothing to say', () => {
    expect(transcriptionPrompt('mr-en', [])).toBeUndefined();
  });
});
