
function toDataUrlFromImage(img, maxWidth = 1024) {
  try {
    const canvas = document.createElement("canvas");
    const ratio = img.naturalWidth > 0 ? img.naturalWidth / img.naturalHeight : 1;
    const targetWidth = Math.min(maxWidth, img.naturalWidth || maxWidth);
    const targetHeight = targetWidth / ratio;

    canvas.width = targetWidth || 1;
    canvas.height = targetHeight || 1;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.9);
  } catch (e) {
    console.warn("[content_script] toDataUrlFromImage failed", e);
    return img.src || null;
  }
}

function toThumbDataUrl(img, thumbWidth = 120) {
  try {
    const canvas = document.createElement("canvas");
    const ratio = img.naturalWidth > 0 ? img.naturalWidth / img.naturalHeight : 1;
    const targetWidth = Math.min(thumbWidth, img.naturalWidth || thumbWidth);
    const targetHeight = targetWidth / ratio;

    canvas.width = targetWidth || 1;
    canvas.height = targetHeight || 1;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch (e) {
    console.warn("[content_script] toThumbDataUrl failed", e);
    return img.src || null;
  }
}

function collectImagesRich() {
  const url = window.location.href;
  let imgs;
  let platform;

  if (url.includes("flipkart.com")) {
      imgs = Array.from( document.querySelectorAll("div ul li div div img") || []);
      platform = "flipkart";
  } else if (url.includes("amazon.in") || url.includes("amazon.com")) {

        let elements = [];
        document.querySelectorAll("script").forEach(el => {
            const script = el.innerHTML;
            const urls = [...script.matchAll(/"large"\s*:\s*"([^"]+)"/g)]
             .map(m => m[1]);

            if (urls.length > 0) {
                elements = urls.map(src => {
                    const img = document.createElement("img");
                    img.src = src;

                    img.classList.add("hidden"); // optional
                    return img;
                });
                console.log("elements:", elements);
            }
        });


      imgs = Array.from(elements || []);

  } else {
      console.log("unknown site");
  }


  const items = [];

  imgs.forEach(img => {
    if (!img.src) return;
    let srcUrl;
    srcUrl = img.src;
    if (platform=="flipkart"){
      srcUrl = srcUrl.replace("/image/128/128/", "/image/1500/1500/");
    }
    let filename = null;
    try {
      const u = new URL(srcUrl, location.href);
      const last = u.pathname.split("/").pop();
      if (last) filename = last;
    } catch (e) {}

    const dataUrl = toDataUrlFromImage(img);
    const thumbDataUrl = toThumbDataUrl(img);

    items.push({
      srcUrl,
      filename,
      dataUrl,
      thumbDataUrl
    });
  });

  console.log("[content_script] collected", items.length, "images");
  return items;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "collectImages") {
    collectImagesRich();
    const items = collectImagesRich();
    sendResponse({items});
  }
  return true;
});
