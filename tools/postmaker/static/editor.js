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
// Track the last caret position inside the canvas. Opening a dialog (footnote,
// image, table) moves focus into its inputs and drops the canvas selection, so
// without this an inserted marker would land at the end of the post instead of
// where the cursor was. selectionchange only updates this when the selection is
// actually within the canvas, so typing in a dialog never overwrites it.
let savedRange = null;
document.addEventListener('selectionchange', () => {
  const sel = window.getSelection();
  if (sel.rangeCount) {
    const range = sel.getRangeAt(0);
    if (canvas.contains(range.commonAncestorContainer)) savedRange = range.cloneRange();
  }
  syncTableUI();
});

function insertHtmlAtCaret(html) {
  const sel = window.getSelection();
  let range = null;
  if (sel.rangeCount && canvas.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    range = sel.getRangeAt(0);
  } else if (savedRange && canvas.contains(savedRange.commonAncestorContainer)) {
    range = savedRange.cloneRange();
  } else {
    canvas.focus();
    range = document.createRange();
    range.selectNodeContents(canvas);
    range.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(range);
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
  savedRange = range.cloneRange(); // remember the new caret spot
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
  syncResizer();
  syncTableUI();
});

// ---- drag-to-resize handle for the selected image ----
// A single floating handle lives outside the contenteditable canvas (so it's
// never part of the saved content) and is parked at the bottom-right corner of
// the selected image. Dragging it sets the width as a % of the canvas width —
// the same max-width the Insert/Adjust dialog uses — so the on-page size and the
// published size match.
const imgResizer = document.createElement('div');
imgResizer.id = 'imgResizer';
imgResizer.title = 'Drag to resize';
imgResizer.hidden = true;
document.body.appendChild(imgResizer);

// Move handle (top-left of the selected image) and the drop-position indicator.
const imgMover = document.createElement('div');
imgMover.id = 'imgMover';
imgMover.title = 'Drag to move the image (and caption)';
imgMover.textContent = '✥';
imgMover.hidden = true;
document.body.appendChild(imgMover);

const dropIndicator = document.createElement('div');
dropIndicator.id = 'dropIndicator';
dropIndicator.hidden = true;
document.body.appendChild(dropIndicator);

let resizing = null;
let moving = null;

function resizeTarget(img) {
  // The element whose max-width drives the displayed size: the wrapping
  // <figure> if the image has one (captioned), otherwise the image itself.
  return (img && img.closest('figure')) || img;
}

// The element to move as a unit: the outermost alignment wrapper. That's the
// centering <div> if present, else the <figure> (image + caption), else the img.
function movableUnit(img) {
  const base = img.closest('figure') || img;
  const parent = base.parentElement;
  if (parent && parent.tagName === 'DIV' && parent.style.display === 'flex') return parent;
  return base;
}

function positionResizer() {
  if (!selectedImage) return;
  const r = selectedImage.getBoundingClientRect();
  imgResizer.style.left = `${window.scrollX + r.right - 7}px`;
  imgResizer.style.top = `${window.scrollY + r.bottom - 7}px`;
  imgMover.style.left = `${window.scrollX + r.left - 7}px`;
  imgMover.style.top = `${window.scrollY + r.top - 7}px`;
}

function syncResizer() {
  if (selectedImage) {
    imgResizer.hidden = false;
    imgMover.hidden = false;
    positionResizer();
  } else {
    imgResizer.hidden = true;
    imgMover.hidden = true;
  }
}

function deselectImage() {
  if (selectedImage) selectedImage.classList.remove('editor-selected-image');
  selectedImage = null;
  document.getElementById('btnEditImage').disabled = true;
  imgResizer.hidden = true;
  imgMover.hidden = true;
}

imgResizer.addEventListener('pointerdown', (event) => {
  if (!selectedImage) return;
  event.preventDefault();
  const target = resizeTarget(selectedImage);
  resizing = {
    startX: event.clientX,
    startWidth: target.getBoundingClientRect().width,
    canvasWidth: canvas.getBoundingClientRect().width,
    target,
  };
  imgResizer.setPointerCapture(event.pointerId);
});

imgResizer.addEventListener('pointermove', (event) => {
  if (!resizing) return;
  const delta = event.clientX - resizing.startX;
  let pct = ((resizing.startWidth + delta) / resizing.canvasWidth) * 100;
  pct = Math.max(10, Math.min(100, Math.round(pct)));
  resizing.target.style.maxWidth = `${pct}%`;
  if (resizing.target.tagName === 'IMG') resizing.target.style.height = 'auto';
  positionResizer();
  statusMsg.textContent = `Image width: ${pct}%`;
});

function endResize(event) {
  if (!resizing) return;
  try {
    imgResizer.releasePointerCapture(event.pointerId);
  } catch (e) {
    /* pointer already released */
  }
  resizing = null;
  markDirty();
  statusMsg.textContent = '';
}
imgResizer.addEventListener('pointerup', endResize);
imgResizer.addEventListener('pointercancel', endResize);

// ---- drag the move handle to relocate the image + caption (alignment kept) ----
function caretFromPoint(x, y) {
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (!p) return null;
    const r = document.createRange();
    r.setStart(p.offsetNode, p.offset);
    return r;
  }
  return null;
}

imgMover.addEventListener('pointerdown', (event) => {
  if (!selectedImage) return;
  event.preventDefault();
  moving = { unit: movableUnit(selectedImage), range: null };
  imgMover.classList.add('dragging');
  imgMover.setPointerCapture(event.pointerId);
  statusMsg.textContent = 'Drop the image where you want it…';
});

imgMover.addEventListener('pointermove', (event) => {
  if (!moving) return;
  const range = caretFromPoint(event.clientX, event.clientY);
  // Valid drop target: a caret inside the canvas that isn't within the unit itself.
  if (range && canvas.contains(range.startContainer) && !moving.unit.contains(range.startContainer)) {
    moving.range = range;
    const rect = range.getBoundingClientRect();
    dropIndicator.hidden = false;
    dropIndicator.style.left = `${window.scrollX + rect.left}px`;
    dropIndicator.style.top = `${window.scrollY + rect.top}px`;
    dropIndicator.style.height = `${rect.height || 18}px`;
  } else {
    moving.range = null;
    dropIndicator.hidden = true;
  }
});

function endMove(event) {
  if (!moving) return;
  try {
    imgMover.releasePointerCapture(event.pointerId);
  } catch (e) {
    /* already released */
  }
  imgMover.classList.remove('dragging');
  dropIndicator.hidden = true;
  const { unit, range } = moving;
  moving = null;
  statusMsg.textContent = '';
  if (range && unit && !unit.contains(range.startContainer)) {
    // Move the whole unit (with any trailing spacing <br>) — styling and thus
    // alignment travel with it untouched.
    const trailingBr = unit.nextSibling && unit.nextSibling.nodeName === 'BR' ? unit.nextSibling : null;
    range.insertNode(unit);
    if (trailingBr) unit.after(trailingBr);
    positionResizer();
    markDirty();
  }
}
imgMover.addEventListener('pointerup', endMove);
imgMover.addEventListener('pointercancel', endMove);

// Keep the handles glued to the image as the page scrolls or reflows.
window.addEventListener('scroll', () => !imgResizer.hidden && positionResizer(), true);
window.addEventListener('resize', () => !imgResizer.hidden && positionResizer());

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

// ---- clear inline formatting (bold, italic, inline code, links, colours) ----
document.getElementById('btnClearFormat').addEventListener('click', () => {
  canvas.focus();
  const sel = window.getSelection();
  // Restore the last caret/selection if clicking the button dropped it.
  if (
    (!sel.rangeCount || !canvas.contains(sel.getRangeAt(0).commonAncestorContainer)) &&
    savedRange &&
    canvas.contains(savedRange.commonAncestorContainer)
  ) {
    sel.removeAllRanges();
    sel.addRange(savedRange.cloneRange());
  }
  if (!sel.rangeCount) return;
  // Capture <code> elements touching the selection (execCommand won't strip these).
  const codes = [...canvas.querySelectorAll('code')].filter((el) => sel.getRangeAt(0).intersectsNode(el));
  document.execCommand('removeFormat', false, null); // bold/italic/underline/font/colour
  document.execCommand('unlink', false, null); // links
  codes.forEach((el) => {
    const parent = el.parentNode;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    parent.normalize();
  });
  markDirty();
});

// ---- image dialog ----
const imgDialog = document.getElementById('imgDialog');

// Row mode builds a list of images (added one by one via "+ Add image"), each
// with its own alt + caption. rowImages holds the picked files + their DOM rows.
let rowImages = []; // [{ file, el, thumbUrl }]

function setImageDialogRow(on) {
  document.getElementById('imgRow').checked = on;
  document.getElementById('imgSingleFields').hidden = on;
  document.getElementById('imgRowFields').hidden = !on;
}

function clearRowList() {
  rowImages.forEach((it) => URL.revokeObjectURL(it.thumbUrl));
  rowImages = [];
  document.getElementById('imgRowList').innerHTML = '';
}

function addRowImage(file) {
  const thumbUrl = URL.createObjectURL(file);
  const el = document.createElement('div');
  el.className = 'row-item';
  el.innerHTML =
    `<img class="thumb" src="${thumbUrl}" alt="">` +
    '<div class="fields"><span class="row-item-name"></span>' +
    '<input type="text" class="ri-alt" placeholder="Alt text (optional)">' +
    '<input type="text" class="ri-cap" placeholder="Caption (optional)"></div>' +
    '<button type="button" class="remove" title="Remove">×</button>';
  el.querySelector('.row-item-name').textContent = file.name;
  const entry = { file, el, thumbUrl };
  el.querySelector('.remove').addEventListener('click', () => {
    URL.revokeObjectURL(thumbUrl);
    rowImages = rowImages.filter((x) => x !== entry);
    el.remove();
  });
  rowImages.push(entry);
  document.getElementById('imgRowList').appendChild(el);
}

document.getElementById('imgRow').addEventListener('change', (e) => setImageDialogRow(e.target.checked));
document.getElementById('imgRowAdd').addEventListener('click', () => document.getElementById('imgRowFile').click());
document.getElementById('imgRowFile').addEventListener('change', (e) => {
  [...e.target.files].forEach(addRowImage);
  e.target.value = ''; // let the same file be picked again if needed
});

document.getElementById('btnImage').addEventListener('click', () => {
  deselectImage();
  clearRowList();
  setImageDialogRow(false);
  imgDialog.showModal();
});
document.getElementById('btnEditImage').addEventListener('click', () => {
  if (!selectedImage) return;
  setImageDialogRow(false); // editing an existing image is always single
  const style = selectedImage.style;
  const size = (resizeTarget(selectedImage).style.maxWidth || style.maxWidth || '100%').replace('%', '');
  document.getElementById('imgAlt').value = selectedImage.alt || '';
  document.getElementById('imgSize').value = parseInt(size, 10) || 100;
  document.getElementById('imgCaption').value = selectedImage.closest('figure')?.querySelector('figcaption')?.textContent.trim() || '';
  document.getElementById('imgAlign').value = style.float || (selectedImage.parentElement?.style.justifyContent === 'center' ? 'center' : 'full');
  imgDialog.showModal();
});
document.getElementById('imgCancel').addEventListener('click', () => imgDialog.close());
document.getElementById('imgInsert').addEventListener('click', async () => {
  const rowMode = document.getElementById('imgRow').checked;
  // Adjust the currently-selected image (single mode, no new file chosen).
  if (!rowMode && selectedImage && !document.getElementById('imgFile').files.length) {
    updateImageSettings(selectedImage);
    imgDialog.close();
    statusMsg.textContent = 'Image adjusted';
    positionResizer();
    markDirty();
    return;
  }
  // Decide what to upload.
  let uploadFiles;
  if (rowMode) {
    if (rowImages.length < 2) {
      alert('Add at least two images for a row using “+ Add image”.');
      return;
    }
    uploadFiles = rowImages.map((e) => e.file);
  } else {
    const file = document.getElementById('imgFile').files[0];
    if (!file) {
      alert('Choose an image file first.');
      return;
    }
    uploadFiles = [file];
  }
  const slug = slugInput.value || simpleSlug(titleInput.value);
  if (!slug) {
    alert('Set a title/slug before adding images.');
    return;
  }
  statusMsg.textContent = uploadFiles.length > 1 ? `Uploading ${uploadFiles.length} images…` : 'Uploading image…';
  try {
    const urls = [];
    let warning = null;
    // Sequential so the server-side numbering follows the list order.
    for (const file of uploadFiles) {
      const form = new FormData();
      form.append('file', file);
      form.append('slug', slug);
      const res = await fetch('/api/upload-image', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'upload failed');
      urls.push(data.url);
      if (data.warning) warning = data.warning;
    }
    imgDialog.close(); // close first so focus leaves the modal before we restore the caret
    if (rowMode) {
      const items = rowImages.map((entry, i) => ({
        url: urls[i],
        alt: entry.el.querySelector('.ri-alt').value.trim(),
        caption: entry.el.querySelector('.ri-cap').value.trim(),
      }));
      insertHtmlAtCaret(buildFiguresRowHtml(items));
    } else {
      insertHtmlAtCaret(
        buildImageHtml(
          urls[0],
          document.getElementById('imgAlt').value,
          document.getElementById('imgSize').value || '100',
          document.getElementById('imgAlign').value,
          document.getElementById('imgCaption').value
        )
      );
    }
    markDirty();
    const what = rowMode ? `${urls.length} images in a row` : 'image';
    statusMsg.textContent = warning ? `Inserted ${what} (${warning})` : `Inserted ${what}`;
    document.getElementById('imgFile').value = '';
    document.getElementById('imgAlt').value = '';
    document.getElementById('imgCaption').value = '';
    clearRowList();
    setImageDialogRow(false);
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
    const fig = `<figure style="${figStyle}"><img src="${url}"${altAttr} loading="lazy"><figcaption><i>${escapeHtml(
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

// Several images in one centered row, each in its own <figure> with its own
// caption — matches the site's existing multi-image layout.
function buildFiguresRowHtml(items) {
  const per = Math.max(10, Math.floor(90 / items.length)); // 3 → 30%, like the reference
  const figs = items
    .map((it) => {
      const altAttr = it.alt ? ` alt="${escapeAttr(it.alt)}"` : '';
      const cap = it.caption ? `<figcaption><i>${escapeHtml(it.caption)}</i></figcaption>` : '';
      return `<figure style="max-width: ${per}%; height: auto; margin: 0 1ch;"><img src="${it.url}"${altAttr} style="max-width:100%;height:auto;" loading="lazy" />${cap}</figure>`;
    })
    .join('');
  return `<div style="display: flex; justify-content: center; gap: 2ch;">${figs}</div><br>`;
}

// ---- table dialog ----
const tableDialog = document.getElementById('tableDialog');
document.getElementById('btnTable').addEventListener('click', () => tableDialog.showModal());
document.getElementById('tblCancel').addEventListener('click', () => tableDialog.close());
document.getElementById('tblInsert').addEventListener('click', () => {
  const rows = parseInt(document.getElementById('tblRows').value, 10) || 1;
  const cols = parseInt(document.getElementById('tblCols').value, 10) || 1;
  const withHeader = document.getElementById('tblHeader').checked;
  tableDialog.close(); // close first so focus leaves the modal before we restore the caret
  insertHtmlAtCaret(buildTableHtml(rows, cols, withHeader));
  markDirty();
});

function buildTableHtml(rows, cols, withHeader) {
  const head = withHeader
    ? `<thead><tr>${Array.from({ length: cols }, (_, i) => `<th>Header ${i + 1}</th>`).join('')}</tr></thead>`
    : '';
  let body = '';
  for (let r = 0; r < rows; r++) {
    body += '<tr>' + Array.from({ length: cols }, () => '<td>Cell</td>').join('') + '</tr>';
  }
  return `<table class="usb" style="width: 100%;">${head}<tbody>${body}</tbody></table><p><br></p>`;
}

// ==== table editor: acts on the table under the cursor ====
const tableTools = document.getElementById('tableTools');
const dividerLayer = document.createElement('div');
dividerLayer.id = 'colDividers';
document.body.appendChild(dividerLayer);
let colDrag = null;

// Resolve the working range from the live selection, falling back to the last
// caret we saved (clicking a toolbar button can move focus off the canvas).
function activeRange() {
  const sel = window.getSelection();
  if (sel.rangeCount && canvas.contains(sel.getRangeAt(0).commonAncestorContainer)) return sel.getRangeAt(0);
  if (savedRange && canvas.contains(savedRange.commonAncestorContainer)) return savedRange;
  return null;
}
function activeTable() {
  const range = activeRange();
  if (!range) return null;
  let node = range.commonAncestorContainer;
  if (node.nodeType === 3) node = node.parentNode;
  const table = node.closest ? node.closest('table') : null;
  return table && canvas.contains(table) ? table : null;
}
function activeCell() {
  const range = activeRange();
  if (!range) return null;
  let node = range.startContainer;
  if (node.nodeType === 3) node = node.parentNode;
  const cell = node.closest ? node.closest('td,th') : null;
  return cell && canvas.contains(cell) ? cell : null;
}

// Build a grid matrix that accounts for colspan/rowspan: grid[r][c] -> owning cell.
function buildGrid(table) {
  const grid = [];
  [...table.rows].forEach((tr, r) => {
    if (!grid[r]) grid[r] = [];
    let c = 0;
    [...tr.cells].forEach((cell) => {
      while (grid[r][c]) c++;
      const rs = cell.rowSpan || 1;
      const cs = cell.colSpan || 1;
      for (let dr = 0; dr < rs; dr++) {
        for (let dc = 0; dc < cs; dc++) {
          const rr = r + dr;
          if (!grid[rr]) grid[rr] = [];
          grid[rr][c + dc] = cell;
        }
      }
      c += cs;
    });
  });
  return grid;
}
function gridCols(grid) {
  return grid.reduce((m, row) => Math.max(m, row.length), 0);
}
function findCellPos(grid, cell) {
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < (grid[r] ? grid[r].length : 0); c++) {
      if (grid[r][c] === cell) return { r, c };
    }
  }
  return null;
}
function cellGridCol(grid, r, cell) {
  const row = grid[r] || [];
  for (let c = 0; c < row.length; c++) if (row[c] === cell) return c;
  return -1;
}
// The physical cell in `tr` (grid row r) whose grid column is >= gc, or null.
function firstCellAtOrAfter(grid, tr, r, gc) {
  let best = null;
  let bestCol = Infinity;
  [...tr.cells].forEach((cell) => {
    const c = cellGridCol(grid, r, cell);
    if (c >= gc && c < bestCol) {
      bestCol = c;
      best = cell;
    }
  });
  return best;
}
function renameCell(cell, tag) {
  const nc = document.createElement(tag);
  for (const attr of cell.attributes) nc.setAttribute(attr.name, attr.value);
  nc.innerHTML = cell.innerHTML;
  cell.replaceWith(nc);
  return nc;
}
function placeCaretInCell(cell) {
  if (!cell || !canvas.contains(cell)) return;
  const range = document.createRange();
  range.selectNodeContents(cell);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  savedRange = range.cloneRange();
}
function afterTableOp(caretCell) {
  markDirty();
  if (caretCell) placeCaretInCell(caretCell);
  syncTableUI();
}

function addRow(below) {
  const table = activeTable();
  const cell = activeCell();
  if (!table || !cell) return;
  const grid = buildGrid(table);
  const pos = findCellPos(grid, cell);
  const cols = gridCols(grid);
  const boundary = below ? pos.r + (cell.rowSpan || 1) : pos.r;
  const rowsArr = [...table.rows];
  const refRow = rowsArr[boundary] || null;
  const inHead = refRow ? refRow.parentNode.tagName === 'THEAD' : false;
  const newTr = document.createElement('tr');
  let firstNew = null;
  for (let c = 0; c < cols; ) {
    const above = boundary > 0 ? (grid[boundary - 1] || [])[c] : null;
    const at = boundary < grid.length ? (grid[boundary] || [])[c] : null;
    if (boundary > 0 && boundary < grid.length && above && above === at) {
      above.rowSpan = (above.rowSpan || 1) + 1; // a rowspan crosses the new line: extend it
      c += above.colSpan || 1;
    } else {
      const td = document.createElement(inHead ? 'th' : 'td');
      td.innerHTML = '<br>';
      newTr.appendChild(td);
      if (!firstNew) firstNew = td;
      c += 1;
    }
  }
  if (refRow) refRow.parentNode.insertBefore(newTr, refRow);
  else (table.tBodies[0] || table).appendChild(newTr);
  afterTableOp(firstNew || cell);
}

function addColumn(right) {
  const table = activeTable();
  const cell = activeCell();
  if (!table || !cell) return;
  const grid = buildGrid(table);
  const pos = findCellPos(grid, cell);
  const cols = gridCols(grid);
  const insertAt = right ? pos.c + (cell.colSpan || 1) : pos.c;
  const widened = new Set();
  let firstNew = null;
  [...table.rows].forEach((tr, r) => {
    const left = insertAt > 0 ? (grid[r] || [])[insertAt - 1] : null;
    const at = insertAt < cols ? (grid[r] || [])[insertAt] : null;
    if (insertAt > 0 && insertAt < cols && left && left === at) {
      if (!widened.has(left)) {
        left.colSpan = (left.colSpan || 1) + 1; // new column falls inside a colspan: widen it
        widened.add(left);
      }
      return;
    }
    const isTh = tr.parentNode.tagName === 'THEAD';
    const nc = document.createElement(isTh ? 'th' : 'td');
    nc.innerHTML = '<br>';
    const target = firstCellAtOrAfter(grid, tr, r, insertAt);
    if (target) tr.insertBefore(nc, target);
    else tr.appendChild(nc);
    if (!firstNew) firstNew = nc;
  });
  if (table.querySelector(':scope > colgroup')) ensureColgroup(table);
  afterTableOp(firstNew || cell);
}

function deleteRow() {
  const table = activeTable();
  const cell = activeCell();
  if (!table || !cell) return;
  const grid = buildGrid(table);
  const r = findCellPos(grid, cell).r;
  const tr = [...table.rows][r];
  const cols = gridCols(grid);
  const handled = new Set();
  for (let c = 0; c < cols; c++) {
    const owner = (grid[r] || [])[c];
    if (!owner || handled.has(owner)) continue;
    handled.add(owner);
    // A cell spanning INTO this row from above just loses one row of height.
    if (owner.parentNode !== tr && (owner.rowSpan || 1) > 1) owner.rowSpan -= 1;
  }
  const fallback = [...table.rows][r + 1] || [...table.rows][r - 1];
  tr.remove();
  if (!table.rows.length) {
    table.remove(); // deleted the last row: drop the table, leaving the trailing paragraph
    syncTableUI();
    markDirty();
    return;
  }
  afterTableOp(fallback ? fallback.cells[0] : null);
}

function deleteColumn() {
  const table = activeTable();
  const cell = activeCell();
  if (!table || !cell) return;
  const grid = buildGrid(table);
  const gc = findCellPos(grid, cell).c;
  const handled = new Set();
  for (let r = 0; r < grid.length; r++) {
    const owner = (grid[r] || [])[gc];
    if (!owner || handled.has(owner)) continue;
    handled.add(owner);
    // Any cell occupying this column loses one column of width (or is removed).
    if ((owner.colSpan || 1) > 1) owner.colSpan -= 1;
    else owner.remove();
  }
  if (table.querySelector(':scope > colgroup')) ensureColgroup(table);
  if (![...table.querySelectorAll('td,th')].length) {
    table.remove();
    syncTableUI();
    markDirty();
    return;
  }
  afterTableOp(activeCell() || table.querySelector('td,th'));
}

function getSelectedCells(table) {
  const range = activeRange();
  if (!range) return [];
  return [...table.querySelectorAll('td,th')].filter((c) => range.intersectsNode(c));
}

function mergeCells() {
  const table = activeTable();
  if (!table) return;
  const cells = getSelectedCells(table);
  if (cells.length < 2) {
    alert('Drag across two or more cells to select them, then click Merge.');
    return;
  }
  const grid = buildGrid(table);
  let minR = Infinity;
  let minC = Infinity;
  let maxR = -1;
  let maxC = -1;
  cells.forEach((c) => {
    const p = findCellPos(grid, c);
    minR = Math.min(minR, p.r);
    minC = Math.min(minC, p.c);
    maxR = Math.max(maxR, p.r + (c.rowSpan || 1) - 1);
    maxC = Math.max(maxC, p.c + (c.colSpan || 1) - 1);
  });
  const inRect = new Set();
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      const cc = (grid[r] || [])[c];
      if (cc) inRect.add(cc);
    }
  }
  const target = grid[minR][minC];
  const parts = [];
  inRect.forEach((c) => {
    if (c === target) return;
    const html = c.innerHTML.trim();
    if (html && html !== '<br>') parts.push(html);
    c.remove();
  });
  target.rowSpan = maxR - minR + 1;
  target.colSpan = maxC - minC + 1;
  if (parts.length) {
    const cur = target.innerHTML.trim();
    target.innerHTML = (cur && cur !== '<br>' ? cur + ' ' : '') + parts.join(' ');
  }
  afterTableOp(target);
}

function splitCell() {
  const table = activeTable();
  const cell = activeCell();
  if (!table || !cell) return;
  const rs = cell.rowSpan || 1;
  const cs = cell.colSpan || 1;
  if (rs === 1 && cs === 1) {
    alert('This cell is not merged.');
    return;
  }
  const isTh = cell.tagName === 'TH';
  const pos = findCellPos(buildGrid(table), cell);
  cell.rowSpan = 1;
  cell.colSpan = 1;
  for (let r = pos.r; r < pos.r + rs; r++) {
    for (let c = pos.c; c < pos.c + cs; c++) {
      if (r === pos.r && c === pos.c) continue;
      const tr = [...table.rows][r];
      if (!tr) continue;
      const nc = document.createElement(isTh ? 'th' : 'td');
      nc.innerHTML = '<br>';
      const grid = buildGrid(table); // rebuild: DOM changed as we add cells
      const target = firstCellAtOrAfter(grid, tr, r, c);
      if (target) tr.insertBefore(nc, target);
      else tr.appendChild(nc);
    }
  }
  if (table.querySelector(':scope > colgroup')) ensureColgroup(table);
  afterTableOp(cell);
}

function toggleHeader() {
  const table = activeTable();
  if (!table) return;
  if (table.tHead) {
    const tr = table.tHead.rows[0];
    if (tr) {
      [...tr.cells].forEach((c) => renameCell(c, 'td'));
      const tbody = table.tBodies[0] || table.appendChild(document.createElement('tbody'));
      tbody.insertBefore(tr, tbody.firstChild);
    }
    table.tHead.remove();
  } else {
    const tbody = table.tBodies[0];
    const tr = tbody && tbody.rows[0];
    if (!tr) return;
    [...tr.cells].forEach((c) => renameCell(c, 'th'));
    const thead = document.createElement('thead');
    thead.appendChild(tr);
    table.insertBefore(thead, table.querySelector(':scope > colgroup') ? table.querySelector(':scope > colgroup').nextSibling : table.firstChild);
  }
  afterTableOp(activeCell());
}

// ---- column widths via <colgroup>, and draggable divider handles ----
// Measure the current on-screen width of each grid column (as % of the table)
// so creating a colgroup preserves the existing layout instead of snapping to
// equal columns.
function measureColWidthsPct(table, grid, cols) {
  const px = new Array(cols).fill(0);
  const seen = new Array(cols).fill(false);
  [...table.rows].forEach((tr, r) => {
    [...tr.cells].forEach((cell) => {
      if ((cell.colSpan || 1) !== 1) return;
      const c = cellGridCol(grid, r, cell);
      if (c >= 0 && !seen[c]) {
        px[c] = cell.getBoundingClientRect().width;
        seen[c] = true;
      }
    });
  });
  const tableWidth = table.getBoundingClientRect().width || 1;
  const unseen = seen.filter((s) => !s).length;
  if (unseen) {
    const remaining = Math.max(0, tableWidth - px.reduce((s, v) => s + v, 0));
    const each = remaining / unseen;
    for (let c = 0; c < cols; c++) if (!seen[c]) px[c] = each;
  }
  const total = px.reduce((s, v) => s + v, 0) || 1;
  return px.map((v) => (v / total) * 100);
}

function ensureColgroup(table) {
  const grid = buildGrid(table);
  const cols = gridCols(grid);
  let cg = table.querySelector(':scope > colgroup');
  if (!cg) {
    cg = document.createElement('colgroup');
    const widths = measureColWidthsPct(table, grid, cols);
    for (let i = 0; i < cols; i++) {
      const col = document.createElement('col');
      col.style.width = `${widths[i].toFixed(4)}%`;
      cg.appendChild(col);
    }
    table.insertBefore(cg, table.firstChild);
    return cg;
  }
  let els = [...cg.children];
  while (els.length < cols) {
    cg.appendChild(document.createElement('col'));
    els = [...cg.children];
  }
  while (els.length > cols) {
    els.pop().remove();
  }
  els = [...cg.children];
  if (els.some((c) => !c.style.width)) {
    els.forEach((c) => (c.style.width = `${(100 / els.length).toFixed(4)}%`));
  }
  return cg;
}

// Page-coord x of each internal column boundary (index 1..cols-1).
function columnBoundaryXs(table, grid, cols) {
  const right = new Array(cols).fill(null);
  [...table.rows].forEach((tr, r) => {
    [...tr.cells].forEach((cell) => {
      const c0 = cellGridCol(grid, r, cell);
      if (c0 < 0) return;
      const c1 = c0 + (cell.colSpan || 1) - 1;
      if (right[c1] == null) right[c1] = cell.getBoundingClientRect().right;
    });
  });
  const tRect = table.getBoundingClientRect();
  const xs = [];
  for (let i = 1; i < cols; i++) xs[i] = right[i - 1] != null ? right[i - 1] : tRect.left + (tRect.width * i) / cols;
  return xs;
}

function renderDividers() {
  if (colDrag) return; // never rebuild handles mid-drag — it would drop the one being dragged
  dividerLayer.innerHTML = '';
  const table = activeTable();
  if (!table) return;
  const grid = buildGrid(table);
  const cols = gridCols(grid);
  if (cols < 2) return;
  const tRect = table.getBoundingClientRect();
  const xs = columnBoundaryXs(table, grid, cols);
  for (let i = 1; i < cols; i++) {
    const handle = document.createElement('div');
    handle.className = 'col-divider';
    handle.dataset.boundary = i;
    handle.style.left = `${window.scrollX + xs[i]}px`;
    handle.style.top = `${window.scrollY + tRect.top}px`;
    handle.style.height = `${tRect.height}px`;
    dividerLayer.appendChild(handle);
  }
}
function hideDividers() {
  dividerLayer.innerHTML = '';
}

dividerLayer.addEventListener('pointerdown', (event) => {
  const handle = event.target.closest('.col-divider');
  const table = activeTable();
  if (!handle || !table) return;
  event.preventDefault();
  const boundary = parseInt(handle.dataset.boundary, 10);
  const cg = ensureColgroup(table);
  const colsEl = [...cg.children];
  const widths = colsEl.map((c) => parseFloat(c.style.width) || 100 / colsEl.length);
  const tRect = table.getBoundingClientRect();
  colDrag = {
    handle,
    startX: event.clientX,
    tableWidth: tRect.width,
    tableLeft: tRect.left,
    colsEl,
    widths,
    left: boundary - 1,
    right: boundary,
  };
  handle.classList.add('dragging');
  handle.setPointerCapture(event.pointerId);
});
dividerLayer.addEventListener('pointermove', (event) => {
  if (!colDrag) return;
  const dxPct = ((event.clientX - colDrag.startX) / colDrag.tableWidth) * 100;
  const pair = colDrag.widths[colDrag.left] + colDrag.widths[colDrag.right];
  const min = 5;
  let newLeft = colDrag.widths[colDrag.left] + dxPct;
  newLeft = Math.max(min, Math.min(pair - min, newLeft));
  colDrag.colsEl[colDrag.left].style.width = `${newLeft.toFixed(4)}%`;
  colDrag.colsEl[colDrag.right].style.width = `${(pair - newLeft).toFixed(4)}%`;
  // Reposition ONLY the dragged handle (don't rebuild — that would drop it).
  let sumLeft = 0;
  for (let i = 0; i <= colDrag.left; i++) sumLeft += parseFloat(colDrag.colsEl[i].style.width) || 0;
  colDrag.handle.style.left = `${window.scrollX + colDrag.tableLeft + (colDrag.tableWidth * sumLeft) / 100}px`;
});
function endColDrag(event) {
  if (!colDrag) return;
  try {
    colDrag.handle.releasePointerCapture(event.pointerId);
  } catch (e) {
    /* already released */
  }
  colDrag.handle.classList.remove('dragging');
  colDrag = null;
  markDirty();
  renderDividers(); // now safe to reposition all handles for the new layout
}
dividerLayer.addEventListener('pointerup', endColDrag);
dividerLayer.addEventListener('pointercancel', endColDrag);

// Pin the table toolbar directly beneath the (sticky) main toolbar, whatever its
// current wrapped height is.
function updateTableToolsOffset() {
  const bar = document.getElementById('toolbar');
  tableTools.style.top = `${bar ? bar.offsetHeight : 0}px`;
}

function syncTableUI() {
  if (activeTable()) {
    updateTableToolsOffset();
    tableTools.hidden = false;
    renderDividers();
  } else {
    tableTools.hidden = true;
    hideDividers();
  }
}

window.addEventListener('resize', () => {
  if (!tableTools.hidden) updateTableToolsOffset();
});

window.addEventListener('scroll', () => !tableTools.hidden && renderDividers(), true);
window.addEventListener('resize', () => !tableTools.hidden && renderDividers());

document.getElementById('ttRowAbove').addEventListener('click', () => addRow(false));
document.getElementById('ttRowBelow').addEventListener('click', () => addRow(true));
document.getElementById('ttColLeft').addEventListener('click', () => addColumn(false));
document.getElementById('ttColRight').addEventListener('click', () => addColumn(true));
document.getElementById('ttDelRow').addEventListener('click', deleteRow);
document.getElementById('ttDelCol').addEventListener('click', deleteColumn);
document.getElementById('ttMerge').addEventListener('click', mergeCells);
document.getElementById('ttSplit').addEventListener('click', splitCell);
document.getElementById('ttHeader').addEventListener('click', toggleHeader);

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
  footnoteDialog.close(); // close first so focus leaves the modal before we restore the caret
  insertFootnote(text, url);
  markDirty();
  document.getElementById('fnText').value = '';
  document.getElementById('fnUrl').value = '';
});

function nextFootnoteIndex() {
  const matches = [...canvas.innerHTML.matchAll(/back_(\d+)/g)].map((m) => parseInt(m[1], 10));
  return matches.length ? Math.max(...matches) + 1 : 1;
}

// Return the references table's <tbody>, creating the section if it's missing.
// A <table> can't live inside a <p>, so the browser hoists it out to be a
// sibling right after #paperbox — we walk to it rather than querying through the
// <p> (which would return null). This also finds the table in existing posts.
function ensureReferencesTbody() {
  let box = canvas.querySelector('#paperbox');
  if (!box) {
    canvas.insertAdjacentHTML(
      'beforeend',
      '<h2>references</h2><hr><p id="paperbox" style="text-align:left;"></p>' +
        '<table><tbody style="vertical-align: top;"></tbody></table>'
    );
    box = canvas.querySelector('#paperbox');
  }
  let table = box.nextElementSibling;
  while (table && table.tagName !== 'TABLE') table = table.nextElementSibling;
  if (!table) {
    box.insertAdjacentHTML('afterend', '<table><tbody style="vertical-align: top;"></tbody></table>');
    table = box.nextElementSibling;
  }
  return table.querySelector('tbody') || table.appendChild(document.createElement('tbody'));
}

function insertFootnote(text, url) {
  const idx = nextFootnoteIndex();
  const marker = `<a name="back_${idx}" style="text-decoration: none;" href="#footnote_${idx}"><sup>[${idx}]</sup></a>`;
  insertHtmlAtCaret(marker);
  const refBody = ensureReferencesTbody();
  const linkHtml = url
    ? `<a href="${escapeAttr(url)}"><i>${escapeHtml(text)}</i></a>`
    : escapeHtml(text);
  const row = document.createElement('tr');
  row.innerHTML = `<td class="ref" style="width:1ch;"><a name="footnote_${idx}"></a><a href="#back_${idx}">^</a></td><td class="ref" style="width:4ch;"> <sup>[${idx}]</sup></td><td style="width:100%;text-align:left;" class="ref">${linkHtml}</td>`;
  refBody.appendChild(row);
  renumberFootnotes(); // re-sequence by position so a footnote added earlier gets a lower number
}

// Non-creating variant of ensureReferencesTbody (returns null if there's none).
function findReferencesTbody() {
  const box = canvas.querySelector('#paperbox');
  if (!box) return null;
  let table = box.nextElementSibling;
  while (table && table.tagName !== 'TABLE') table = table.nextElementSibling;
  return table ? table.querySelector('tbody') : null;
}

function setRefRowNumber(row, num) {
  const anchor = row.querySelector('a[name^="footnote_"]');
  if (anchor) anchor.setAttribute('name', `footnote_${num}`);
  const back = row.querySelector('a[href^="#back_"]');
  if (back) back.setAttribute('href', `#back_${num}`);
  const sup = row.querySelector('sup');
  if (sup) sup.textContent = `[${num}]`;
}

// Renumber footnotes to match the order their inline [n] markers appear in the
// text, and reorder the reference rows to match. This lets you drop a new
// footnote anywhere and have the whole sequence renumber itself.
function renumberFootnotes() {
  const markers = [...canvas.querySelectorAll('a[name^="back_"]')].filter((a) =>
    /back_\d+/.test(a.getAttribute('name') || '')
  );
  if (!markers.length) return;

  const tbody = findReferencesTbody();
  const rowByOld = new Map(); // old footnote number -> reference row
  if (tbody) {
    tbody.querySelectorAll('tr').forEach((tr) => {
      const anchor = tr.querySelector('a[name^="footnote_"]');
      const m = anchor && (anchor.getAttribute('name') || '').match(/footnote_(\d+)/);
      if (m) rowByOld.set(parseInt(m[1], 10), tr);
    });
  }

  const ordered = [];
  markers.forEach((marker, i) => {
    const newNum = i + 1;
    const oldNum = parseInt(marker.getAttribute('name').match(/back_(\d+)/)[1], 10);
    marker.setAttribute('name', `back_${newNum}`);
    marker.setAttribute('href', `#footnote_${newNum}`);
    const sup = marker.querySelector('sup');
    if (sup) sup.textContent = `[${newNum}]`;
    const row = rowByOld.get(oldNum);
    if (row) {
      setRefRowNumber(row, newNum);
      ordered.push(row);
      rowByOld.delete(oldNum);
    }
  });

  // Reference rows with no matching inline marker keep their text but move to the
  // end, numbered after the sequenced ones.
  let next = markers.length + 1;
  rowByOld.forEach((row) => {
    setRefRowNumber(row, next++);
    ordered.push(row);
  });

  if (tbody) ordered.forEach((row) => tbody.appendChild(row));
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
  deselectImage();
  syncTableUI();
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
  deselectImage();
  syncTableUI();
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
  if (!hasTitle()) {
    if (announce) alert('Add a title first — drafts need a title.');
    return;
  }
  if (!draftId) draftId = makeId();
  renumberFootnotes(); // ensure saved numbering matches reading order
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

// Background autosave runs while composing a new post, or once a draft exists
// (so it keeps a saved draft fresh — including edits to a published post you've
// checkpointed with "Save draft"). It never auto-creates a draft for a plain
// edit-and-republish you haven't explicitly saved.
function autosaveActive() {
  return draftDirty && hasTitle() && (currentMode === 'new' || draftId);
}

// Periodic autosave — only when something changed and autosave is active.
setInterval(() => {
  if (autosaveActive()) saveDraft(false);
}, 3000);

// Tab hidden: flush now (the tab is still alive, so a normal save works).
document.addEventListener('visibilitychange', () => {
  if (document.hidden && autosaveActive()) saveDraft(false);
});

// Tab closing: sendBeacon reliably delivers the final save during unload.
window.addEventListener('beforeunload', () => {
  if (!autosaveActive()) return;
  if (!draftId) draftId = makeId();
  renumberFootnotes();
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
  deselectImage();
  syncTableUI();
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
  renumberFootnotes(); // publish with footnotes in reading order
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
