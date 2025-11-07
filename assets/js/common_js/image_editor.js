const token = localStorage.getItem('feature_key');
const repoOwner = localStorage.getItem('owner');
const repoName = localStorage.getItem('repo_name');
const branch = "main";

// ======= Inject Orange Overlay CSS =======
function injectEditableImageCSS() {
  const style = document.createElement("style");
  style.textContent = `
    .image-editable {
      position: relative;
      cursor: pointer;
      transition: all 0.3s ease-in-out;
    }
    .image-editable::after {
      content: "";
      position: absolute;
      inset: 0;
      background: rgba(255, 165, 0, 0.4);
      opacity: 0;
      transition: opacity 0.3s ease-in-out;
      pointer-events: none;
      z-index: 10;
    }
    .image-editable:hover::after {
      opacity: 1;
    }
    .image-preview-overlay {
      position: absolute;
      inset: 0;
      background-size: cover;
      background-position: center;
      z-index: 12;
      opacity: 0.95;
      pointer-events: none;
      border: 2px solid #fff;
      box-shadow: 0 0 10px rgba(0,0,0,0.3);
    }
  `;
  document.head.appendChild(style);
}

// ======= Enable editable class across the whole page =======
function enableAllImageEditing(root = document) {
  // <img> tags
  const imgs = root.querySelectorAll("img:not(.image-editable-initialized)");
  imgs.forEach((img) => {
    const src = img.getAttribute("src");
    if (src && src.includes("assets/images")) {
      img.classList.add("image-editable", "image-editable-initialized");

      // Add dashed box
      img.style.outline = "2px dashed #333";
      img.style.padding = "2px";

      img.addEventListener("click", (e) => {
        const parentLink = img.closest("a");
        if (parentLink) { e.preventDefault(); e.stopPropagation(); }
        handleEdit(img, false);
      });
    }
  });

  // Elements with background images
  const all = root.querySelectorAll("*:not(.image-editable-initialized)");
  all.forEach((el) => {
    const bgStyle = el.style.background || el.style.backgroundImage;
    const computedBg = window.getComputedStyle(el).backgroundImage;
    const bg = bgStyle || computedBg;

    if (bg && bg.includes("url(")) {
      // Extract URL from background
      const match = bg.match(/url\(["']?(.*?)["']?\)/);
      if (match && match[1].includes("assets/images")) {
        el.classList.add("image-editable", "image-editable-initialized");

        // Add dashed box
        el.style.outline = "2px dashed #333";
        el.style.padding = "2px";

        el.addEventListener("click", (e) => {
          e.stopPropagation();
          handleEdit(el, true);
        });
      }
    }
  });
}

// ======= Handle Edit Flow =======
async function handleEdit(element, isBackground) {
  const originalSrc = isBackground
    ? extractUrlFromBackground(element)
    : element.getAttribute("src");

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.style.display = "none";
  document.body.appendChild(fileInput);
  fileInput.click();

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const base64 = await toBase64(file);

    // Create inline preview
    let previewOverlay;
    if (isBackground) {
      previewOverlay = document.createElement("div");
      previewOverlay.className = "image-preview-overlay";
      previewOverlay.style.backgroundImage = `url(${base64})`;
      element.style.position = "relative";
      element.appendChild(previewOverlay);
    } else {
      // For <img>, overlay a preview div to avoid reflow
      const wrapper = document.createElement("div");
      const rect = element.getBoundingClientRect();
      wrapper.className = "image-preview-overlay";
      wrapper.style.backgroundImage = `url(${base64})`;
      wrapper.style.width = `${rect.width}px`;
      wrapper.style.height = `${rect.height}px`;
      wrapper.style.position = "absolute";
      wrapper.style.top = `${element.offsetTop}px`;
      wrapper.style.left = `${element.offsetLeft}px`;
      wrapper.style.pointerEvents = "none";
      wrapper.style.borderRadius = getComputedStyle(element).borderRadius;
      element.parentElement.style.position = "relative";
      element.parentElement.appendChild(wrapper);
      previewOverlay = wrapper;
    }

    // Ask confirmation
    const confirmUpload = confirm("Do you want to upload this image?");
    if (!confirmUpload) {
      previewOverlay.remove();
      fileInput.remove();
      return;
    }

    // Proceed upload
    const repoImagePath = extractRepoPath(originalSrc);
    if (!repoImagePath) {
      alert("Unable to resolve GitHub file path from image src.");
      previewOverlay.remove();
      fileInput.remove();
      return;
    }

    const sha = await getLatestSha(repoImagePath);
    const commitMessage = `Update ${repoImagePath} via editor`;

    const response = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${repoImagePath}`,
      {
        method: "PUT",
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: commitMessage,
          content: base64.split(",")[1],
          sha: sha,
          branch: branch,
        }),
      }
    );

    const result = await response.json();
    console.log("Upload result:", result);

    if (result.content && result.commit) {
      const blobSha = result.content.sha;
      const latest = await fetch(
        `https://api.github.com/repos/${repoOwner}/${repoName}/git/blobs/${blobSha}`,
        {
          headers: {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github+json",
          },
        }
      );
      const latestData = await latest.json();
      const newBase64 = "data:image/png;base64," + latestData.content;

      if (isBackground) {
        element.style.backgroundImage = `url(${newBase64})`;
      } else {
        element.src = newBase64;
      }

      alert("✅ Image uploaded successfully!");
    } else {
      alert("❌ Upload failed: " + (result.message || "Unknown error"));
    }

    previewOverlay.remove();
    fileInput.remove();
  });
}

// ======= Observe dynamically added sections =======
function observeDynamicImages() {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) enableAllImageEditing(node);
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// ======= Helpers =======
function extractUrlFromBackground(el) {
  const bg = window.getComputedStyle(el).backgroundImage;
  const match = bg.match(/url\\(["']?(.*?)["']?\\)/);
  return match ? match[1] : null;
}
function extractRepoPath(src) {
  try {
    const url = new URL(src, window.location.origin);
    const path = url.pathname;
    if (path.includes("/assets/images/")) return "public" + path;
  } catch { console.error("Invalid image src:", src); }
  return null;
}
function toBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.readAsDataURL(file);
    r.onload = () => resolve(r.result);
    r.onerror = reject;
  });
}
async function getLatestSha(filePath) {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${filePath}?ref=${branch}`,
      {
        headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" }
      }
    );
    if (res.ok) return (await res.json()).sha;
  } catch { console.warn("SHA fetch failed."); }
  return null;
}

// ======= Init =======
document.addEventListener("DOMContentLoaded", () => {
  injectEditableImageCSS();
  enableAllImageEditing();
  observeDynamicImages();
});
