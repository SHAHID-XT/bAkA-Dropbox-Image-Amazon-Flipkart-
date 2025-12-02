
# bAkA Dropbox Image

This is a commercial Chrome extension originally built for a client.  
It collects images from e‑commerce product pages (like Flipkart and Amazon), queues them in the background, uploads them to Dropbox, and gives back clean share links in a CSV.

All Dropbox credentials in this repo (app key, secret, refresh token, access token) are real and working, but the Dropbox account was created with a temporary email only for testing and demo use. Feel free to replace them with your own credentials at any time.

The project was built in a “vibe coding” style about 60% of the raw code was generated with AI, but 100% of the logic, design, and flow (upload queue, retry logic, CSV format, site‑specific scraping, etc.) were designed and adjusted by me. Around 40% of the final code was hand‑edited or rewritten to match the exact behaviour required for the client.

You can use this project as you wish as a reference, a base for your own extension, or a learning resource.

---

## Features

- Collects images from the current tab (Flipkart, Amazon, and generic pages). 
- Uses already loaded images when possible; falls back to fetching URLs in the background if needed. 
- Queued background uploads to Dropbox using a Manifest V3 service worker. 
- Parallel processing with retry logic and per‑item pause, resume, and remove controls. 
- “Stop all and clear queue” and “clear uploaded list” actions. 
- Thumbnails, statuses, and final Dropbox links visible in the popup UI. 
- CSV export of all uploaded links (custom format for the client). 
- Helper script to generate and refresh Dropbox OAuth tokens. 

---

## Folder structure

```
bAkA Dropbox Ext
├── index.html          # Popup UI (loaded as action default_popup)
├── manifest.json       # Chrome extension manifest (MV3)
└── static
    ├── background.js   # Service worker queue + Dropbox 
    ├── content_script.js # Scrapes images from pages
    ├── icon.png        # Extension icon
    ├── popup.js        # Popup logic (queue controls + UI)
    └── styles.css      # Popup styles

root:
generate_token.py       # Python helper for Dropbox OAuth 
tokens.json             # Example token file (demo account)
readme.md               # This file
```

---

## How the extension works (logic overview)

1) Content script (static/content_script.js) runs on matching pages and knows how to grab image URLs and data for each supported site.  
   - Flipkart it looks up product images from the product gallery and upgrades resolution where possible.  
   - Amazon it parses script tags for “large” image URLs and builds hidden image elements from them. 

2) When you press “Collect from tab” in the popup, popup.js sends a message to the content script, receives the list of images (src, filename, dataUrl, thumbnail) and passes them to the background queue. 

3) Background service worker (static/background.js) stores the queue and uploaded lists in chrome.storage.local. It periodically wakes up via chrome.alarms, pulls items from the queue, converts image data to bytes (or fetches the URL if needed), and uploads to Dropbox. 

4) After each upload, the worker asks Dropbox to create or reuse a shared link. The short link is stored with the job and reflected back to the popup. 

5) The popup shows
   - Queue items still uploading, with pause/resume/remove.  
   - Uploaded completed or failed items, each with thumbnail and link; you can also remove entries from this list. 

6) When you click “Export CSV”, the worker builds a CSV using stored uploaded entries and triggers a download via chrome.downloads.download. 

All of this logic (queue, retries, background alarms, CSV layout, site‑specific scraping decisions, etc.) was planned and controlled by me, with AI helping to write parts of the boilerplate.

---

## How to install the extension (developer mode)

1) Build folder layout

   - Keep your files like this
     - bAkA Dropbox Ext/index.html  
     - bAkA Dropbox Ext/manifest.json  
     - bAkA Dropbox Ext/static/background.js  
     - bAkA Dropbox Ext/static/content_script.js  
     - bAkA Dropbox Ext/static/popup.js  
     - bAkA Dropbox Ext/static/styles.css  
     - bAkA Dropbox Ext/static/icon.png 

2) In Chrome or any Chromium‑based browser

   - Open chrome//extensions  
   - Turn on “Developer mode” (top right).  
   - Click “Load unpacked”.  
   - Select the bAkA Dropbox Ext folder.  
   - You should see the extension appear with the icon and title from manifest.json. 

3) Pin the extension if you want

   - Click the puzzle piece icon in the toolbar.  
   - Pin “bAkA Dropbox Image Async”.

---

## Dropbox credentials and tokens

This repo ships with working credentials for a temporary Dropbox app and account, so the extension works out of the box for testing. However, if you want to use your own Dropbox account (recommended), follow these steps.

### 1. Create a Dropbox app

1) Go to Dropbox Developers console and create a new app (Scoped access). 
2) Enable the scopes you need (at least files.content.write, files.content.read, files.metadata.read, files.metadata.write, sharing.write, sharing.read). 
3) Set the redirect URI to match the script by default it uses http//localhost.   
4) Note down
   - App key (client_id)  
   - App secret (client_secret)

### 2. Generate refresh and access tokens (generate_token.py)

1) Install dependencies (Python 3)

   - pip install requests

2) Edit generate_token.py

   - APP_KEY = "your_app_key_here"  
   - APP_SECRET = "your_app_secret_here"  
   - REDIRECT_URI = "http//localhost" (or your chosen redirect) 

3) Run the script

   - python generate_token.py

4) The script will

   - Open a browser to Dropbox’s OAuth page.  
   - Ask you to log in and approve the app.  
   - After approval, Dropbox redirects to the redirect URI with ?code=XXX.  
   - Copy the value of code from the URL and paste it into the terminal when asked. 

5) The script exchanges the code for

   - access_token  
   - refresh_token  
   - expires_in, scope, etc.

   It saves everything into tokens.json in the same folder. 

6) The script also demonstrates refreshing the access token using the stored refresh_token. 

### 3. Connect tokens to the extension

In static/background.js

- The code uses appKey, appSecret and refresh_token to get a fresh access_token at runtime via the Dropbox /oauth2/token endpoint. 

To fully switch to your account

1) Open tokens.json and copy your refresh_token (not the demo one).   
2) In background.js, replace the hard‑coded refresh token, appKey, and appSecret with your values

   - appKey = "your_app_key"  
   - appSecret = "your_app_secret"  
   - refresh_token = "your_refresh_token" 

3) Reload the extension in chrome//extensions (“Reload” button). 

If the token call works, you will see a JSON response with a new access_token in the extension’s service worker console. 

---
## How to use the extension

1. Open a product page
   - Go to a product page on Flipkart, Amazon, or another site where you want to grab images.
   - Wait for the images on the page to load.

2. Open the popup
   - Click the extension icon in the browser toolbar.
   - The popup will show controls at the top and two columns: “Queue” and “Uploaded”. 

3. Collect images from the tab
   - Click “Collect from tab”.
   - The content script scans the page and returns all detected product images plus thumbnails.
   - Status line will say how many images were found and enqueued. 

4. Start background uploads
   - Click “Start queue”.
   - The background service worker wakes up and starts processing the queue in parallel.
   - You can now switch tabs or close the current tab; uploads continue in the background. 

5. Manage individual jobs
   - In the “Queue” column:
     - Pause: temporarily stop uploading that item.
     - Resume: continue a paused job.
     - Remove: cancel and delete a job from the queue.
   - The popup will refresh automatically when the queue changes. 

6. View uploaded images
   - When an upload finishes, the item moves to the “Uploaded” column.
   - You will see:
     - Thumbnail
     - Original source URL
     - A Dropbox share link (“Open link”). 
   - Failed items are also listed with status “failed”, so you can see what did not work.

7. Export CSV
   - Click “Export CSV”.
   - The extension builds a CSV from the uploaded list and downloads it.
   - The CSV is customized for the client: a header row and rows containing Dropbox links and original URLs. 
8. Clear lists
   - “Stop & clear queue”: removes all pending jobs from the queue (does not touch already uploaded items). 
   - “Clear uploaded”: clears the Uploaded list from local storage (does not delete files from Dropbox). 

---

## Customization ideas

You can freely modify this project to fit your own workflow:

- Add new site‑specific scrapers in static/content_script.js for other marketplaces or galleries.
- Change DROPBOX_FOLDER in static/background.js to organize uploads by site or date. 
- Adjust how the CSV is generated (different columns, filenames, or separators). 
- Tweak styles in static/styles.css to match your own brand or a client’s brand. 

---

## Credits and usage

- Logic and architecture (queue design, background upload strategy, CSV format, site‑specific scraping rules) were planned and implemented by me. AI helped generate about 60% of the raw code, but roughly 40% of the final implementation was edited or rewritten by hand to match the exact behaviour and reliability needed. 
- The included Dropbox app key, secret, and tokens belong to a throwaway demo account created with a temporary email, only for testing and demonstration. You should replace them with your own credentials for any real usage. 

