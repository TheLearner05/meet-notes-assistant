# Otter.ai pipeline research

Background research on how Otter.ai's transcription pipeline works, gathered to inform improvements to this project. Otter does not publish a detailed engineering blog, so findings below are pieced together from their help docs, third-party technical writeups on streaming-transcription systems generally, and this project's own codebase for comparison. Anything not corroborated by Otter's own docs is marked speculative.

## 1. How Otter.ai's pipeline works

### 1.1 Capture — bot-based, not extension-only

Otter's "OtterPilot" joins Zoom/Google Meet/Microsoft Teams **as a guest participant** — it shows up in the participant list as "Notetaker (Otter.ai)". It's triggered one of two ways:

- Pasting a meeting URL into Otter's home feed ("Paste meeting URL to record").
- Automatically, when a meeting on a connected calendar starts.

Otter also has a Chrome extension, but it functions as a *launcher* for the bot join, not as the audio-capture mechanism itself — this is a meaningfully different model from a tab-capture extension. Notetaker joins only as a guest and can't sign into a host account on any platform.

Source: [Otter Notetaker Overview – Help Center](https://help.otter.ai/hc/en-us/articles/4425393298327-OtterPilot-Overview), [New Otter® Chrome Extension — Businesswire](https://www.businesswire.com/news/home/20230228005674/en/New-Otter-Chrome-Extension-Makes-it-Easier-than-Ever-to-OtterPilot-Your-Zoom-and-Google-Meet-Meetings-with-an-AI-powered-Assistant)

### 1.2 Real-time streaming ASR, not batch-after-the-fact

Otter displays transcription word-by-word live during the call. That requires a streaming ASR model producing incremental partial hypotheses over a continuous audio socket, rather than periodic file uploads processed after the fact.

Source: [Otter.ai Makes Live Transcription Easy for Zoom, Microsoft Teams, and Google Meet](https://otter.ai/blog/live-transcribing-zoom-microsoft-teams-and-google-meet-using-otterpilot)

### 1.3 Streaming speaker diarization

This is the technically interesting part, well documented in general industry literature on this category of system (not Otter-specific, but describes the architecture this class of product uses):

- **Neural turn detection**, not plain VAD. Modern streaming diarization uses acoustic *and* linguistic signals to determine when someone has actually finished speaking, rather than relying on a silence/volume gate alone. This gives a real edge over VAD-only systems.
- **Per-turn speaker embeddings.** For each completed turn, the system extracts a voice embedding and compares it against a small in-session cache of embeddings from prior turns. The embedding model itself is fixed/frozen during a conversation — "only the clustering part accumulates memory."
- **Clustering & assignment.** New audio is matched against cached embeddings to decide "existing speaker" vs. "new speaker." Labels are assigned in arrival order (SPEAKER_A, SPEAKER_B, ...).
- **Latency profile.** Turn detection dominates latency, not diarization itself — independent benchmarks put end-to-end P50 latency around ~300ms for aggressive real-time configurations.
- **The core tradeoff: decisions are final.** Once streaming diarization assigns a label, it can't revise it later the way offline/batch diarization can (batch sees the whole recording before committing to any label). Streaming trades accuracy for immediacy, and struggles more with overlapping speech, short utterances, and background noise as a result.
- **Early-conversation instability.** Speaker assignments are least reliable early in a call, before enough context has accumulated; stability improves over the call's duration. Context-window size directly trades stability against latency.

Source: [Streaming Speaker Diarization: How It Works in Real Time — AssemblyAI](https://www.assemblyai.com/blog/streaming-speaker-diarization)

### 1.4 Voiceprints persist across meetings

Speaker identification in Otter is explicitly described as learning from tagged speech: "Otter's speaker identification algorithm learns from just a few tagged paragraphs for each speaker." Once you tag a speaker, Otter builds a voice profile tied to your account (and, for Workspace members, shared across teammates' meetings), and future meetings auto-suggest that identity when a similar voice appears. This is a **cross-meeting biometric identity graph**, not a per-meeting label — fundamentally different from a plain remembered-names list.

Source: [Speaker Identification Overview – Help Center](https://help.otter.ai/hc/en-us/articles/21665587209367-Speaker-Identification-Overview), [Disable Speaker Learning – Help Center](https://help.otter.ai/hc/en-us/articles/40643231903639-Disable-Speaker-Learning)

### 1.5 Slide capture

Otter captures shared-screen content during a call and threads it into the transcript timeline alongside the speech it was shown next to.

### 1.6 LLM post-processing

Punctuation/grammar cleanup, summarization, and action-item extraction happen via a generative post-processing layer after raw ASR output. This is the same category of step this project already implements. One search result claimed this layer runs on "fine-tuned LLaMA-4" — **that is uncorroborated SEO-blog content, not an Otter disclosure**, and shouldn't be treated as fact.

## 2. How this project's pipeline compares

Mapped against the current codebase as of 2026-09-01:

| Area | Otter | This project |
|---|---|---|
| Capture | Bot joins as a call participant (Zoom/Meet/Teams) | Chrome extension captures the active tab's audio ([recording-session.ts](../../apps/extension/src/background/recording-session.ts)) — Google Meet only |
| Live transcript | True streaming ASR, word-by-word | Near-real-time via a provisional queue: parallel 30s-chunk transcription with no diarization, labeled "Speaker pending" until the chunk finishes ([provisional-transcription.ts](../../apps/server/src/provisional-transcription.ts)) |
| Final transcript | Same streaming pipeline, refined | Separate final pass: source audio is cut into fixed 1200s (diarization) / 600s (fast rebuild) ffmpeg segments, each diarized independently via `gpt-4o-transcribe-diarize` ([reporting.ts](../../apps/server/src/reporting.ts)) |
| Cross-segment speaker identity | Continuous in-session embedding cache — no segment boundaries to reconcile | Diarization labels ("Speaker A") are only meaningful within one API call per segment, so an LLM reconciliation pass (`reconcileSpeakerLabels`, [reporting.ts:186](../../apps/server/src/reporting.ts#L186)) stitches "Speaker A" in chunk 1 and "Speaker 2-A" in chunk 2 back into one person |
| Speaker memory across meetings | Voiceprint-based automatic re-identification | Name-only autocomplete list ([known-speakers.ts](../../apps/server/src/known-speakers.ts)) — every meeting starts at "Speaker A/B/C" again; no automatic re-identification |
| Robustness against ASR hallucination | Not publicly documented | Explicit, layered guards: silence-gated skipping (`isSilentSegment`, -45dB mean-volume threshold) and repeated-phrase collapsing at both token and segment granularity ([transcription-quality.ts](../../apps/server/src/transcription-quality.ts)) |
| Slide/screen capture | Yes, threaded into transcript timeline | Not implemented |
| Summarization / action items | LLM post-processing | LLM post-processing producing structured JSON (summary, decisions, actionItems, openQuestions) via `gpt-4.1-mini` ([reporting.ts:130](../../apps/server/src/reporting.ts#L130)) |
| Downstream export | Workspace notes, integrations | Google Docs export + automatic Microsoft 365 export: a running Word doc (regenerated in full each time) and an Excel task tracker with an AI step that decides new-task vs. update-existing-task ([microsoft-export.ts](../../apps/server/src/microsoft-export.ts), see [design doc](../superpowers/specs/2026-08-29-pause-resume-speaker-memory-microsoft-export-design.md)) — more specialized than anything documented for Otter on this front |

Notably, the two-tier fast/final processing split and the layered hallucination guards are already more deliberate than what a "record then transcribe" tool would do — the gaps versus Otter are specifically around *streaming* and *cross-meeting speaker identity*, not general pipeline maturity.

## 3. Candidate improvements, ranked by leverage vs. effort

1. **Voice embeddings for known speakers** (highest leverage). Extend `known-speakers.ts` from `{name}` to `{name, embedding}`: when a user renames a speaker, extract a short reference clip and compute a voice embedding (hosted embedding API, or a local model such as ECAPA-TDNN/pyannote). On the next meeting, compare each new speaker's segment audio against stored embeddings and pre-fill the name instead of starting at "Speaker A" every time. This is the single change most likely to feel "Otter-like" to a returning user.

2. **Silence/turn-based segment boundaries instead of fixed-duration cuts.** The diarization segmenter currently splits every 1200s/600s regardless of content ([reporting.ts:212](../../apps/server/src/reporting.ts#L212)), which can slice a sentence or speaker turn exactly at the boundary — likely a real contributor to why `reconcileSpeakerLabels` needs to exist at all. Splitting on detected silence/turns (even a cheap VAD pass, short of full neural turn detection) instead of a stopwatch would reduce cross-chunk speaker fragmentation at the source rather than patching it after the fact.

3. **True incremental live transcript.** Today the "live" text only updates once each 30s chunk finishes processing server-side. A real streaming pass (e.g. OpenAI's Realtime transcription API) would give word-by-word text in the recording banner instead of 30-second-late blocks. Bigger lift than #1/#2 — worth it mainly if the live in-meeting experience matters, as distinct from the after-the-fact report.

4. **Bot-based capture as an alternative to the tab-capture extension.** Would remove the "keep this Chrome tab open with the extension installed" constraint and could extend beyond Google Meet to Zoom/Teams. Meaningfully bigger scope change (headless browser automation, or a hosted meeting-bot API such as Recall.ai) and overlaps with a deliberate build-vs-buy decision rather than something to default into.

5. **Slide/screen-share capture.** Relatively cheap to add given ffmpeg and an LLM are already in the pipeline: periodic screenshot of the shared tab plus a vision-model description, merged into the transcript timeline by timestamp.

## 4. Confidence notes

- Sections 1.1, 1.4, 1.5 are based on Otter's own help-center docs and product blog — high confidence.
- Section 1.3 (streaming diarization internals) is general industry architecture for this class of system, not confirmed as Otter's specific implementation — Otter has never published its internal diarization design. Treat as "how systems in this category typically work," not "confirmed Otter internals."
- The LLaMA-4 post-processing claim noted in 1.6 is explicitly flagged as unverified and should not inform any decision.

## Sources

- [Streaming Speaker Diarization: How It Works in Real Time — AssemblyAI](https://www.assemblyai.com/blog/streaming-speaker-diarization)
- [Otter Notetaker Overview – Help Center](https://help.otter.ai/hc/en-us/articles/4425393298327-OtterPilot-Overview)
- [Speaker Identification Overview – Help Center](https://help.otter.ai/hc/en-us/articles/21665587209367-Speaker-Identification-Overview)
- [Disable Speaker Learning – Help Center](https://help.otter.ai/hc/en-us/articles/40643231903639-Disable-Speaker-Learning)
- [Otter.ai Makes Live Transcription Easy for Zoom, Microsoft Teams, and Google Meet](https://otter.ai/blog/live-transcribing-zoom-microsoft-teams-and-google-meet-using-otterpilot)
- [New Otter® Chrome Extension — Businesswire](https://www.businesswire.com/news/home/20230228005674/en/New-Otter-Chrome-Extension-Makes-it-Easier-than-Ever-to-OtterPilot-Your-Zoom-and-Google-Meet-Meetings-with-an-AI-powered-Assistant)
- [Otter.ai — Wikipedia](https://en.wikipedia.org/wiki/Otter.ai)
