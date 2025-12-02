// popup.js

const btnCollect  = document.getElementById("btnCollect");
const btnStart    = document.getElementById("btnStart");
const btnStopAll  = document.getElementById("btnStopAll");
const btnDownload = document.getElementById("btnDownload");
const btnClear    = document.getElementById("btnClear");

const queueEl    = document.getElementById("queue");
const uploadedEl = document.getElementById("uploaded");
const statusEl   = document.getElementById("status");

async function updateState() {
  const resp = await new Promise(resolve =>
    chrome.runtime.sendMessage({type: "getState"}, resolve)
  );
  if (!resp) return;
  renderQueue(resp.queue || []);
  renderUploaded(resp.uploaded || []);
}

function makeJobItem(it, isUploaded) {
  const li = document.createElement("li");
  li.className = "job-item";

  const thumb = document.createElement("div");
  thumb.className = "job-thumb";
  const img = document.createElement("img");
  img.src = it.thumbDataUrl || it.dataUrl || it.srcUrl || "";
  thumb.appendChild(img);

  const main = document.createElement("div");
  main.className = "job-main";

  const status = document.createElement("div");
  status.className = "job-status";
  status.textContent = isUploaded
    ? (it.dropboxUrl ? "done" : "failed")
    : (it.status || "queued");

  const urlLine = document.createElement("div");
  urlLine.className = "job-url";
  urlLine.textContent = it.srcUrl || "";

  main.appendChild(status);
  main.appendChild(urlLine);

  if (it.dropboxUrl) {
    const linkLine = document.createElement("div");
    const a = document.createElement("a");
    a.href = it.dropboxUrl;
    a.target = "_blank";
    a.textContent = "Open link";
    a.style.fontSize = "10px";
    a.style.color = "#7df2ff";
    a.style.textDecoration = "none";
    linkLine.appendChild(a);
    main.appendChild(linkLine);
  }

  li.appendChild(thumb);
  li.appendChild(main);

  const actions = document.createElement("div");
  actions.className = "job-actions";

  if (!isUploaded) {
    const pauseBtn = document.createElement("button");
    pauseBtn.textContent = it.paused ? "Resume" : "Pause";
    pauseBtn.addEventListener("click", async () => {
      await new Promise(resolve => chrome.runtime.sendMessage({
        type: it.paused ? "resumeItem" : "pauseItem",
        id: it.id
      }, resolve));
      updateState();
    });
    actions.appendChild(pauseBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Remove";
    cancelBtn.classList.add("danger");
    cancelBtn.addEventListener("click", async () => {
      await new Promise(resolve => chrome.runtime.sendMessage({
        type: "cancelItem",
        id: it.id
      }, resolve));
      updateState();
    });
    actions.appendChild(cancelBtn);
  } else {
    const removeUp = document.createElement("button");
    removeUp.textContent = "Remove";
    removeUp.classList.add("danger");
    removeUp.addEventListener("click", async () => {
      await new Promise(resolve => chrome.runtime.sendMessage({
        type: "removeUploaded",
        id: it.id
      }, resolve));
      updateState();
    });
    actions.appendChild(removeUp);
  }

  li.appendChild(actions);
  return li;
}

function renderQueue(q) {
  queueEl.innerHTML = "";
  q.forEach(it => {
    queueEl.appendChild(makeJobItem(it, false));
  });
}

function renderUploaded(u) {
  uploadedEl.innerHTML = "";
  u.forEach(it => {
    uploadedEl.appendChild(makeJobItem(it, true));
  });
}

btnCollect.addEventListener("click", async () => {
  statusEl.textContent = "Collecting images from current tab...";
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (!tab) {
    statusEl.textContent = "No active tab.";
    return;
  }

  chrome.tabs.sendMessage(tab.id, {type: "collectImages"}, async (resp) => {
    if (chrome.runtime.lastError) {
      statusEl.textContent = "Could not collect images.";
      return;
    }
    const items = (resp && resp.items) || [];
    if (items.length === 0) {
      statusEl.textContent = "No images found on page.";
      return;
    }
    await new Promise(resolve =>
      chrome.runtime.sendMessage({type: "enqueue", items}, resolve)
    );
    statusEl.textContent = `Enqueued ${items.length} images.`;
    await updateState();
  });
});

btnStart.addEventListener("click", async () => {
  statusEl.textContent = "Starting background uploads...";
  await new Promise(resolve =>
    chrome.runtime.sendMessage({type: "startNow"}, resolve)
  );
  updateState();
});

btnStopAll.addEventListener("click", async () => {
  await new Promise(resolve =>
    chrome.runtime.sendMessage({type: "clearQueue"}, resolve)
  );
  statusEl.textContent = "Cleared all queued jobs.";
  updateState();
});

btnDownload.addEventListener("click", async () => {
  await new Promise(resolve =>
    chrome.runtime.sendMessage({type: "downloadCSV"}, resolve)
  );
  statusEl.textContent = "CSV download started.";
});

btnClear.addEventListener("click", async () => {
  await new Promise(resolve =>
    chrome.runtime.sendMessage({type: "clearUploaded"}, resolve)
  );
  statusEl.textContent = "Cleared uploaded list.";
  updateState();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "queueUpdated") {
    updateState();
  }
});

updateState();
