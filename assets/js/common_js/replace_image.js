// ⚠️ Never expose PAT in production frontend
      const token = localStorage.getItem('feature_key'); 
      const repoOwner = localStorage.getItem('owner');
      const repoName = localStorage.getItem('repo_name');
      let commitMessage = "Update test via API";

      const branch = "main"; 
alert('image editing');

document.addEventListener('DOMContentLoaded', enableClickImageEditing);

async function enableClickImageEditing() {
  const elements = [];

  // 1️⃣ All <img> tags
  document.querySelectorAll('img').forEach(img => {
    elements.push({ element: img, type: 'img', src: img.src });
  });

  // 2️⃣ Inline background-image
  document.querySelectorAll('*[style]').forEach(el => {
    const bg = el.style.backgroundImage;
    const match = bg.match(/url\(["']?(.*?)["']?\)/);
    if (match && match[1]) elements.push({ element: el, type: 'bg-inline', src: match[1] });
  });

  // 3️⃣ Computed background-image (from external CSS)
  document.querySelectorAll('*').forEach(el => {
    const bg = getComputedStyle(el).backgroundImage;
    const match = bg && bg.match(/url\(["']?(.*?)["']?\)/);
    if (match && match[1]) {
      if (!elements.find(e => e.element === el)) {
        elements.push({ element: el, type: 'bg-computed', src: match[1] });
      }
    }
  });

  console.log("Editable elements found:", elements.length);

  // 4️⃣ Add .editable-image class + click handler
  elements.forEach(({ element, type, src }) => {
    element.classList.add('editable-image');

    // Create hidden file input for each element
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    // On click -> open file picker
    element.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      fileInput.click();
    });

    // On file select -> upload + update
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;

      const base64Content = await toBase64(file);
      const repoImagePath = extractRepoPath(src);

      if (!repoImagePath) {
        alert('❌ Cannot resolve GitHub file path for this image.');
        return;
      }

      const sha = await getLatestSha(repoImagePath);

      const response = await fetch(
        `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${repoImagePath}`,
        {
          method: "PUT",
          headers: {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            message: `Update ${repoImagePath}`,
            content: base64Content.split(",")[1],
            sha: sha,
            branch: branch
          })
        }
      );

      const result = await response.json();

      if (result.content && result.commit) {
        const blobSha = result.content.sha;
        const latest = await fetch(
          `https://api.github.com/repos/${repoOwner}/${repoName}/git/blobs/${blobSha}`,
          {
            headers: {
              Authorization: `token ${token}`,
              Accept: "application/vnd.github+json"
            }
          }
        );
        const latestData = await latest.json();
        const imageBase64 = "data:image/png;base64," + latestData.content;

        if (type === 'img') {
          element.src = imageBase64;
        } else {
          element.style.backgroundImage = `url(${imageBase64})`;
        }
      } else {
        alert("Upload failed: " + result.message);
      }
    });
  });
}

// 🧩 Convert to Base64
function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
  });
}

// 🧩 Get SHA for existing file
async function getLatestSha(filePath) {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${filePath}?ref=${branch}`,
      { headers: { Authorization: `token ${token}` } }
    );
    if (res.ok) {
      const data = await res.json();
      return data.sha;
    }
  } catch {
    console.warn("SHA fetch failed; creating new file.");
  }
  return null;
}

// 🧩 Smarter path extraction
function extractRepoPath(src) {
  try {
    const url = new URL(src, window.location.origin);
    const path = url.pathname;
    const idx = path.lastIndexOf('/assets/images/');
    if (idx !== -1) {
      return "public" + path.substring(idx);
    }
  } catch (e) {
    console.error("Invalid image src:", src);
  }
  return null;
}

