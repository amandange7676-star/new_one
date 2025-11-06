/* image_editor_v2.js
   Robust editor for <img> and background images (inline, computed, slider data attrs, pseudo-elements)
   - Does immediate local preview
   - Has hooks for server/GitHub upload (upload disabled by default)
   - Safe to include on pages that dynamically load header/footer/slider content
*/

/* ========================= CONFIG ========================= */
// Upload configuration
const IMAGE_EDITOR_CONFIG = {
  enableDirectGitHubUpload: false, // set true only for dev/testing; DO NOT set true in production
  github: {
    repoOwner: ocalStorage.getItem('owner'),
    repoName: ocalStorage.getItem('repo_name'),
    branch: "main",
    token: ocalStorage.getItem('feature_key')// placeholder only
  },
  // OR use your own server endpoint that accepts { filename, base64 } and returns public URL or success
  serverUploadEndpoint: null // e.g. "/api/upload-image" - if set, this endpoint will be used
};

/* ========================= shared file input ========================= */
(function () {
  if (window.__imageEditorV2Loaded) return;
  window.__imageEditorV2Loaded = true;

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  document.body.appendChild(fileInput);

  let currentElement = null; // element user is editing

  // debounce helpers for performance
  function debounce(fn, wait = 120) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  /* ========================= utilities ========================= */
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
      // if it's already data: return as-is
      if (url.startsWith('data:')) return url;
      // Some slider libs use "//domain/path", handle that:
      const normalized = new URL(url, window.location.origin).href;
      return normalized;
    } catch (e) {
      return url; // best effort
    }
  }

  // Try to resolve repo path from a URL (customize to your repo structure)
  function extractRepoPath(src) {
    if (!src) return null;
    if (src.startsWith('data:')) return null;
    try {
      const url = new URL(src, window.location.origin);
      const path = url.pathname; // e.g. /assets/images/...
      // common patterns:
      const candidates = [
        '/assets/images/',
        '/assets/img/',
        '/images/',
        '/img/'
      ];
      for (const seg of candidates) {
        const idx = path.indexOf(seg);
        if (idx !== -1) {
          // Return "public" + path after seg to match your repo layout (adjust if needed)
          return ('public' + path.substring(idx)).replace(/^\/+/, '');
        }
      }
    } catch (e) {
      console.warn('extractRepoPath error', e);
    }
    return null;
  }

  /* ========================= Upload helpers (server or GitHub) ========================= */

  async function uploadToServer(base64, filename) {
    // If user configured a server endpoint, call it
    if (!IMAGE_EDITOR_CONFIG.serverUploadEndpoint) return { success: false, message: 'no-server' };

    try {
      const res = await fetch(IMAGE_EDITOR_CONFIG.serverUploadEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, content: base64 })
      });
      const json = await res.json();
      return { success: !!res.ok, data: json };
    } catch (err) {
      console.error('server upload error', err);
      return { success: false, message: err.message || 'server-error' };
    }
  }

  async function uploadToGitHub(repoPath, base64, existingSha = null) {
    if (!IMAGE_EDITOR_CONFIG.enableDirectGitHubUpload) {
      return { success: false, message: 'direct-github-disabled' };
    }
    const { repoOwner, repoName, branch, token } = IMAGE_EDITOR_CONFIG.github;
    const payload = {
      message: `Update ${repoPath}`,
      content: base64.split(',')[1],
      branch
    };
    if (existingSha) payload.sha = existingSha;
    try {
      const res = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/contents/${repoPath}`, {
        method: 'PUT',
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
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
      const res = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/contents/${repoPath}?ref=${branch}`, {
        headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' }
      });
      if (!res.ok) return null;
      const j = await res.json();
      return j.sha;
    } catch (err) {
      return null;
    }
  }

  /* ========================= detection logic ========================= */

  // checks a node for any editable image sources. returns array of {el, type, src}
  function detectEditableOnNode(node) {
    const results = [];

    // 1) <img> tag
    if (node.tagName && node.tagName.toLowerCase() === 'img') {
      const src = node.getAttribute('src') || node.src || node.dataset.src;
      if (src) results.push({ el: node, type: 'img', src: normalizeUrl(src) });
    }

    // 2) <picture> / <source> tags inside node
    if (node.tagName && node.tagName.toLowerCase() === 'picture') {
      const imgs = node.querySelectorAll('img');
      imgs.forEach(img => {
        const src = img.getAttribute('src') || img.src || img.dataset.src;
        if (src) results.push({ el: img, type: 'img', src: normalizeUrl(src) });
      });
    }

    // 3) data attr common for sliders and lazy loaders
    const dataAttrs = ['data-bg', 'data-src', 'data-background', 'data-image', 'data-lazy'];
    for (const attr of dataAttrs) {
      if (node.hasAttribute && node.hasAttribute(attr)) {
        const val = node.getAttribute(attr);
        if (val) results.push({ el: node, type: 'bg-data', src: normalizeUrl(val) });
      }
    }

    // 4) inline style background image on the element
    if (node.style && node.style.backgroundImage) {
      const scr = extractUrlFromCssValue(node.style.backgroundImage);
      if (scr) results.push({ el: node, type: 'bg-inline', src: normalizeUrl(scr) });
    }

    // 5) computed background-image (covers external CSS)
    try {
      if (node.nodeType === 1) {
        const comp = getComputedStyle(node).backgroundImage;
        const scr = extractUrlFromCssValue(comp);
        if (scr) results.push({ el: node, type: 'bg-computed', src: normalizeUrl(scr) });
      }
    } catch (e) {
      // ignore cross-origin issues
    }

    // 6) pseudo-elements ::before and ::after
    try {
      ['::before', '::after'].forEach(pseudo => {
        const comp = getComputedStyle(node, pseudo).backgroundImage;
        const scr = extractUrlFromCssValue(comp);
        if (scr) results.push({ el: node, type: 'bg-pseudo', src: normalizeUrl(scr), pseudo });
      });
    } catch (e) {}

    return results;
  }

  /* ========================= mark element editable ========================= */

  function makeEditable(editable) {
    const { el, type, src, pseudo } = editable;
    if (!el || el.dataset.__editable_v2) {
      // If element already configured, ensure pseudo background listeners are tracked separately
      if (pseudo && el.dataset.__editable_v2_pseudos && el.dataset.__editable_v2_pseudos.includes(pseudo)) {
        return;
      }
    }

    // mark processed flags
    el.dataset.__editable_v2 = el.dataset.__editable_v2 || '1';
    if (pseudo) {
      el.dataset.__editable_v2_pseudos = (el.dataset.__editable_v2_pseudos || '') + pseudo;
    }

    // add visual class
    el.classList.add('editable-image');

    // store original src in dataset for mapping
    // keep the raw src string (may be absolute or relative)
    try { el.dataset.__editable_v2_src = src || el.dataset.__editable_v2_src || ''; } catch(e){}

    // click handler
    const handler = function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      currentElement = { el, type, pseudo };
      fileInput.value = '';
      // small delay to allow other UI events to settle
      setTimeout(() => fileInput.click(), 10);
    };

    // Add listener if not already added
    if (!el.dataset.__editable_v2_click) {
      el.addEventListener('click', handler);
      el.dataset.__editable_v2_click = '1';
    }
  }

  /* ========================= main scanning method ========================= */

  // Walk a subtree and detect new editable images; root defaults to document
  function markEditableImages(root = document) {
    if (!root) return;
    const nodes = root.querySelectorAll ? root.querySelectorAll('*') : [];
    // include the root node itself if it's an element
    const toCheck = [];
    if (root.nodeType === 1) toCheck.push(root);
    for (let i = 0; i < nodes.length; i++) toCheck.push(nodes[i]);

    toCheck.forEach(node => {
      // small guard for performance: skip when already processed
      if (node.dataset && node.dataset.__editable_v2_skip) return;

      const detected = detectEditableOnNode(node);
      if (detected && detected.length) {
        detected.forEach(d => makeEditable(d));
      }
      // flag as checked
      if (node.dataset) node.dataset.__editable_v2_skip = '1';
    });
  }

  /* ========================= handle file selection ========================= */

  fileInput.addEventListener('change', async function () {
    const f = this.files && this.files[0];
    if (!f || !currentElement) return;
    try {
      const base64 = await toBase64(f);

      // immediate local preview
      if (currentElement.type === 'img') {
        currentElement.el.src = base64;
      } else if (currentElement.type === 'bg-data') {
        // if element uses data-bg, update attribute + inline style
        currentElement.el.setAttribute('data-bg', base64);
        currentElement.el.style.backgroundImage = `url(${base64})`;
      } else if (currentElement.type === 'bg-pseudo') {
        // pseudo elements cannot be set directly - we inject an inline style override
        const uniqueClass = currentElement.el.dataset.__editable_v2_overrideclass || `editable-bg-override-${Math.random().toString(36).slice(2,8)}`;
        if (!currentElement.el.dataset.__editable_v2_overrideclass) currentElement.el.dataset.__editable_v2_overrideclass = uniqueClass;
        // build CSS rule for pseudo
        const rule = `.${uniqueClass}${currentElement.pseudo} { background-image: url("${base64}") !important; }`;
        injectStyleForElement(currentElement.el, rule);
      } else {
        // bg-inline or bg-computed
        currentElement.el.style.backgroundImage = `url(${base64})`;
      }

      // now upload if configured (server preferred)
      const originalSrc = currentElement.el.dataset.__editable_v2_src || null;
      const repoPath = extractRepoPath(originalSrc);

      // if server endpoint provided, use it
      if (IMAGE_EDITOR_CONFIG.serverUploadEndpoint) {
        const filename = generateFilenameFromSrc(originalSrc, f.name);
        const sres = await uploadToServer(base64, filename);
        if (sres.success) {
          console.log('server upload OK', sres.data);
          // optionally, if server returned a public URL, update the element to that URL instead of data:
          if (sres.data && sres.data.url) {
            updateElementUrlAfterUpload(currentElement, sres.data.url);
          }
          alert('Image uploaded to server and preview updated.');
        } else {
          console.warn('server upload failed', sres);
          alert('Upload to server failed (check console). Preview updated locally.');
        }
      } else if (IMAGE_EDITOR_CONFIG.enableDirectGitHubUpload && repoPath) {
        const sha = await getGithubSha(repoPath);
        const gres = await uploadToGitHub(repoPath, base64, sha);
        if (gres.success) {
          alert('Image uploaded to GitHub and preview updated.');
          // optional: replace preview with the actual repo URL (if desired)
        } else {
          console.warn('github upload failed', gres);
          alert('GitHub upload failed (check console). Preview updated locally.');
        }
      } else {
        // No upload configured, keep local preview only
        // For production, recommend uploading server-side and updating repo path
        console.info('No upload configured. Preview is local only.');
      }

    } catch (err) {
      console.error('error handling file', err);
      alert('Error processing image (see console).');
    } finally {
      currentElement = null;
    }
  });

  /* ========================= helpers for CSS injection and updates ========================= */

  function injectStyleForElement(el, rule) {
    // create per-element style tag to avoid collisions
    const existing = el.__editableV2StyleTag;
    if (existing) {
      existing.textContent = rule;
      return existing;
    }
    const s = document.createElement('style');
    s.type = 'text/css';
    s.textContent = rule;
    document.head.appendChild(s);
    el.__editableV2StyleTag = s;
    return s;
  }

  function generateFilenameFromSrc(src, fallbackName = 'image.png') {
    if (!src) return fallbackName;
    try {
      const u = new URL(src, window.location.origin);
      const parts = u.pathname.split('/');
      const name = parts.pop() || fallbackName;
      return name.split('?')[0].split('#')[0] || fallbackName;
    } catch (e) {
      // fallback
      return fallbackName;
    }
  }

  function updateElementUrlAfterUpload(info, publicUrl) {
    if (!info) return;
    if (info.type === 'img') {
      info.el.src = publicUrl;
    } else if (info.type === 'bg-pseudo') {
      const cls = info.el.dataset.__editable_v2_overrideclass;
      const rule = `.${cls}${info.pseudo} { background-image: url("${publicUrl}") !important; }`;
      injectStyleForElement(info.el, rule);
    } else {
      // set inline style and data-attr
      info.el.style.backgroundImage = `url(${publicUrl})`;
      ['data-bg','data-src','data-background','data-image'].forEach(a => {
        if (info.el.hasAttribute(a)) info.el.setAttribute(a, publicUrl);
      });
    }
  }

  /* ========================= MutationObserver: watch for DOM changes & attribute changes ========================= */

  const mutationHandler = debounce((mutations) => {
    const nodesToScan = new Set();
    for (const m of mutations) {
      // added nodes
      if (m.addedNodes && m.addedNodes.length) {
        m.addedNodes.forEach(n => {
          if (n.nodeType === 1) nodesToScan.add(n);
        });
      }
      // attribute changes (style/class/data-src changes)
      if (m.type === 'attributes' && m.target && m.target.nodeType === 1) {
        nodesToScan.add(m.target);
      }
    }
    nodesToScan.forEach(n => {
      // clear skip flag so we re-evaluate if necessary
      if (n.dataset) delete n.dataset.__editable_v2_skip;
      markEditableImages(n);
    });
  }, 80);

  const observer = new MutationObserver(mutationHandler);
  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'data-bg', 'data-src', 'data-background', 'src']
  });

  /* ========================= public API exposure ========================= */

  window.markEditableImages = function (root) {
    try {
      markEditableImages(root || document);
    } catch (e) {
      console.error('markEditableImages error', e);
    }
  };

  // initial run on DOMContentLoaded (and also run asap if DOM already ready)
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(() => markEditableImages(document), 20);
  } else {
    document.addEventListener('DOMContentLoaded', () => markEditableImages(document));
  }

  /* ========================= small UI helpers (CSS) ========================= */
  const styleTag = document.createElement('style');
  styleTag.textContent = `
  .editable-image { cursor: pointer; transition: filter .15s ease, outline .12s ease; }
  .editable-image:hover { filter: brightness(.92); outline: 2px dashed rgba(255,255,255,0.08); outline-offset: 3px; }
  `;
  document.head.appendChild(styleTag);

})(); // end IIFE
