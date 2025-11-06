/* image_editor_v3.js
   Full-featured visual image editor for <img>, backgrounds, sliders & pseudo-elements.
   - Adds highlight border for selected images
   - Shows loading spinner while uploading
   - Supports both server and GitHub uploads
   - Safe for dynamically loaded content (headers, footers, sliders)
*/

/* ========================= CONFIG ========================= */
const IMAGE_EDITOR_CONFIG = {
  enableDirectGitHubUpload: false, // ⚠️ Only enable in development
  github: {
    repoOwner: localStorage.getItem('owner'),
    repoName: localStorage.getItem('repo_name'),
    branch: "main",
    token: localStorage.getItem('feature_key')
  },
  serverUploadEndpoint: null // e.g. "/api/upload-image"
};

/* ========================= MAIN ========================= */
(function () {
  if (window.__imageEditorV3Loaded) return;
  window.__imageEditorV3Loaded = true;

  let currentElement = null;

  /* ---------- Create shared file input ---------- */
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  document.body.appendChild(fileInput);

  /* ---------- Create loader overlay ---------- */
  const loader = document.createElement('div');
  loader.className = 'img-edit-loader';
  loader.innerHTML = `<div class="spinner"></div><p>Uploading...</p>`;
  loader.style.display = 'none';
  document.body.appendChild(loader);

  /* ---------- Utility functions ---------- */
  function showLoader() { loader.style.display = 'flex'; }
  function hideLoader() { loader.style.display = 'none'; }

  function debounce(fn, wait = 120) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  }

  function toBase64(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  function extractUrlFromCssValue(cssValue) {
    if (!cssValue) return null;
    const m = cssValue.match(/url\(["']?(.*?)["']?\)/);
    return m ? m[1] : null;
  }

  function normalizeUrl(url) {
    try {
      if (!url) return null;
      if (url.startsWith('data:')) return url;
      return new URL(url, window.location.origin).href;
    } catch (e) {
      return url;
    }
  }

  function extractRepoPath(src) {
    if (!src) return null;
    try {
      const url = new URL(src, window.location.origin);
      const path = url.pathname;
      const candidates = ['/assets/images/', '/assets/img/', '/images/', '/img/'];
      for (const seg of candidates) {
        const idx = path.indexOf(seg);
        if (idx !== -1) {
          return ('public' + path.substring(idx)).replace(/^\/+/, '');
        }
      }
    } catch (e) {}
    return null;
  }

  /* ---------- Upload handlers ---------- */
  async function uploadToServer(base64, filename) {
    if (!IMAGE_EDITOR_CONFIG.serverUploadEndpoint)
      return { success: false, message: 'no-server' };
    try {
      const res = await fetch(IMAGE_EDITOR_CONFIG.serverUploadEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, content: base64 })
      });
      const json = await res.json();
      return { success: !!res.ok, data: json };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  async function uploadToGitHub(repoPath, base64, existingSha = null) {
    if (!IMAGE_EDITOR_CONFIG.enableDirectGitHubUpload)
      return { success: false, message: 'disabled' };
    const { repoOwner, repoName, branch, token } = IMAGE_EDITOR_CONFIG.github;
    const payload = {
      message: `Update ${repoPath}`,
      content: base64.split(',')[1],
      branch
    };
    if (existingSha) payload.sha = existingSha;
    try {
      const res = await fetch(
        `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${repoPath}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `token ${token}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        }
      );
      const j = await res.json();
      return { success: res.ok, data: j };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  async function getGithubSha(repoPath) {
    if (!IMAGE_EDITOR_CONFIG.enableDirectGitHubUpload) return null;
    const { repoOwner, repoName, branch, token } = IMAGE_EDITOR_CONFIG.github;
    try {
      const res = await fetch(
        `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${repoPath}?ref=${branch}`,
        { headers: { Authorization: `token ${token}` } }
      );
      if (!res.ok) return null;
      const j = await res.json();
      return j.sha;
    } catch (e) {
      return null;
    }
  }

  /* ---------- Detection ---------- */
  function detectEditableOnNode(node) {
    const results = [];
    if (node.tagName?.toLowerCase() === 'img') {
      const src = node.getAttribute('src') || node.dataset.src || node.src;
      if (src) results.push({ el: node, type: 'img', src: normalizeUrl(src) });
    }

    const dataAttrs = ['data-bg', 'data-src', 'data-background', 'data-image', 'data-lazy'];
    for (const attr of dataAttrs) {
      if (node.hasAttribute?.(attr)) {
        const val = node.getAttribute(attr);
        if (val) results.push({ el: node, type: 'bg-data', src: normalizeUrl(val) });
      }
    }

    if (node.style?.backgroundImage) {
      const scr = extractUrlFromCssValue(node.style.backgroundImage);
      if (scr) results.push({ el: node, type: 'bg-inline', src: normalizeUrl(scr) });
    }

    try {
      const comp = getComputedStyle(node).backgroundImage;
      const scr = extractUrlFromCssValue(comp);
      if (scr) results.push({ el: node, type: 'bg-computed', src: normalizeUrl(scr) });
    } catch {}

    try {
      ['::before', '::after'].forEach(pseudo => {
        const comp = getComputedStyle(node, pseudo).backgroundImage;
        const scr = extractUrlFromCssValue(comp);
        if (scr)
          results.push({ el: node, type: 'bg-pseudo', src: normalizeUrl(scr), pseudo });
      });
    } catch {}

    return results;
  }

  /* ---------- Make Editable ---------- */
  function makeEditable(editable) {
    const { el, type, src, pseudo } = editable;
    if (!el || el.dataset.__editable_v3) return;

    el.dataset.__editable_v3 = '1';
    el.dataset.__editable_v3_src = src || '';
    el.classList.add('editable-image');

    el.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();

      document.querySelectorAll('.editable-image.selected-image')
        .forEach(x => x.classList.remove('selected-image'));

      el.classList.add('selected-image');

      currentElement = { el, type, pseudo };
      fileInput.value = '';
      setTimeout(() => fileInput.click(), 20);
    });
  }

  function markEditableImages(root = document) {
    const nodes = root.querySelectorAll('*');
    [...nodes].forEach(node => {
      detectEditableOnNode(node).forEach(d => makeEditable(d));
    });
  }

  /* ---------- Handle File Selection ---------- */
  fileInput.addEventListener('change', async function () {
    const f = this.files?.[0];
    if (!f || !currentElement) return;
    showLoader();
    try {
      const base64 = await toBase64(f);
      const el = currentElement.el;
      const type = currentElement.type;

      if (type === 'img') el.src = base64;
      else el.style.backgroundImage = `url(${base64})`;

      const originalSrc = el.dataset.__editable_v3_src;
      const repoPath = extractRepoPath(originalSrc);

      if (IMAGE_EDITOR_CONFIG.serverUploadEndpoint) {
        const res = await uploadToServer(base64, f.name);
        if (res.success && res.data?.url) {
          el.src = res.data.url;
          el.style.backgroundImage = `url(${res.data.url})`;
        }
        alert('Image uploaded successfully!');
      } else if (IMAGE_EDITOR_CONFIG.enableDirectGitHubUpload && repoPath) {
        const sha = await getGithubSha(repoPath);
        const res = await uploadToGitHub(repoPath, base64, sha);
        if (res.success) alert('Image uploaded to GitHub!');
      } else {
        console.log('Local preview only.');
      }
    } catch (e) {
      console.error('Error:', e);
      alert('Error updating image.');
    } finally {
      hideLoader();
      currentElement = null;
    }
  });

  /* ---------- Mutation Observer ---------- */
  const mutationHandler = debounce(mutations => {
    const newNodes = new Set();
    for (const m of mutations) {
      if (m.addedNodes) {
        m.addedNodes.forEach(n => {
          if (n.nodeType === 1) newNodes.add(n);
        });
      }
    }
    newNodes.forEach(n => markEditableImages(n));
  }, 100);

  const observer = new MutationObserver(mutationHandler);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  /* ---------- Init ---------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => markEditableImages(document));
  } else markEditableImages(document);

  /* ---------- Styles ---------- */
  const style = document.createElement('style');
  style.textContent = `
    .editable-image {
      cursor: pointer;
      transition: filter .15s ease, outline .15s ease, box-shadow .15s ease;
      position: relative;
    }
    .editable-image:hover {
      filter: brightness(0.9);
      outline: 2px dashed rgba(255, 255, 255, 0.3);
      outline-offset: 3px;
    }
    .editable-image.selected-image {
      outline: 3px solid #00bcd4 !important;
      box-shadow: 0 0 10px rgba(0, 188, 212, 0.8);
      filter: brightness(1);
    }
    .img-edit-loader {
      display: none;
      position: fixed;
      top: 0; left: 0;
      width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.5);
      z-index: 99999;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      color: white;
      font-family: sans-serif;
    }
    .img-edit-loader .spinner {
      border: 4px solid rgba(255,255,255,0.3);
      border-top: 4px solid #00bcd4;
      border-radius: 50%;
      width: 50px; height: 50px;
      animation: spin 1s linear infinite;
      margin-bottom: 10px;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
})();
