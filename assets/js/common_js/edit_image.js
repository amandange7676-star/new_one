     const token = localStorage.getItem('feature_key'); 
      const repoOwner = localStorage.getItem('owner');
      const repoName = localStorage.getItem('repo_name');
      let commitMessage = "Update test via API";

      const branch = "main"; 
alert('image editing');


document.addEventListener("DOMContentLoaded", enableAllImageEditing);

function enableAllImageEditing() {
  // Handle <img> tags
  const imgElements = document.querySelectorAll("img");
  imgElements.forEach(makeEditable);

  // Handle background images (sections, divs, sliders)
  const allElements = document.querySelectorAll("*");
  allElements.forEach((el) => {
    const bg = window.getComputedStyle(el).backgroundImage;
    if (bg && bg !== "none" && bg.includes("url(")) {
      el.classList.add("image-editable");
      el.addEventListener("click", () => handleEdit(el, true));
    }
  });
}

// Make normal <img> editable
function makeEditable(img) {
  img.classList.add("image-editable");
  img.addEventListener("click", () => handleEdit(img, false));
}

// Core edit handler (both img + background)
async function handleEdit(element, isBackground) {
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.style.display = "none";
  document.body.appendChild(fileInput);

  fileInput.click();

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;

    const base64Content = await toBase64(file);

    // Extract source path
    let imageSrc = isBackground
      ? extractUrlFromBackground(element)
      : element.getAttribute("src");

    const repoImagePath = extractRepoPath(imageSrc);
    if (!repoImagePath) {
      alert("Unable to resolve GitHub file path from image src.");
      return;
    }

    const sha = await getLatestSha(repoImagePath);
    const commitMessage = `Update ${repoImagePath} via Image Editor`;

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
          content: base64Content.split(",")[1],
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
      const newImageBase64 = "data:image/png;base64," + latestData.content;

      if (isBackground) {
        element.style.backgroundImage = `url(${newImageBase64})`;
      } else {
        element.src = newImageBase64;
      }
    } else {
      alert("Upload failed: " + result.message);
    }

    fileInput.remove();
  });
}

// Helpers
function extractUrlFromBackground(el) {
  const bg = window.getComputedStyle(el).backgroundImage;
  const match = bg.match(/url\(["']?(.*?)["']?\)/);
  return match ? match[1] : null;
}

function extractRepoPath(src) {
  try {
    const url = new URL(src, window.location.origin);
    const path = url.pathname;
    if (path.includes("/assets/images/")) {
      return "public" + path;
    }
  } catch (e) {
    console.error("Invalid image src:", src);
  }
  return null;
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
  });
}

async function getLatestSha(filePath) {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${filePath}?ref=${branch}`,
      {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github+json",
        },
      }
    );
    if (res.ok) {
      const data = await res.json();
      return data.sha;
    }
  } catch (err) {
    console.warn("SHA fetch failed or file not found, will create new.");
  }
  return null;
}
