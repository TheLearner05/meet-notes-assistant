import { describe, expect, it } from 'vitest';
import { openAiLanguageHints, openAiVocabulary } from './transcription-config.js';

describe('OpenAI transcription configuration', () => {
  it('provides Marathi, Hindi, and English hints for automatic meetings', () => {
    expect(openAiLanguageHints('auto')).toEqual(['mr', 'hi', 'en']);
  });

  it('provides Marathi and English hints for Marathi-English meetings', () => {
    expect(openAiLanguageHints('mr-en')).toEqual(['mr', 'en']);
  });

  it('normalizes duplicate custom vocabulary', () => {
    expect(openAiVocabulary('NitroCool, Sumit, NitroCool, ')).toEqual(['NitroCool', 'Sumit']);
  });
});
