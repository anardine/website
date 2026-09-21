const canvas = document.getElementById('canvas');
const titleInput = document.getElementById('title');
const slugInput = document.getElementById('slug');
const descriptionInput = document.getElementById('description');
const dateInput = document.getElementById('date');
const readMinutesInput = document.getElementById('readMinutes');
const updatedInput = document.getElementById('updated');
const dateMetaRawInput = document.getElementById('dateMetaRaw');
const loadSelect = document.getElementById('loadSelect');
const statusMsg = document.getElementById('statusMsg');
const previewTitle = document.getElementById('previewTitle');
const previewMeta = document.getElementById('previewMeta');
const draftInfo = document.getElementById('draftInfo');

let slugManuallyEdited = false;
let currentMode = 'new';
let selectedImage = null;

dateInput.valueAsDate = new Date();

function simpleSlug(text) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

titleInput.addEventListener('input', () => {
  if (!slugManuallyEdited) slugInput.value = simpleSlug(titleInput.value);
  renderPreview();
});
slugInput.addEventListener('input', () => {
  slugManuallyEdited = true;
});
[dateInput, readMinutesInput, updatedInput, dateMetaRawInput].forEach((el) =>
  el.addEventListener('input', renderPreview)
);

// ---- live post header preview (mirrors server render_post_html) ----
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function displayDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function buildDateMeta() {
  const raw = dateMetaRawInput.value.trim();
  if (raw) return raw;
  const mins = parseInt(readMinutesInput.value, 10) || 5;
  let meta = `${displayDate(dateInput.value)} &middot; ${mins} min read<br>`;
  const updated = updatedInput.value.trim();
  if (updated) meta += `Updated: ${escapeHtml(updated)}<br>`;
  return meta;
}

function renderPreview() {
  const title = titleInput.value.trim();
  previewTitle.textContent = title || 'Untitled post';
  previewTitle.classList.toggle('is-placeholder', !title);
  previewMeta.innerHTML = buildDateMeta();
  // Autosave only begins once the post has a title (see the autosave section).
  if (currentMode !== 'edit' && !title) updateDraftInfo('Autosave starts once you add a title');
}

function escapeAttr(s) {
  return (s || '').replace(/"/g, '&quot;');
}
function escapeHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---- caret-aware insertion ----
function insertHtmlAtCaret(html) {
  canvas.focus();
  const sel = window.getSelection();
  let range;
  if (sel.rangeCount && canvas.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    range = sel.getRangeAt(0);
  } else {
    range = document.createRange();
    range.selectNodeContents(canvas);
    range.collapse(false);
  }
  range.deleteContents();
  const frag = range.createContextualFragment(html);
  const lastNode = frag.lastChild;
  range.insertNode(frag);
  if (lastNode) {
    range.setStartAfter(lastNode);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

canvas.addEventListener('click', (event) => {
  if (selectedImage) selectedImage.classList.remove('editor-selected-image');
  selectedImage = event.target.closest('img');
  if (selectedImage && canvas.contains(selectedImage)) {
    selectedImage.classList.add('editor-selected-image');
  } else {
    selectedImage = null;
  }
  document.getElementById('btnEditImage').disabled = !selectedImage;
});

// ---- toolbar: simple execCommand actions ----
document.querySelectorAll('#toolbar button[data-cmd]').forEach((btn) => {
  btn.addEventListener('click', () => {
    canvas.focus();
    document.execCommand(btn.dataset.cmd, false, null);
  });
});

// ---- toolbar: block formatting (auto-adds <hr> after h2/h3 per site convention) ----
document.querySelectorAll('#toolbar button[data-block]').forEach((btn) => {
  btn.addEventListener('click', () => applyBlock(btn.dataset.block));
});

function applyBlock(tag) {
  canvas.focus();
  document.execCommand('formatBlock', false, tag);
  if (tag === 'h2' || tag === 'h3') {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    let node = sel.getRangeAt(0).startContainer;
    while (node && node.nodeType !== 1) node = node.parentNode;
    while (node && node.parentNode !== canvas) node = node.parentNode;
    if (node && /^H[23]$/i.test(node.tagName)) {
      const next = node.nextElementSibling;
      if (!next || next.tagName !== 'HR') {
        node.after(document.createElement('hr'));
      }
    }
  }
}

document.getElementById('btnInlineCode').addEventListener('click', () => {
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const code = document.createElement('code');
  code.appendChild(range.extractContents());
  range.insertNode(code);
});

// ---- image dialog ----
const imgDialog = document.getElementById('imgDialog');
document.getElementById('btnImage').addEventListener('click', () => {
  if (selectedImage) selectedImage.classList.remove('editor-selected-image');
  selectedImage = null;
  document.getElementById('btnEditImage').disabled = true;
  imgDialog.showModal();
});
document.getElementById('btnEditImage').addEventListener('click', () => {
  if (!selectedImage) return;
  const style = selectedImage.style;
  const size = (style.maxWidth || '100%').replace('%', '');
  document.getElementById('imgAlt').value = selectedImage.alt || '';
  document.getElementById('imgSize').value = parseInt(size, 10) || 100;
  document.getElementById('imgCaption').value = selectedImage.closest('figure')?.querySelector('figcaption')?.textContent.trim() || '';
  document.getElementById('imgAlign').value = style.float || (selectedImage.parentElement?.style.justifyContent === 'center' ? 'center' : 'full');
  imgDialog.showModal();
});
document.getElementById('imgCancel').addEventListener('click', () => imgDialog.close());
document.getElementById('imgInsert').addEventListener('click', async () => {
  const file = document.getElementById('imgFile').files[0];
  if (selectedImage && !file) {
    updateImageSettings(selectedImage);
    imgDialog.close();
    statusMsg.textContent = 'Image adjusted';
    return;
  }
  if (!file) {
    alert('Choose an image file first.');
    return;
  }
  const slug = slugInput.value || simpleSlug(titleInput.value);
  if (!slug) {
    alert('Set a title/slug before adding images.');
    return;
  }
  const form = new FormData();
  form.append('file', file);
  form.append('slug', slug);
  statusMsg.textContent = 'Uploading image…';
  try {
    const res = await fetch('/api/upload-image', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'upload failed');
    const alt = document.getElementById('imgAlt').value;
    const size = document.getElementById('imgSize').value || '100';
    const align = document.getElementById('imgAlign').value;
    const caption = document.getElementById('imgCaption').value;
    insertHtmlAtCaret(buildImageHtml(data.url, alt, size, align, caption));
    statusMsg.textContent = data.warning ? `Image inserted (${data.warning})` : 'Image inserted';
    imgDialog.close();
    document.getElementById('imgFile').value = '';
    document.getElementById('imgAlt').value = '';
    document.getElementById('imgCaption').value = '';
  } catch (err) {
    statusMsg.textContent = '';
    alert('Image upload failed: ' + err.message);
  }
});

function updateImageSettings(image) {
  const alt = document.getElementById('imgAlt').value;
  const size = document.getElementById('imgSize').value || '100';
  const align = document.getElementById('imgAlign').value;
  image.alt = alt;
  image.style.maxWidth = `${size}%`;
  image.style.height = 'auto';
  image.style.float = align === 'left' || align === 'right' ? align : 'none';
  image.style.marginLeft = align === 'right' ? '3ch' : '';
  image.style.marginRight = align === 'left' ? '3ch' : '';
  image.style.marginTop = align === 'left' || align === 'right' ? '3ch' : '';
  const wrapper = image.parentElement;
  if (wrapper?.tagName === 'DIV' && wrapper.style.display === 'flex') {
    wrapper.style.justifyContent = align === 'center' ? 'center' : 'flex-start';
  }
  const figure = image.closest('figure');
  if (figure) {
    const caption = document.getElementById('imgCaption').value.trim();
    const captionElement = figure.querySelector('figcaption');
    if (captionElement && caption) captionElement.innerHTML = `<i>${escapeHtml(caption)}</i>`;
    if (captionElement && !caption) captionElement.remove();
    figure.style.maxWidth = `${size}%`;
    figure.style.float = align === 'left' || align === 'right' ? align : 'none';
    figure.style.marginLeft = align === 'right' ? '3ch' : '';
    figure.style.marginRight = align === 'left' ? '3ch' : '';
  }
}

function buildImageHtml(url, alt, size, align, caption) {
  const altAttr = alt ? ` alt="${escapeAttr(alt)}"` : '';
  if (caption) {
    let figStyle = `max-width:${size}%;`;
    if (align === 'left') figStyle += 'float:left;margin-right:3ch;margin-top:3ch;';
    if (align === 'right') figStyle += 'float:right;margin-left:3ch;margin-top:3ch;';
    const fig = `<figure style="${figStyle}"><img style="border: none;" src="${url}"${altAttr} loading="lazy"><figcaption><i>${escapeHtml(
      caption
    )}</i></figcaption></figure>`;
    if (align === 'center' || align === 'full') {
      return `<div style="display: flex; justify-content: center;">${fig}</div><br>`;
    }
    return fig;
  }
  let imgStyle = `max-width:${size}%;height:auto;`;
  if (align === 'left') imgStyle += 'float:left;margin-right:3ch;margin-top:3ch;';
  if (align === 'right') imgStyle += 'float:right;margin-left:3ch;margin-top:3ch;';
  const img = `<img src="${url}"${altAttr} style="${imgStyle}" loading="lazy" />`;
  if (align === 'center') {
    return `<div style="display: flex; justify-content: center;">${img}</div><br>`;
  }
  return img;
}

// ---- table dialog ----
const tableDialog = document.getElementById('tableDialog');
document.getElementById('btnTable').addEventListener('click', () => tableDialog.showModal());
document.getElementById('tblCancel').addEventListener('click', () => tableDialog.close());
document.getElementById('tblInsert').addEventListener('click', () => {
  const rows = parseInt(document.getElementById('tblRows').value, 10) || 1;
  const cols = parseInt(document.getElementById('tblCols').value, 10) || 1;
  insertHtmlAtCaret(buildTableHtml(rows, cols));
  tableDialog.close();
});

function buildTableHtml(rows, cols) {
  const thead = '<tr>' + Array.from({ length: cols }, (_, i) => `<th>Header ${i + 1}</th>`).join('') + '</tr>';
  let body = '';
  for (let r = 0; r < rows; r++) {
    body += '<tr>' + Array.from({ length: cols }, () => '<td>Cell</td>').join('') + '</tr>';
  }
  return `<table class="usb" style="width: 100%;"><thead>${thead}</thead><tbody>${body}</tbody></table><p><br></p>`;
}

// ---- footnote dialog ----
const footnoteDialog = document.getElementById('footnoteDialog');
document.getElementById('btnFootnote').addEventListener('click', () => footnoteDialog.showModal());
document.getElementById('fnCancel').addEventListener('click', () => footnoteDialog.close());
document.getElementById('fnInsert').addEventListener('click', () => {
  const text = document.getElementById('fnText').value.trim();
  const url = document.getElementById('fnUrl').value.trim();
  if (!text) {
    alert('Reference text is required.');
    return;
  }
  insertFootnote(text, url);
  footnoteDialog.close();
  document.getElementById('fnText').value = '';
  document.getElementById('fnUrl').value = '';
});

function nextFootnoteIndex() {
  const matches = [...canvas.innerHTML.matchAll(/back_(\d+)/g)].map((m) => parseInt(m[1], 10));
  return matches.length ? Math.max(...matches) + 1 : 1;
}

function ensureReferencesTable() {
  if (canvas.querySelector('#paperbox')) return;
  canvas.insertAdjacentHTML(
    'beforeend',
    '<h2>references</h2><hr><p id="paperbox" style="text-align:left;"><table><tbody style="vertical-align: top;"></tbody></table></p>'
  );
}

function insertFootnote(text, url) {
  const idx = nextFootnoteIndex();
  const marker = `<a name="back_${idx}" style="text-decoration: none;" href="#footnote_${idx}"><sup>[${idx}]</sup></a>`;
  insertHtmlAtCaret(marker);
  ensureReferencesTable();
  const refBody = canvas.querySelector('#paperbox table tbody');
  const linkHtml = url
    ? `<a href="${escapeAttr(url)}"><i>${escapeHtml(text)}</i></a>`
    : escapeHtml(text);
  const row = document.createElement('tr');
  row.innerHTML = `<td class="ref" style="width:1ch;"><a name="footnote_${idx}"></a><a href="#back_${idx}">^</a></td><td class="ref" style="width:4ch;"> <sup>[${idx}]</sup></td><td style="width:100%;text-align:left;" class="ref">${linkHtml}</td>`;
  refBody.appendChild(row);
}

// ---- reset the form to a fresh "new post" state ----
function resetForm() {
  currentMode = 'new';
  titleInput.value = '';
  slugInput.value = '';
  slugInput.disabled = false;
  slugManuallyEdited = false;
  descriptionInput.value = '';
  dateInput.valueAsDate = new Date();
  readMinutesInput.value = 5;
  updatedInput.value = '';
  dateMetaRawInput.value = '';
  canvas.innerHTML = '<p>Start writing your post here…</p>';
  if (selectedImage) selectedImage.classList.remove('editor-selected-image');
  selectedImage = null;
  document.getElementById('btnEditImage').disabled = true;
  statusMsg.textContent = '';
  draftId = null;
  draftDirty = false;
  forgetLastDraft();
  updateDraftInfo('');
  renderPreview();
}

// ---- shared field gathering ----
function gatherFields() {
  return {
    mode: currentMode,
    title: titleInput.value.trim(),
    slug: slugInput.value.trim() || simpleSlug(titleInput.value),
    description: descriptionInput.value.trim(),
    date: dateInput.value,
    read_minutes: parseInt(readMinutesInput.value, 10) || 5,
    updated: updatedInput.value.trim(),
    date_meta_raw: dateMetaRawInput.value.trim(),
    content: canvas.innerHTML.trim(),
  };
}

function hasTitle() {
  return titleInput.value.trim() !== '';
}

function applyDraft(d) {
  currentMode = d.mode === 'edit' ? 'edit' : 'new';
  draftId = d.id || null;
  titleInput.value = d.title || '';
  slugInput.value = d.slug || '';
  slugInput.disabled = currentMode === 'edit';
  slugManuallyEdited = Boolean((d.slug || '').trim());
  descriptionInput.value = d.description || '';
  if (d.date) dateInput.value = d.date;
  readMinutesInput.value = d.read_minutes || 5;
  updatedInput.value = d.updated || '';
  dateMetaRawInput.value = d.date_meta_raw || '';
  canvas.innerHTML = d.content || '<p>Start writing your post here…</p>';
  renderPreview();
}

// ---- autosave to disk (drafts only; never publishes) ----
// A draft is identified by a stable id assigned the first time it's saved, so
// renaming the title afterwards updates the same file instead of duplicating it.
// Autosave stays quiet until the post has a title.
const LS_LAST_DRAFT = 'postmaker:lastDraftId';
let draftDirty = false;
let draftId = null;

function makeId() {
  if (window.crypto && crypto.randomUUID) return 'd-' + crypto.randomUUID();
  return 'd-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function updateDraftInfo(text) {
  draftInfo.textContent = text;
}

function rememberLastDraft(id) {
  try {
    localStorage.setItem(LS_LAST_DRAFT, id);
  } catch (e) {
    /* storage unavailable — reopen-on-load just won't work, no harm */
  }
}

function forgetLastDraft() {
  try {
    localStorage.removeItem(LS_LAST_DRAFT);
  } catch (e) {
    /* nothing to clear */
  }
}

function markDirty() {
  draftDirty = true;
}

canvas.addEventListener('input', markDirty);
[titleInput, slugInput, descriptionInput, dateInput, readMinutesInput, updatedInput, dateMetaRawInput].forEach(
  (el) => el.addEventListener('input', markDirty)
);

// Persist a draft to disk. `announce` controls whether it's a loud, user-driven
// save (button) or a quiet background autosave.
async function saveDraft(announce) {
  if (currentMode === 'edit') return; // editing a published post isn't a draft
  if (!hasTitle()) {
    if (announce) alert('Add a title first — autosave and drafts start once the post has a title.');
    return;
  }
  if (!draftId) draftId = makeId();
  const payload = gatherFields();
  payload.id = draftId;
  draftDirty = false;
  try {
    const res = await fetch('/api/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'draft save failed');
    draftId = data.id;
    rememberLastDraft(draftId);
    updateDraftInfo((announce ? 'Draft saved ' : 'Autosaved ') + data.saved_at.replace('T', ' '));
    if (announce) {
      statusMsg.textContent = 'Draft saved — close the tool and reload it any time from the dropdown.';
      await refreshLoadOptions();
    }
  } catch (err) {
    draftDirty = true; // let the next tick retry
    if (announce) alert('Draft save failed: ' + err.message);
  }
}

async function deleteServerDraft(id) {
  if (!id) return;
  try {
    await fetch('/api/draft/' + encodeURIComponent(id), { method: 'DELETE' });
  } catch (e) {
    /* best-effort cleanup */
  }
}

// Periodic autosave — only once titled and only when something changed.
setInterval(() => {
  if (draftDirty && currentMode !== 'edit' && hasTitle()) saveDraft(false);
}, 3000);

// Tab hidden: flush now (the tab is still alive, so a normal save works).
document.addEventListener('visibilitychange', () => {
  if (document.hidden && draftDirty && currentMode !== 'edit' && hasTitle()) saveDraft(false);
});

// Tab closing: sendBeacon reliably delivers the final save during unload.
window.addEventListener('beforeunload', () => {
  if (!draftDirty || currentMode === 'edit' || !hasTitle()) return;
  if (!draftId) draftId = makeId();
  const payload = gatherFields();
  payload.id = draftId;
  try {
    navigator.sendBeacon('/api/draft', new Blob([JSON.stringify(payload)], { type: 'application/json' }));
  } catch (e) {
    /* beacon unsupported — the last periodic autosave still covers most cases */
  }
});

document.getElementById('btnSaveDraft').addEventListener('click', () => saveDraft(true));

// ---- load list: drafts + published posts ----
async function refreshLoadOptions(selectValue) {
  const [posts, drafts] = await Promise.all([
    fetch('/api/posts').then((r) => r.json()),
    fetch('/api/drafts').then((r) => r.json()),
  ]);
  loadSelect.innerHTML = '<option value="">— new post —</option>';
  if (drafts.length) {
    const group = document.createElement('optgroup');
    group.label = 'Drafts (unpublished)';
    drafts.forEach((d) => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.dataset.kind = 'draft';
      opt.textContent = d.title + (d.saved_at ? ' — ' + d.saved_at.replace('T', ' ') : '');
      group.appendChild(opt);
    });
    loadSelect.appendChild(group);
  }
  const published = document.createElement('optgroup');
  published.label = 'Published posts';
  posts.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.slug;
    opt.dataset.kind = 'post';
    opt.textContent = p.title;
    published.appendChild(opt);
  });
  loadSelect.appendChild(published);
  if (selectValue !== undefined) loadSelect.value = selectValue;
}

async function openDraft(id) {
  const res = await fetch('/api/draft/' + encodeURIComponent(id));
  const data = await res.json();
  if (!res.ok) {
    alert('Could not load draft: ' + (data.error || 'unknown error'));
    return;
  }
  applyDraft(data); // sets draftId from the draft
  draftDirty = false;
  rememberLastDraft(draftId);
  updateDraftInfo(data.saved_at ? 'Draft saved ' + data.saved_at.replace('T', ' ') : '');
  statusMsg.textContent = `Editing draft "${data.title || id}" (unpublished)`;
}

async function openPost(slug) {
  const res = await fetch(`/api/posts/${slug}`);
  const data = await res.json();
  if (!res.ok) {
    alert('Could not load post: ' + (data.error || 'unknown error'));
    return;
  }
  currentMode = 'edit';
  draftId = null;
  forgetLastDraft();
  titleInput.value = data.title;
  slugInput.value = data.slug;
  slugInput.disabled = true;
  slugManuallyEdited = true;
  descriptionInput.value = data.description;
  dateInput.value = data.date || new Date().toISOString().slice(0, 10);
  dateMetaRawInput.value = data.date_meta;
  canvas.innerHTML = data.content;
  draftDirty = false;
  updateDraftInfo('');
  renderPreview();
  statusMsg.textContent = `Editing "${data.title}"`;
}

loadSelect.addEventListener('change', () => {
  if (!loadSelect.value) {
    resetForm();
    return;
  }
  const opt = loadSelect.selectedOptions[0];
  if (opt && opt.dataset.kind === 'draft') {
    openDraft(loadSelect.value);
  } else {
    openPost(loadSelect.value);
  }
});

// ---- publish (deliberate; writes the post file + updates index.html & rss.xml) ----
document.getElementById('btnSave').addEventListener('click', async () => {
  const title = titleInput.value.trim();
  if (!title) {
    alert('Title is required.');
    return;
  }
  if (!confirm('Publish this post? It will be written to the site and (for a new post) added to index.html and rss.xml.')) {
    return;
  }
  const payload = gatherFields();
  const publishedDraftId = draftId;
  statusMsg.textContent = 'Publishing…';
  try {
    const res = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'publish failed');
    // Published — retire the work-in-progress draft.
    await deleteServerDraft(publishedDraftId);
    forgetLastDraft();
    draftId = null;
    draftDirty = false;
    currentMode = 'edit';
    slugInput.disabled = true;
    updateDraftInfo('');
    statusMsg.textContent = `Published ${data.file}${data.index_updated ? ' · index.html updated' : ''}${
      data.rss_updated ? ' · rss.xml updated' : ''
    }`;
    await refreshLoadOptions(data.slug);
  } catch (err) {
    statusMsg.textContent = '';
    alert('Publish failed: ' + err.message);
  }
});

// ---- init: load lists, then reopen the last draft you were working on ----
(async function init() {
  await refreshLoadOptions();
  renderPreview();
  let lastId = null;
  try {
    lastId = localStorage.getItem(LS_LAST_DRAFT);
  } catch (e) {
    /* storage unavailable — just start fresh */
  }
  if (lastId) {
    const res = await fetch('/api/draft/' + encodeURIComponent(lastId));
    if (res.ok) {
      await openDraft(lastId);
      loadSelect.value = lastId;
    } else {
      forgetLastDraft();
    }
  }
})();
