# Start the Meet Notes Assistant

## One-time setup

1. Install the project packages from the project folder:

   ```powershell
   pnpm install
   ```

2. Create an OpenAI API key and set it for the current PowerShell window:

   ```powershell
   $env:OPENAI_API_KEY = "paste-your-key-here"
   ```

3. Start the private local service:

   ```powershell
   pnpm --filter @meet-notes/server start
   ```

4. Leave that window open. Open [http://localhost:8787](http://localhost:8787) in Chrome to see your meeting dashboard.

## Install the Chrome extension

1. In Chrome, open `chrome://extensions`.
2. Turn on **Developer mode** in the top-right corner.
3. Select **Load unpacked**.
4. Select this folder:

   `C:\Users\jayhe\OneDrive\Desktop\projects\gmeet-recorder\apps\extension\dist`

5. Pin **Meet Notes Assistant** from the Chrome extensions menu.

## Use it in a Google Meet

1. Join a Google Meet in Chrome.
2. When the call is active, the extension shows **Meeting detected**.
3. Choose the meeting language: Hindi/Hinglish, Marathi/Marathi-English, English, or Auto-detect.
4. Tell participants the call will be recorded, then click **Start recording**.
5. A red **Recording** banner stays visible during the call.
6. Click **Stop** when the meeting finishes.
7. Open the dashboard at [http://localhost:8787](http://localhost:8787). The report will progress from **processing** to **ready**.

The report includes the transcript, speaker labels, talk time, English summary, decisions, action items, and download option.

## Google Docs export (optional)

To enable the **Export to Google Docs** button, create a Google OAuth Web Application credential and add this redirect URL:

`http://localhost:8787/api/google/callback`

Before starting the service, set these values in the same PowerShell window:

```powershell
$env:GOOGLE_CLIENT_ID = "your-client-id"
$env:GOOGLE_CLIENT_SECRET = "your-client-secret"
$env:GOOGLE_REDIRECT_URI = "http://localhost:8787/api/google/callback"
```

In the dashboard, open a completed meeting and choose **Export to Google Docs**. The first time, sign in to the Google account where you want reports saved.

## Important

- This initial build runs on your own computer at `localhost`, so it is private to that computer.
- Each person should be told the call is being recorded before you start.
- Keep the service window open while recording and processing.
- Raw audio is stored locally in the project's `apps/server/data` folder and is deleted automatically 24 hours after a completed report, or immediately when you delete the meeting. Configure storage/deployment before using it for sensitive or multi-user production meetings.
