import { z } from 'zod';

export const meetingLanguageSchema = z.enum(['hi-en', 'mr-en', 'en', 'auto']);

export const meetingStatusSchema = z.enum([
  'recording',
  'uploading',
  'processing',
  'ready',
  'failed',
  'deleted',
]);

export const createMeetingInputSchema = z.object({
  source: z.literal('google-meet'),
  language: meetingLanguageSchema,
});

export type MeetingLanguage = z.infer<typeof meetingLanguageSchema>;
export type MeetingStatus = z.infer<typeof meetingStatusSchema>;
export type CreateMeetingInput = z.infer<typeof createMeetingInputSchema>;
