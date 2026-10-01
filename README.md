# Calhoun Watermark & Upload

A single-user web app for your iPad: pick photos, stamp them with the
Calhoun Performance Photography logo (and/or a text watermark), and upload
the result straight to a Google Drive folder. No App Store, no Apple
Developer account — it runs as a website and installs to your Home Screen
like an app.

Everything happens in the browser. There is no server: your Google sign-in
and uploads go directly from your iPad to Google's APIs.

## One-time setup

### 1. Enable the Drive API on your Google Cloud project

1. Go to [Google Cloud Console → APIs & Services → Library](https://console.cloud.google.com/apis/library).
2. Make sure you're in the same project that owns your OAuth Client ID
   (`845304710957-...apps.googleusercontent.com`).
3. Search for **Google Drive API** and click **Enable** (skip if already enabled).

### 2. Authorize this site's URL on your OAuth Client

1. Go to **APIs & Services → Credentials**, click your OAuth 2.0 Client ID.
2. Under **Authorized JavaScript origins**, add:
   ```
   https://shanecalhoun.github.io
   ```
3. Save.
4. On the **OAuth consent screen**, make sure your Google account is listed
   as a **Test user** (the app can stay in "Testing" status — it's just for
   you).

### 3. Turn on GitHub Pages for this repo

1. On GitHub, go to **shanecalhoun/Jason → Settings → Pages**.
2. Under **Build and deployment**, set **Source** to `Deploy from a branch`.
3. Branch: `main`, folder: `/ (root)`. Save.
4. After a minute, your app will be live at:
   ```
   https://shanecalhoun.github.io/Jason/
   ```

### 4. Install it on your iPad

1. Open `https://shanecalhoun.github.io/Jason/` in **Safari** on the iPad.
2. Tap the **Share** button → **Add to Home Screen**.
3. Launch it from the Home Screen icon from now on — it opens full-screen
   like a normal app.

## Using the app

1. Tap **Sign in with Google** the first time (and whenever your session
   expires — tokens last about an hour).
2. Tap **⚙ Settings** to:
   - Confirm/replace the logo image, adjust its size/position/opacity.
   - Optionally enable a text watermark.
   - Choose where uploads go:
     - **Default**: the app creates (or reuses) its own Drive folder named
       "Watermarked Photos" — share that folder's link with whoever needs
       to view the photos (one-time, from Google Drive's own sharing UI).
     - **Existing folder**: check "Use an existing Drive folder" and paste
       a Drive folder link or ID. This requests full Drive access instead
       of the restricted "files this app created" access, since the app
       needs permission to write into a folder it didn't create.
3. Tap **Choose Photos**, pick one or more images from your Photos library.
4. Check the **Preview** panel to confirm the watermark looks right.
5. Tap **Watermark & Upload All**. Each photo is watermarked locally in the
   browser, then uploaded to the configured Drive folder.

## Notes

- This app is registered only for your own Google account (it stays in
  Google's "Testing" publishing mode) — nobody else can sign into it.
- Nothing is stored except your preferences (in the browser's local
  storage on that device) and a cached access token while a session is
  active.
- Updating the app later: edit the files in this repo and push to `main` —
  GitHub Pages redeploys automatically within a minute or two. Reload the
  app on the iPad (pull down or re-open) to pick up changes.
