// background.js - MV3 service worker

const DROPBOX_FOLDER = "/extension-uploads";
const UPLOAD_URL      = "https://content.dropboxapi.com/2/files/upload";
const CREATE_LINK_URL = "https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings";
const LIST_LINKS_URL  = "https://api.dropboxapi.com/2/sharing/list_shared_links";
const QUEUE_KEY    = "upload_queue";
const UPLOADED_KEY = "uploaded_list";

function log(...args) {
  // console.log("[bg]", ...args); 
}

function genId() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

async function getQueue() {
  const res = await chrome.storage.local.get([QUEUE_KEY]);
  return res[QUEUE_KEY] || [];
}

async function setQueue(q) {
  await chrome.storage.local.set({[QUEUE_KEY]: q});
}

async function getUploaded() {
  const res = await chrome.storage.local.get([UPLOADED_KEY]);
  return res[UPLOADED_KEY] || [];
}

async function setUploaded(u) {
  await chrome.storage.local.set({[UPLOADED_KEY]: u});
}

async function setItemInQueue(item) {
  const q = await getQueue();
  const idx = q.findIndex(x => x.id === item.id);
  if (idx >= 0) q[idx] = item;
  else q.push(item);
  await setQueue(q);
  chrome.runtime.sendMessage({type: "queueUpdated"});
}

async function removeItemFromQueue(id) {
  const q = await getQueue();
  const newQ = q.filter(x => x.id !== id);
  await setQueue(newQ);
  chrome.runtime.sendMessage({type: "queueUpdated"});
}

async function finalizeSuccess(item) {
  log("finalizeSuccess", item.id);
  await removeItemFromQueue(item.id);
  const up = await getUploaded();
  up.push({
    id: item.id,
    srcUrl: item.srcUrl,
    dropboxUrl: item.dropboxUrl,
    thumbDataUrl: item.thumbDataUrl || null
  });
  await setUploaded(up);
  chrome.runtime.sendMessage({type: "queueUpdated"});
}

async function finalizeFailure(item) {
  log("finalizeFailure (removing)", item.id, item.error);
  await removeItemFromQueue(item.id);
  const up = await getUploaded();
  up.push({
    id: item.id,
    srcUrl: item.srcUrl,
    dropboxUrl: null,
    thumbDataUrl: item.thumbDataUrl || null,
    error: item.error || "failed"
  });
  await setUploaded(up);
  chrome.runtime.sendMessage({type: "queueUpdated"});
}


async function getAccessToken() {
    let appKey = "[REDACTED]";
    let appSecret ="[REDACTED]";
    const params = new URLSearchParams();
    params.append("refresh_token", '[REDACTED]');
    params.append("grant_type", "refresh_token");
    params.append("client_id", appKey);
    params.append("client_secret", appSecret);

    const res = await fetch("https://api.dropbox.com/oauth2/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: params
    });

    const data = await res.json();
    console.log(data);
    return data.access_token;
}



// Safe dataURL -> ArrayBuffer (null if invalid)
function dataUrlToArrayBuffer(dataUrl) {
  try {
    if (!dataUrl || !dataUrl.startsWith("data:")) return null;
    const parts = dataUrl.split(",");
    if (parts.length < 2) return null;
    const base64 = parts[1];
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  } catch (e) {
    log("dataUrlToArrayBuffer error", e);
    return null;
  }
}

// Fetch image bytes from URL as fallback
async function downloadImageBytes(url) {
  log("downloadImageBytes", url);
  const resp = await fetch(url, {mode: "cors"});
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    log("downloadImageBytes failed", resp.status, txt);
    throw new Error("download failed: " + resp.status);
  }
  return await resp.arrayBuffer();
}

async function uploadToDropbox(accessToken, path, arrayBuffer) {
  log("uploadToDropbox", path);
  const apiArg = {
    path,
    mode: "overwrite",
    autorename: false,
    mute: false,
    strict_conflict: false
  };

  const headers = {
    "Authorization": `Bearer ${accessToken}`,
    "Content-Type": "application/octet-stream",
    "Dropbox-API-Arg": JSON.stringify(apiArg)
  };

  const resp = await fetch(UPLOAD_URL, {
    method: "POST",
    headers,
    body: arrayBuffer
  });


  if (!resp.ok) {
    const txt = await resp.text();
    log("uploadToDropbox failed", resp.status, txt);
    throw new Error("upload failed: " + resp.status + " - " + txt);
  }

  const j = await resp.json();
  log("uploadToDropbox ok", j.path_display || j.path_lower);
  await sleep(1000);
  return j;   

}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
async function createSharedLink(accessToken, path) {
  log("createSharedLink", path);
  const headers = {
    "Authorization": `Bearer ${accessToken}`,
    "Content-Type": "application/json"
  };

  const payload = {
    path,
    settings: {requested_visibility: "public"}
  };

  const resp = await fetch(CREATE_LINK_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
  await sleep(1000);
  if (resp.ok) {
    const j = await resp.json();
    const url = (j.url || "").replace("?dl=0", "");
    log("createSharedLink ok (new)", url);
    return url;
  }

  log("createSharedLink create failed, trying list_shared_links");
  const lresp = await fetch(LIST_LINKS_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({path, direct_only: true})
  });

  if (lresp.ok) {
    const lj = await lresp.json();
    if (lj.links && lj.links.length) {
      const url = (lj.links[0].url || "").replace("?dl=0", "");
      log("createSharedLink ok (existing)", url);
      return url;
    }
  }

  throw new Error("create_shared_link failed");
}

async function processOneItem(item, accessToken) {
  const queue = await getQueue();
  const fresh = queue.find(x => x.id === item.id);
  if (!fresh) {
    log("processOneItem: item gone", item.id);
    return;
  }
  if (fresh.cancelled) {
    log("processOneItem: cancelled", item.id);
    return;
  }
  if (fresh.paused) {
    log("processOneItem: paused", item.id);
    return;
  }
  item = fresh;

  try {
    log("processOneItem starting", item.id);
    item.status = "preparing";
    await setItemInQueue(item);

    let bytes = null;

    // 1) Try dataUrl first
    if (item.dataUrl) {
      bytes = dataUrlToArrayBuffer(item.dataUrl);
      if (!bytes) {
        log("processOneItem dataUrl invalid, will fallback to fetch", item.id);
      }
    }

    // 2) Fallback: fetch from srcUrl
    if (!bytes) {
      if (!item.srcUrl) {
        item.status = "error";
        item.error = "No srcUrl/dataUrl";
        await setItemInQueue(item);
        await finalizeFailure(item);
        return;
      }
      bytes = await downloadImageBytes(item.srcUrl);
    }

    let nameFromUrl;
    nameFromUrl = genId()
    const path = `${DROPBOX_FOLDER}/${nameFromUrl}.jpg`;

    if (item.cancelled) {
      log("processOneItem: cancelled before upload", item.id);
      return;
    }

    item.status = "uploading";
    await setItemInQueue(item);

    const meta = await uploadToDropbox(accessToken, path, bytes);

    if (item.cancelled) {
      log("processOneItem: cancelled after upload", item.id);
      return;
    }

    item.status = "creating_link";
    await setItemInQueue(item);

    const link = await createSharedLink(
      accessToken,
      meta.path_lower || meta.path_display || path
    );

    item.status = "done";
    item.dropboxUrl = link;
    await finalizeSuccess(item);
    log("processOneItem done", item.id, link);
  } catch (err) {
    item.tries = (item.tries || 0) + 1;
    item.status = "error";
    item.error = err.message || String(err);
    await setItemInQueue(item);
    log("processOneItem error", item.id, item.error, "tries", item.tries);

    if (item.tries >= 3) {
      await finalizeFailure(item);
    }
  }
}

async function processQueue() {
  const queue = await getQueue();
  log("processQueue called, size", queue.length);
  if (!queue || queue.length === 0) return;

  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    log("Failed to get access token", err);
    return;
  }

  const ready = queue.filter(i =>
    !i.paused &&
    !i.cancelled &&
    i.status !== "uploading" &&
    i.status !== "downloading" &&
    i.status !== "creating_link"
  );

  log("processQueue ready items", ready.map(r => r.id));
  
  const toProcess = ready.slice(0, 30);
  await Promise.all(toProcess.map(it => processOneItem(it, accessToken)));
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "processQueue") {
    log("alarm fired: processQueue");
    await processQueue();
  }
});

chrome.runtime.onInstalled.addListener(() => {
  log("onInstalled: creating alarm");
  chrome.alarms.create("processQueue", {periodInMinutes: 0.5});
});

chrome.runtime.onStartup.addListener(() => {
  log("onStartup: creating alarm");
  chrome.alarms.create("processQueue", {periodInMinutes: 0.5});
});

async function enqueueImages(items) {
  let q = await getQueue();
  for (const it of items) {
    const id = genId();

    log("enqueue image", id, it.srcUrl);
    q.push({
      id,
      srcUrl: it.srcUrl,
      filename: it.filename || null,
      status: "queued",
      progress: 0,
      dropboxUrl: null,
      tries: 0,
      dataUrl: it.dataUrl || null,
      thumbDataUrl: it.thumbDataUrl || null,
      paused: false,
      cancelled: false
    });
  }
  q = q.filter(
    (item, index, arr) =>
        arr.findIndex(x => x.dataUrl === item.dataUrl) === index
);
  await setQueue(q);
  chrome.alarms.create("processQueue", {periodInMinutes: 0.5});
  chrome.runtime.sendMessage({type: "queueUpdated"});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (!msg || !msg.type) {
        sendResponse({ok: false, error: "no_type"});
        return;
      }

      log("onMessage", msg.type, msg.id || "");

      if (msg.type === "enqueue") {
        await enqueueImages(msg.items || []);
        sendResponse({ok: true});
      } else if (msg.type === "getState") {
        const q = await getQueue();
        const up = await getUploaded();
        sendResponse({queue: q, uploaded: up});
      } else if (msg.type === "startNow") {
        chrome.alarms.create("processQueue", {when: Date.now() + 500});
        sendResponse({ok: true});
      } else if (msg.type === "downloadCSV") {
        const up = await getUploaded();
        const dropBoxurls = up.map(v => v.dropboxUrl);
        const srcUrls = up.map(v => v.srcUrl);
        try{
        
      let srcHeaders = srcUrls.map((_, i) => `Image ${i+1}`).join(",");
      let srcValues  = srcUrls.map(v => v).join(",");

      let dropValues  = dropBoxurls.map(v => v).join(",");
          
      const csv = [
          srcHeaders,
          dropValues,
          srcValues,
      ].join("\n");

      const base64 = btoa(csv);
      const dataUrl = "data:text/csv;charset=utf-8;base64," + base64;

      chrome.downloads.download({
          url: dataUrl,
          filename: "bOkAdRoPbOx.csv"
      });
    }catch(e){
    }
        sendResponse({ok: true});
      } else if (msg.type === "clearUploaded") {
        await setUploaded([]);
        chrome.runtime.sendMessage({type: "queueUpdated"});
        sendResponse({ok: true});
      } else if (msg.type === "pauseItem") {
        const q = await getQueue();
        const it = q.find(x => x.id === msg.id);
        if (it) {
          it.paused = true;
          await setQueue(q);
          chrome.runtime.sendMessage({type: "queueUpdated"});
        }
        sendResponse({ok: true});
      } else if (msg.type === "resumeItem") {
        const q = await getQueue();
        const it = q.find(x => x.id === msg.id);
        if (it) {
          it.paused = false;
          await setQueue(q);
          chrome.runtime.sendMessage({type: "queueUpdated"});
        }
        chrome.alarms.create("processQueue", {when: Date.now() + 500});
        sendResponse({ok: true});
      } else if (msg.type === "cancelItem" || msg.type === "removeItem") {
        await removeItemFromQueue(msg.id);
        sendResponse({ok: true});
      } else if (msg.type === "clearQueue") {
        await setQueue([]);
        chrome.runtime.sendMessage({type: "queueUpdated"});
        sendResponse({ok: true});
      } else if (msg.type === "removeUploaded") {
        const up = await getUploaded();
        const newUp = up.filter(x => x.id !== msg.id);
        await setUploaded(newUp);
        chrome.runtime.sendMessage({type: "queueUpdated"});
        sendResponse({ok: true});
      } else {
        sendResponse({ok: false, error: "unknown_type"});
      }
    } catch (e) {
      log("onMessage error", e);
      sendResponse({ok: false, error: e.message || String(e)});
    }
  })();

  return true;
});
