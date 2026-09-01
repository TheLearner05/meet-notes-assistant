# Start the Meet Notes Assistant

## One-time setup

1. Install the project packages from the project folder:

   ```powershell
   pnpm install
   ```

2. Install [FFmpeg](https://ffmpeg.org/download.html) and make sure it is on your `PATH` (for example `winget install ffmpeg` or `choco install ffmpeg`). The service uses it to prepare both the initial notes and the speaker report — meeting processing fails without it. Confirm it's found with:

   ```powershell
   ffmpeg -version
   ```

3. Create an OpenAI API key and set it for the current PowerShell window:

   ```powershell
   $env:OPENAI_API_KEY = "paste-your-key-here"
   ```

4. Start the private local service:

   ```powershell
   pnpm --filter @meet-notes/server start
   ```

5. Leave that window open. Open [http://localhost:8787](http://localhost:8787) in Chrome to see your meeting dashboard.

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
5. A red **Recording** banner stays visible during the call, with a **Pause**/**Resume** button for breaks that shouldn't be transcribed.
6. Click **Stop** when the meeting finishes.
7. Open the dashboard at [http://localhost:8787](http://localhost:8787). The report will progress from **processing** to **ready**.

The report includes the transcript, speaker labels, talk time, English summary, decisions, action items, and download option. Open a meeting's report and choose **Rename speakers** to give "Speaker A" real names — every name you type is remembered and offered as a suggestion the next time you rename someone.

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

## Microsoft 365 export (optional)

Every meeting is automatically published to your OneDrive once its report is ready — no button click needed — as a single running Word document (all meetings appended, most recent last) and synced into a task-tracking Excel workbook, where an AI step decides whether each action item is a new task or an update to one already tracked.

1. Register an app at [entra.microsoft.com](https://entra.microsoft.com) (App registrations → New registration). Add this redirect URI as a **Web** platform:

   `http://localhost:8787/api/microsoft/callback`

2. Under **API permissions**, add the delegated Microsoft Graph permission `Files.ReadWrite`, plus `offline_access` (usually included by default).
3. Under **Certificates & secrets**, create a client secret and copy its value immediately — it's shown only once.
4. Before starting the service, set these values in the same PowerShell window:

   ```powershell
   $env:MICROSOFT_CLIENT_ID = "your-application-client-id"
   $env:MICROSOFT_CLIENT_SECRET = "your-client-secret-value"
   $env:MICROSOFT_TENANT_ID = "common"
   $env:MICROSOFT_WORD_PATH = "/Meeting Reports/Running Report.docx"
   $env:MICROSOFT_EXCEL_PATH = "/Meeting Reports/Tasks.xlsx"
   ```

   (`MICROSOFT_TENANT_ID` can stay `common` for a personal Microsoft account; the Word/Excel paths are OneDrive paths, created automatically the first time they're needed.)
5. Open the dashboard and click **Connect Microsoft 365** in the top-right corner. Sign in once — after that, every finished meeting exports automatically.

If an export fails (for example, the connection expires), it's noted on that meeting's report without affecting the transcript, summary, or any other export.

## Important

- This initial build runs on your own computer at `localhost`, so it is private to that computer.
- Each person should be told the call is being recorded before you start.
- Keep the service window open while recording and processing.
- Raw audio is stored locally in the project's `apps/server/data` folder and is deleted automatically 24 hours after a completed report, or immediately when you delete the meeting. Configure storage/deployment before using it for sensitive or multi-user production meetings.
- The service only accepts requests from a Chrome extension (any extension, not just this one — other extensions installed in the same browser could otherwise also reach it). To restrict it to only this extension, open `chrome://extensions`, copy this extension's ID, and set it before starting the service: `$env:ALLOWED_EXTENSION_ID = "paste-the-id-here"`.
