# Google Meet Meeting Assistant — Feature List

## Purpose

A private, Chrome-based assistant for a small team. It detects Google Meet, asks before recording, creates a speaker-aware transcript, and delivers a useful meeting report in English from Hindi, Marathi, English, or mixed-language calls.

## Version 1 — MVP

### 1. Google Meet detection

- Detect an open Google Meet tab.
- Recognize when the user has joined an active meeting.
- Show a small prompt: **"Google Meet detected — start recording?"**
- Never begin recording without the user pressing **Start recording**.
- Detect that the meeting has ended or that the user has left, then stop the recording.

### 2. Recording controls and consent

- Start, pause, resume, and stop recording controls.
- Visible **Recording** state throughout the meeting.
- Confirmation screen reminding the user to obtain participants' consent.
- Clear error message if audio capture is unavailable.

### 3. Meeting audio capture

- Capture the Google Meet tab audio after a user action.
- Record reliably during normal meetings and recover from temporary upload problems.
- Keep an unprocessed recording on the user's device until upload succeeds.

### 4. Language selection

- Choose one of: Hindi/Hinglish, Marathi/Marathi-English, English, or auto-detect.
- Preserve the spoken-language transcript, normally in Devanagari for Hindi and Marathi.
- Support natural switching between Indian languages and English as far as the transcription model permits.

### 5. Speaker-aware transcription

- Convert meeting audio to a timestamped transcript using OpenAI.
- Divide the transcript by detected speaker: Speaker A, Speaker B, and so on.
- Let a user rename a detected speaker after the meeting.
- Remember a confirmed name for that person within the team where feasible.
- Show a confidence warning rather than pretending speaker detection is perfect.

### 6. AI meeting report

- Meeting title, date, duration, and language.
- Concise English summary of the discussion.
- Decisions made.
- Action items, owners, and stated due dates.
- Open questions and follow-ups.
- Speaker-wise talk time and key contributions.
- Full timestamped transcript.

### 7. Meeting page and history

- Private sign-in for the team.
- List past meetings by date.
- Open a meeting report and edit speaker names, transcript text, or action items.
- Search past reports by keyword, person, date, or project/topic.
- Copy or download a meeting summary.

### 8. Google Docs delivery

- Connect a user's Google account through a secure Google sign-in and permission flow.
- After a meeting is processed, create a neatly formatted Google Doc containing the report.
- Include the summary, decisions, action items, speaker report, and full transcript in the document.
- Let the user choose between creating a new document per meeting or appending the report to a selected existing team document.
- Save the Google Doc link on the meeting page.

### 9. Privacy and control

- Meeting report visible only to authorized team members.
- Secure transfer and storage of recordings and reports.
- Automatic raw-audio deletion after successful processing by default.
- Manual deletion of any meeting and its associated data.
- Clear processing, retry, and failure status.

## Later upgrades — not part of Version 1

- Live transcript and live action-item panel during the call.
- Automatic delivery to email, Slack, WhatsApp, or Notion.
- Calendar integration and automatic meeting title/project detection.
- Voice profiles to improve automatic speaker naming, with explicit consent.
- Multi-language summaries (Hindi and Marathi in addition to English).
- Meeting templates: daily stand-up, client call, product review, interview, sales call.
- Cross-meeting AI chat: "What did we decide about the launch date?"
- Analytics dashboard: recurring topics, action-item completion, and meeting trends.
- Zoom and Microsoft Teams support.

## Explicit Version 1 limits

- Google Meet only.
- The user must click Start recording; recording cannot silently begin.
- Reports are generated after the meeting, not live.
- Speaker labels may need one-time correction or naming after the call, especially with overlapping speech or noisy audio.
