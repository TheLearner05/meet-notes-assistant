# Fast, quality-first meeting results

## Goal

For meetings up to two hours, make an initial transcript and summary available within two minutes of recording stop under normal network and API availability. Keep the final speaker-labelled transcript and talk-time report accurate by continuing to use `gpt-4o-transcribe-diarize` on the complete recording.

## User experience

1. While recording, the extension uploads 30-second audio chunks as it does now.
2. The local server transcribes each completed chunk in the background using `gpt-4o-transcribe`. These are fast, high-quality provisional transcript segments without speaker labels.
3. After stop, the dashboard shows `Preparing final notes` until the final chunk is transcribed and the initial summary is ready.
4. The dashboard then shows the initial transcript and summary with `Speaker report still processing`.
5. A full-file diarization job runs separately. When it completes, its accurate speaker-labelled transcript, speaker statistics, and final report replace the provisional results.

## Architecture

- The Chrome extension remains responsible only for capture and chunk upload. It never receives the OpenAI API key.
- The local server owns a bounded background queue for provisional chunk transcription. It stores each result with its chunk sequence and elapsed-time offset.
- The meeting record adds distinct provisional and final-processing fields so a fast result cannot be mistaken for the final speaker report.
- Finishing a meeting waits for queued provisional chunk jobs, generates the initial summary from their ordered text, and immediately publishes it.
- The existing full-file diarization pipeline then runs independently. It keeps the current Hindi/Marathi auto-detection behavior and becomes the authoritative final report.

## Quality and speed decisions

- Use `gpt-4o-transcribe` rather than a mini model for provisional text quality.
- Use `gpt-4o-transcribe-diarize` only for the complete final speaker report, where cross-meeting speaker attribution needs the full recording.
- Process chunks with bounded concurrency so transcription keeps up during long meetings without overwhelming the local machine or API limits.
- The two-minute target applies to the initial transcript and summary, not the final speaker report. The final speaker report is intentionally quality-first and may take longer for long meetings.

## Failure handling

- A failed provisional chunk is recorded and retried once; it does not block the final diarization pipeline.
- If provisional processing is incomplete at stop, the dashboard states that fast notes are delayed rather than showing an incomplete report as final.
- If final diarization fails, the initial transcript and summary remain available and the dashboard offers a retry.

## Verification

- Unit tests cover queue ordering, bounded concurrency, elapsed-time offset calculation, and status transitions.
- Server tests cover finish behavior with provisional results available and unavailable.
- Extension tests cover upload metadata needed for the provisional transcript path.
- Manual acceptance test: record a multi-language meeting, stop it, confirm initial notes appear within the target window, then confirm the speaker report replaces them later.
