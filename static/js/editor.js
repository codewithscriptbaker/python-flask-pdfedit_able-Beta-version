/* global pdfjsLib */

const Editor = {
    fileId: null,
    fileMeta: null,
    pdfDoc: null,
    currentPage: 1,
    totalPages: 0,
    scale: 1.5,
    editMode: 'selection',
    tool: 'edit',
    pageItems: {},
    pageParagraphs: {},
    pageBaseImage: {},
    pageEdits: {},
    editHistory: [],
    historyIndex: -1,
    activeEditor: null,
    activeFormatEdit: null,
    newTextCounter: 0,
};

const SCALE_MIN = 0.5;
const SCALE_MAX = 3.0;
const SCALE_STEP = 0.25;

function showLoading(text = 'Loading...') {
    document.getElementById('loading-text').textContent = text;
    document.getElementById('loading-overlay').classList.remove('d-none');
}

function hideLoading() {
    document.getElementById('loading-overlay').classList.add('d-none');
}

function toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const id = 'toast-' + Date.now();
    const bg = type === 'error' ? 'text-bg-danger' : type === 'success' ? 'text-bg-success' : 'text-bg-secondary';
    container.insertAdjacentHTML('beforeend', `
        <div id="${id}" class="toast ${bg}" role="alert">
            <div class="toast-body">${message}</div>
        </div>`);
    const el = document.getElementById(id);
    new bootstrap.Toast(el, { delay: 3000 }).show();
    el.addEventListener('hidden.bs.toast', () => el.remove());
}

async function api(url, options = {}) {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
    return data;
}

function mapPdfFontToCss(fontName) {
    if (!fontName) return 'sans-serif';
    const cleaned = fontName.replace(/^[A-Z]{6}\+/, '');
    const base = cleaned.split('-')[0];
    const lower = base.toLowerCase();
    if (lower.includes('courier') || lower.includes('mono')) return 'Courier New, monospace';
    if (lower.includes('times')) return 'Times New Roman, serif';
    if (lower.includes('arial') || lower.includes('helv') || lower.includes('calibri')) {
        return 'Arial, Helvetica, sans-serif';
    }
    return base + ', sans-serif';
}

function spanEditKey(id) { return `span-${id}`; }
function paraEditKey(blockId) { return `para-${blockId}`; }
function newEditKey(id) { return `new-${id}`; }

function getSpanEdit(item) {
    return Editor.pageEdits[Editor.currentPage]?.[spanEditKey(item.id)];
}

function getParagraph(blockId) {
    return (Editor.pageParagraphs[Editor.currentPage] || []).find(p => p.blockId === blockId);
}

function getParagraphEdit(blockId) {
    return Editor.pageEdits[Editor.currentPage]?.[paraEditKey(blockId)];
}

function getItemText(item) {
    const edit = getSpanEdit(item);
    if (edit) return edit.text;
    return item.text;
}

function getParagraphText(blockId) {
    const edit = getParagraphEdit(blockId);
    if (edit) return edit.text;
    const para = getParagraph(blockId);
    return para ? para.text : '';
}

function isSpanEdited(item) {
    const edit = getSpanEdit(item);
    if (!edit) return false;
    if (edit.text !== item.text) return true;
    return hasStyleChange(edit, item);
}

function isParagraphEdited(blockId) {
    const edit = getParagraphEdit(blockId);
    const para = getParagraph(blockId);
    if (!edit || !para) return false;
    if (edit.text !== para.text) return true;
    const first = (Editor.pageItems[Editor.currentPage] || []).find(i => i.blockId === blockId);
    return first ? hasStyleChange(edit, first) : false;
}

function hasStyleChange(current, original) {
    return !!(
        current.bold !== original.bold ||
        current.italic !== original.italic ||
        current.fontSize !== original.fontSize ||
        current.fill !== original.fill ||
        (current.font || '').toLowerCase() !== (original.font || '').toLowerCase()
    );
}

function buildEditingStyle(source) {
    const existing = source._existingEdit || {};
    return {
        left: source.left,
        top: source.top,
        width: source.width,
        height: source.height,
        fontSize: existing.fontSize ?? source.fontSize,
        fontSizeDisplay: existing.fontSizeDisplay ?? source.fontSizeDisplay,
        font: existing.font ?? source.font,
        fill: existing.fill ?? source.fill,
        color: existing.color ?? source.color,
        bold: existing.bold ?? source.bold,
        italic: existing.italic ?? source.italic,
        flags: existing.flags ?? source.flags,
        pdfRect: source.pdfRect,
        origin: source.origin,
        _widget: source._widget || null,
        isNew: !!source.isNew,
    };
}

function mergeCanvasRects(items) {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    items.forEach(item => {
        left = Math.min(left, item.left);
        top = Math.min(top, item.top);
        right = Math.max(right, item.left + item.width);
        bottom = Math.max(bottom, item.top + item.height);
    });
    return { left, top, width: right - left, height: bottom - top };
}

// ── File management ────────────────────────────────────────

async function loadFileList() {
    const data = await api('/api/files');
    const list = document.getElementById('file-list');
    list.innerHTML = '';
    data.files.forEach(file => {
        const li = document.createElement('li');
        li.dataset.id = file.id;
        if (file.id === Editor.fileId) li.classList.add('active');
        li.innerHTML = `
            <i class="bi bi-file-earmark-pdf text-danger"></i>
            <div class="file-info">
                <span class="file-name" title="${file.original_name}">${file.original_name}</span>
                <span class="file-meta">v${file.version} · ${file.page_count} pg</span>
            </div>
            <button class="btn btn-sm btn-outline-danger btn-delete" title="Delete"><i class="bi bi-x"></i></button>`;
        li.querySelector('.file-info').addEventListener('click', () => openFile(file.id));
        li.querySelector('.btn-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteFile(file.id);
        });
        list.appendChild(li);
    });
}

async function loadVersionList() {
    const list = document.getElementById('version-list');
    list.innerHTML = '';
    if (!Editor.fileId) return;
    try {
        const data = await api(`/api/files/${Editor.fileId}/versions`);
        if (!data.versions.length) {
            list.innerHTML = '<li class="text-muted small px-2">No saved versions yet</li>';
            return;
        }
        data.versions.forEach(v => {
            const li = document.createElement('li');
            li.innerHTML = `
                <i class="bi bi-clock-history"></i>
                <div class="file-info">
                    <span class="file-name">Version ${v.version}</span>
                    <span class="file-meta">${new Date(v.saved_at).toLocaleString()}</span>
                </div>
                <a class="btn btn-sm btn-outline-secondary" href="/api/files/${Editor.fileId}/versions/${v.filename}/download">
                    <i class="bi bi-download"></i>
                </a>`;
            list.appendChild(li);
        });
    } catch {
        list.innerHTML = '<li class="text-muted small px-2">—</li>';
    }
}

async function uploadFile(file) {
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
        toast('Please select a PDF file', 'error');
        return;
    }
    showLoading('Uploading...');
    const form = new FormData();
    form.append('file', file);
    try {
        const data = await api('/api/upload', { method: 'POST', body: form });
        toast('PDF uploaded', 'success');
        await loadFileList();
        await openFile(data.file.id);
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        hideLoading();
    }
}

async function deleteFile(fileId) {
    if (!confirm('Delete this document?')) return;
    try {
        await api(`/api/files/${fileId}`, { method: 'DELETE' });
        toast('Document deleted', 'success');
        if (Editor.fileId === fileId) resetEditor();
        await loadFileList();
    } catch (err) {
        toast(err.message, 'error');
    }
}

function resetEditor() {
    closeActiveEditor();
    Editor.fileId = null;
    Editor.fileMeta = null;
    Editor.pdfDoc = null;
    Editor.pageItems = {};
    Editor.pageParagraphs = {};
    Editor.pageBaseImage = {};
    Editor.pageEdits = {};
    Editor.editHistory = [];
    Editor.historyIndex = -1;
    document.getElementById('toolbar').classList.add('d-none');
    document.getElementById('canvas-viewport').classList.add('d-none');
    document.getElementById('welcome').classList.remove('d-none');
    document.getElementById('doc-title').textContent = '';
    document.getElementById('version-list').innerHTML = '';
}

// ── Page rendering ─────────────────────────────────────────

async function openFile(fileId) {
    showLoading('Opening PDF...');
    try {
        const data = await api(`/api/files/${fileId}`);
        Editor.fileId = fileId;
        Editor.fileMeta = data.file;
        Editor.currentPage = 1;
        Editor.pageItems = {};
        Editor.pageParagraphs = {};
        Editor.pageBaseImage = {};
        Editor.pageEdits = {};
        Editor.editHistory = [JSON.stringify({})];
        Editor.historyIndex = 0;
        Editor.tool = 'edit';

        const pdfUrl = `/api/files/${fileId}/pdf?v=${data.file.version}`;
        Editor.pdfDoc = await pdfjsLib.getDocument(pdfUrl).promise;
        Editor.totalPages = Editor.pdfDoc.numPages;

        document.getElementById('welcome').classList.add('d-none');
        document.getElementById('toolbar').classList.remove('d-none');
        document.getElementById('canvas-viewport').classList.remove('d-none');
        document.getElementById('doc-title').textContent = data.file.original_name;
        updateToolButtons();

        await renderPage(Editor.currentPage, true);
        updatePageIndicator();
        updateZoomIndicator();
        await loadFileList();
        await loadVersionList();
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        hideLoading();
    }
}

async function fetchPageData(pageNum) {
    if (Editor.pageItems[pageNum]) {
        return {
            items: Editor.pageItems[pageNum],
            paragraphs: Editor.pageParagraphs[pageNum],
        };
    }
    const data = await api(
        `/api/files/${Editor.fileId}/pages/${pageNum}/text?scale=${Editor.scale}`
    );
    Editor.pageItems[pageNum] = data.page.items || [];
    Editor.pageParagraphs[pageNum] = data.page.paragraphs || [];
    return { items: Editor.pageItems[pageNum], paragraphs: Editor.pageParagraphs[pageNum] };
}

async function renderPage(pageNum, showLoader = false) {
    if (!Editor.pdfDoc) return;
    closeActiveEditor();
    if (showLoader) showLoading(`Loading page ${pageNum}...`);

    try {
        const page = await Editor.pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: Editor.scale });
        const pdfCanvas = document.getElementById('pdf-canvas');
        const wrapper = document.getElementById('canvas-wrapper');
        const textLayer = document.getElementById('text-layer');

        pdfCanvas.width = viewport.width;
        pdfCanvas.height = viewport.height;
        wrapper.style.width = viewport.width + 'px';
        wrapper.style.height = viewport.height + 'px';
        textLayer.style.width = viewport.width + 'px';
        textLayer.style.height = viewport.height + 'px';

        await page.render({
            canvasContext: pdfCanvas.getContext('2d'),
            viewport,
        }).promise;

        const ctx = pdfCanvas.getContext('2d');
        Editor.pageBaseImage[pageNum] = ctx.getImageData(0, 0, pdfCanvas.width, pdfCanvas.height);

        await fetchPageData(pageNum);
        refreshOverlay();
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        if (showLoader) hideLoading();
    }
}

function restoreBaseCanvas() {
    const pdfCanvas = document.getElementById('pdf-canvas');
    const cached = Editor.pageBaseImage[Editor.currentPage];
    if (!cached) return;
    pdfCanvas.getContext('2d').putImageData(cached, 0, 0);
}

function refreshOverlay() {
    restoreBaseCanvas();
    const items = Editor.pageItems[Editor.currentPage] || [];
    const pdfCanvas = document.getElementById('pdf-canvas');
    redrawEditsOnCanvas(pdfCanvas, items);
    buildTextLayer(items);
}

function redrawEditsOnCanvas(canvas, items) {
    const ctx = canvas.getContext('2d');
    const page = Editor.currentPage;
    const scale = Editor.scale;

    items.forEach(item => {
        if (isParagraphEdited(item.blockId)) return;
        if (!isSpanEdited(item)) return;
        const edit = getSpanEdit(item);
        paintTextOnCanvas(ctx, {
            text: getItemText(item),
            left: item.left, top: item.top,
            width: item.width, height: item.height,
            fontSizeDisplay: edit?.fontSizeDisplay ?? item.fontSizeDisplay,
            fill: edit?.fill ?? item.fill,
            font: edit?.font ?? item.font,
            bold: edit?.bold ?? item.bold,
            italic: edit?.italic ?? item.italic,
        });
    });

    (Editor.pageParagraphs[page] || []).forEach(para => {
        if (!isParagraphEdited(para.blockId)) return;
        const spans = items.filter(i => i.blockId === para.blockId);
        const rect = mergeCanvasRects(spans);
        const first = spans[0];
        if (!first) return;
        whiteOutCanvas(ctx, rect.left, rect.top, rect.width, rect.height);
        paintTextOnCanvas(ctx, {
            text: getParagraphText(para.blockId),
            left: rect.left, top: rect.top,
            width: rect.width, height: rect.height,
            fontSizeDisplay: getParagraphEdit(para.blockId)?.fontSizeDisplay ?? first.fontSizeDisplay,
            fill: getParagraphEdit(para.blockId)?.fill ?? first.fill,
            font: getParagraphEdit(para.blockId)?.font ?? first.font,
            bold: getParagraphEdit(para.blockId)?.bold ?? first.bold,
            italic: getParagraphEdit(para.blockId)?.italic ?? first.italic,
        });
    });

    Object.values(Editor.pageEdits[page] || {}).forEach(edit => {
        if (!edit.isNew) return;
        paintTextOnCanvas(ctx, {
            text: edit.text,
            left: edit.left, top: edit.top,
            width: edit.width || 200, height: edit.height || edit.fontSizeDisplay,
            fontSizeDisplay: edit.fontSizeDisplay,
            fill: edit.fill || '#000000',
            font: edit.font || 'helv',
            bold: edit.bold, italic: edit.italic,
        });
    });
}

function whiteOutCanvas(ctx, left, top, width, height, pad = 2) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(left - pad, top - pad, width + pad * 2, height + pad * 2);
}

function paintTextOnCanvas(ctx, opts) {
    whiteOutCanvas(ctx, opts.left, opts.top, opts.width, opts.height);
    ctx.fillStyle = opts.fill;
    ctx.font = `${opts.italic ? 'italic ' : ''}${opts.bold ? 'bold ' : ''}${opts.fontSizeDisplay}px ${mapPdfFontToCss(opts.font)}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(opts.text, opts.left, opts.top + opts.fontSizeDisplay * 0.85);
}

function buildTextLayer(items) {
    const textLayer = document.getElementById('text-layer');
    textLayer.innerHTML = '';
    const page = Editor.currentPage;

    if (Editor.tool === 'add-text') {
        textLayer.classList.add('add-text-mode');
    } else {
        textLayer.classList.remove('add-text-mode');
    }

    items.forEach(item => {
        if (isParagraphEdited(item.blockId)) return;

        const hit = document.createElement('div');
        hit.className = 'text-hit';
        hit.style.left = item.left + 'px';
        hit.style.top = item.top + 'px';
        hit.style.width = Math.max(item.width, item.fontSizeDisplay * 0.4) + 'px';
        hit.style.height = Math.max(item.height, item.fontSizeDisplay) + 'px';
        hit.dataset.blockId = item.blockId;
        hit.dataset.spanId = item.id;

        hit.addEventListener('mousedown', (e) => {
            if (Editor.tool === 'add-text') return;
            e.preventDefault();
            e.stopPropagation();
            if (Editor.editMode === 'paragraph') {
                openParagraphEditor(item.blockId);
            } else {
                openSpanEditor(item, e);
            }
        });
        textLayer.appendChild(hit);
    });

    Object.values(Editor.pageEdits[page] || {}).forEach(edit => {
        if (!edit.isNew) return;
        if (Editor.activeFormatEdit?.isNew && Editor.activeFormatEdit.id === edit.id) return;
        const hit = document.createElement('div');
        hit.className = 'text-hit text-hit-new';
        hit.style.left = edit.left + 'px';
        hit.style.top = edit.top + 'px';
        hit.style.width = Math.max(edit.width || 100, 40) + 'px';
        hit.style.height = Math.max(edit.height || edit.fontSizeDisplay, edit.fontSizeDisplay) + 'px';
        hit.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openNewTextWidget(edit);
        });
        textLayer.appendChild(hit);
    });
}

function closeActiveEditor() {
    if (Editor.activeFormatEdit?.isNew) {
        commitTextBoxWidget(false);
    } else {
        closeSimpleEditor();
    }
    hideFormatToolbar();
}

function syncEditPdfRect(edit) {
    const w = Math.max(edit.width || 120, (edit.text || '').length * edit.fontSize * 0.45 * Editor.scale);
    const h = edit.fontSizeDisplay * 1.25;
    edit.width = w;
    edit.height = h;
    edit.pdfRect = [
        edit.left / Editor.scale,
        edit.top / Editor.scale,
        (edit.left + w) / Editor.scale,
        (edit.top + h) / Editor.scale,
    ];
    edit.origin = [edit.pdfRect[0], edit.pdfRect[3]];
}

function flagsFromStyle(bold, italic) {
    let flags = 0;
    if (bold) flags |= 16;
    if (italic) flags |= 2;
    return flags;
}

function showFormatToolbar(styleObj) {
    const bar = document.getElementById('format-toolbar');
    bar.style.display = 'flex';
    document.getElementById('fmt-font-size').value = String(Math.round(styleObj.fontSize || 12));
    document.getElementById('fmt-bold').classList.toggle('active', !!styleObj.bold);
    document.getElementById('fmt-italic').classList.toggle('active', !!styleObj.italic);
    document.getElementById('fmt-color').value = styleObj.fill || '#000000';
    const fam = (styleObj.font || 'helv').toLowerCase();
    document.getElementById('fmt-font-family').value =
        fam.includes('times') ? 'times' : fam.includes('cour') ? 'cour' : 'helv';
    Editor.activeFormatEdit = styleObj;
}

function hideFormatToolbar() {
    document.getElementById('format-toolbar').style.display = 'none';
    Editor.activeFormatEdit = null;
}

function readFormatFromToolbar() {
    const fontSize = parseInt(document.getElementById('fmt-font-size').value, 10) || 12;
    const bold = document.getElementById('fmt-bold').classList.contains('active');
    const italic = document.getElementById('fmt-italic').classList.contains('active');
    const fill = document.getElementById('fmt-color').value;
    const hex = fill.replace('#', '');
    return {
        fontSize,
        fontSizeDisplay: fontSize * Editor.scale,
        bold,
        italic,
        fill,
        color: parseInt(hex, 16) || 0,
        font: document.getElementById('fmt-font-family').value,
        flags: flagsFromStyle(bold, italic),
    };
}

function applyFormatToActiveEdit() {
    if (!Editor.activeFormatEdit) return;
    const fmt = readFormatFromToolbar();
    const edit = Editor.activeFormatEdit;
    Object.assign(edit, fmt);

    if (edit._widget) {
        const content = edit._widget.querySelector('.text-box-content');
        if (content) {
            content.style.fontSize = edit.fontSizeDisplay + 'px';
            content.style.fontWeight = edit.bold ? 'bold' : 'normal';
            content.style.fontStyle = edit.italic ? 'italic' : 'normal';
            content.style.color = edit.fill;
            content.style.fontFamily = mapPdfFontToCss(edit.font);
        }
        syncEditPdfRect(edit);
    } else if (Editor.activeEditor) {
        applyEditorStyles(Editor.activeEditor, edit);
    }
}

function createNewTextEdit(left, top) {
    const id = ++Editor.newTextCounter;
    const fontSize = 12;
    return {
        isNew: true,
        id,
        text: 'New text',
        left,
        top,
        width: 120,
        height: fontSize * Editor.scale,
        fontSize,
        fontSizeDisplay: fontSize * Editor.scale,
        font: 'helv',
        fill: '#000000',
        color: 0,
        bold: false,
        italic: false,
        flags: 0,
        pdfRect: [],
        origin: [],
    };
}

function openNewTextWidget(edit) {
    closeActiveEditor();
    const textLayer = document.getElementById('text-layer');
    syncEditPdfRect(edit);

    const widget = document.createElement('div');
    widget.className = 'text-box-widget';
    widget.style.left = edit.left + 'px';
    widget.style.top = edit.top + 'px';

    widget.innerHTML = `
        <div class="text-box-chrome">
            <span class="text-box-drag" title="Drag to move"><i class="bi bi-grip-vertical"></i></span>
            <span class="text-box-label">New text</span>
            <button type="button" class="text-box-close" title="Remove">&times;</button>
        </div>
        <div class="text-box-content" contenteditable="true"></div>
    `;

    const content = widget.querySelector('.text-box-content');
    content.textContent = edit.text;
    content.style.fontSize = edit.fontSizeDisplay + 'px';
    content.style.fontFamily = mapPdfFontToCss(edit.font);
    content.style.color = edit.fill;
    content.style.fontWeight = edit.bold ? 'bold' : 'normal';
    content.style.fontStyle = edit.italic ? 'italic' : 'normal';

    edit._widget = widget;
    textLayer.appendChild(widget);
    Editor.activeEditor = widget;
    showFormatToolbar(edit);

    // Drag
    const dragHandle = widget.querySelector('.text-box-drag');
    let dragStart = null;
    dragHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragStart = { x: e.clientX, y: e.clientY, left: edit.left, top: edit.top };
        const onMove = (ev) => {
            if (!dragStart) return;
            edit.left = dragStart.left + (ev.clientX - dragStart.x);
            edit.top = dragStart.top + (ev.clientY - dragStart.y);
            widget.style.left = edit.left + 'px';
            widget.style.top = edit.top + 'px';
            syncEditPdfRect(edit);
        };
        const onUp = () => {
            dragStart = null;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            pushHistory();
            refreshOverlayKeepWidget();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    widget.querySelector('.text-box-close').addEventListener('click', (e) => {
        e.stopPropagation();
        const page = Editor.currentPage;
        delete Editor.pageEdits[page][newEditKey(edit.id)];
        const w = edit._widget;
        edit._widget = null;
        Editor.activeFormatEdit = null;
        Editor.activeEditor = null;
        if (w) w.remove();
        hideFormatToolbar();
        pushHistory();
        refreshOverlay();
    });

    content.addEventListener('input', () => {
        edit.text = content.textContent || '';
        syncEditPdfRect(edit);
    });

    content.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            commitTextBoxWidget(true);
        }
    });

    // Don't commit on blur immediately if clicking format toolbar
    content.addEventListener('blur', (e) => {
        const related = e.relatedTarget;
        if (related && (
            related.closest('#format-toolbar') ||
            related.closest('.text-box-widget')
        )) return;
        setTimeout(() => {
            if (document.activeElement?.closest('.text-box-widget') ||
                document.activeElement?.closest('#format-toolbar')) return;
            commitTextBoxWidget(false);
        }, 120);
    });

    requestAnimationFrame(() => {
        content.focus();
        const range = document.createRange();
        range.selectNodeContents(content);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    });
}

function refreshOverlayKeepWidget() {
    const widget = Editor.activeFormatEdit?.isNew ? Editor.activeFormatEdit._widget : null;
    restoreBaseCanvas();
    const items = Editor.pageItems[Editor.currentPage] || [];
    redrawEditsOnCanvas(document.getElementById('pdf-canvas'), items);
    buildTextLayer(items);
    if (widget && Editor.activeFormatEdit?.isNew) {
        document.getElementById('text-layer').appendChild(widget);
    }
}

function commitTextBoxWidget(cancel) {
    if (!Editor.activeFormatEdit?.isNew) return;
    const edit = Editor.activeFormatEdit;
    const page = Editor.currentPage;
    const key = newEditKey(edit.id);
    const widget = edit._widget;
    const content = widget?.querySelector('.text-box-content');
    const text = cancel ? edit.text : (content?.textContent || '').trim();

    edit._widget = null;
    if (widget) widget.remove();

    if (!text || cancel) {
        if (Editor.pageEdits[page]) delete Editor.pageEdits[page][key];
    } else {
        edit.text = text;
        applyFormatToActiveEdit();
        syncEditPdfRect(edit);
        if (!Editor.pageEdits[page]) Editor.pageEdits[page] = {};
        const saved = { ...edit };
        delete saved._widget;
        Editor.pageEdits[page][key] = saved;
    }

    Editor.activeEditor = null;
    Editor.activeFormatEdit = null;
    hideFormatToolbar();
    if (!cancel) pushHistory();
    refreshOverlay();
}

function onAddTextClick(e) {
    if (Editor.tool !== 'add-text') return;
    if (e.target.closest('.text-box-widget') || e.target.classList.contains('text-hit')) return;

    const textLayer = document.getElementById('text-layer');
    const rect = textLayer.getBoundingClientRect();
    const left = e.clientX - rect.left;
    const top = e.clientY - rect.top;

    const edit = createNewTextEdit(left, top);
    syncEditPdfRect(edit);
    if (!Editor.pageEdits[Editor.currentPage]) Editor.pageEdits[Editor.currentPage] = {};
    Editor.pageEdits[Editor.currentPage][newEditKey(edit.id)] = edit;

    setTool('edit');
    pushHistory();
    openNewTextWidget(edit);
}

// ── Text editing ───────────────────────────────────────────

function closeSimpleEditor() {
    if (Editor.activeEditor?._commitFn) {
        Editor.activeEditor._commitFn();
        return;
    }
    if (Editor.activeEditor && !Editor.activeFormatEdit?.isNew) {
        Editor.activeEditor.remove();
        Editor.activeEditor = null;
    }
}

function applyEditorStyles(el, style) {
    el.style.left = style.left + 'px';
    el.style.top = style.top + 'px';
    el.style.minWidth = Math.max(style.width, 60) + 'px';
    el.style.minHeight = Math.max(style.height, style.fontSizeDisplay) + 'px';
    el.style.fontSize = style.fontSizeDisplay + 'px';
    el.style.fontFamily = mapPdfFontToCss(style.font);
    el.style.color = style.fill;
    el.style.fontWeight = style.bold ? 'bold' : 'normal';
    el.style.fontStyle = style.italic ? 'italic' : 'normal';
    el.style.lineHeight = '1.15';
}

function createContentEditor(text, style, onCommit) {
    if (Editor.activeFormatEdit?.isNew) commitTextBoxWidget(false);
    closeSimpleEditor();
    const textLayer = document.getElementById('text-layer');
    const el = document.createElement('div');
    el.className = 'text-editor-content';
    el.contentEditable = 'true';
    el.textContent = text;
    applyEditorStyles(el, style);

    let committed = false;
    const commit = () => {
        if (committed) return;
        committed = true;
        applyFormatToActiveEdit();
        onCommit(el.textContent || '', style);
        el.remove();
        Editor.activeEditor = null;
        Editor.activeFormatEdit = null;
        hideFormatToolbar();
    };
    el._commitFn = commit;

    el.addEventListener('blur', (e) => {
        const related = e.relatedTarget;
        if (related?.closest('#format-toolbar')) return;
        setTimeout(() => {
            if (document.activeElement?.closest('#format-toolbar')) return;
            commit();
        }, 120);
    });

    el.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            committed = true;
            el.remove();
            Editor.activeEditor = null;
            Editor.activeFormatEdit = null;
            hideFormatToolbar();
            refreshOverlay();
        }
        if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            commit();
        }
    });

    textLayer.appendChild(el);
    Editor.activeEditor = el;
    showFormatToolbar(style);
    el.focus();

    return el;
}

function placeCaretInText(el, item, clientX) {
    const text = el.textContent || '';
    const layer = document.getElementById('text-layer');
    const layerRect = layer.getBoundingClientRect();
    const relX = clientX - layerRect.left - item.left;
    const ratio = item.width > 0 ? Math.max(0, Math.min(1, relX / item.width)) : 0;
    const charIndex = Math.round(ratio * text.length);
    const range = document.createRange();
    const node = el.firstChild;
    if (node && node.nodeType === Node.TEXT_NODE) {
        range.setStart(node, Math.min(charIndex, text.length));
    } else {
        range.setStart(el, 0);
    }
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}

function openSpanEditor(item, event) {
    const pdfCanvas = document.getElementById('pdf-canvas');
    whiteOutCanvas(pdfCanvas.getContext('2d'), item.left, item.top, item.width, item.height);

    const existing = getSpanEdit(item);
    const style = buildEditingStyle({ ...item, _existingEdit: existing || {} });

    const el = createContentEditor(getItemText(item), style, (newText, finalStyle) => {
        commitSpanEdit(item, newText, finalStyle);
    });

    if (event) {
        requestAnimationFrame(() => placeCaretInText(el, item, event.clientX));
    }
}

function openParagraphEditor(blockId) {
    const para = getParagraph(blockId);
    if (!para) return;
    const items = (Editor.pageItems[Editor.currentPage] || []).filter(i => i.blockId === blockId);
    const rect = mergeCanvasRects(items);
    const first = items[0];
    if (!first) return;

    const pdfCanvas = document.getElementById('pdf-canvas');
    whiteOutCanvas(pdfCanvas.getContext('2d'), rect.left, rect.top, rect.width, rect.height);

    const existing = getParagraphEdit(blockId);
    const style = buildEditingStyle({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        fontSize: first.fontSize,
        fontSizeDisplay: first.fontSizeDisplay,
        font: first.font,
        fill: first.fill,
        color: first.color,
        bold: first.bold,
        italic: first.italic,
        flags: first.flags,
        pdfRect: para.pdfRect,
        origin: para.origin,
        _existingEdit: existing || {},
    });

    createContentEditor(getParagraphText(blockId), style, (newText, finalStyle) => {
        commitParagraphEdit(blockId, para, items, newText, finalStyle);
    });
}

function commitSpanEdit(item, newText, style) {
    const page = Editor.currentPage;
    const key = spanEditKey(item.id);
    const textUnchanged = newText === item.text;
    const styleUnchanged = !hasStyleChange(style, item);

    if (textUnchanged && styleUnchanged) {
        if (Editor.pageEdits[page]) delete Editor.pageEdits[page][key];
    } else {
        if (!Editor.pageEdits[page]) Editor.pageEdits[page] = {};
        Editor.pageEdits[page][key] = {
            id: item.id,
            text: newText,
            originalText: item.text,
            pdfRect: item.pdfRect,
            font: style.font,
            fontSize: style.fontSize,
            fontSizeDisplay: style.fontSizeDisplay,
            fill: style.fill,
            color: style.color,
            bold: style.bold,
            italic: style.italic,
            flags: style.flags,
            origin: item.origin,
            styleChanged: !styleUnchanged,
        };
        pushHistory();
    }
    refreshOverlay();
}

function commitParagraphEdit(blockId, para, spans, newText, style) {
    const page = Editor.currentPage;
    const key = paraEditKey(blockId);
    const first = spans[0];
    const textUnchanged = newText === para.text;
    const styleUnchanged = first ? !hasStyleChange(style, first) : true;

    if (textUnchanged && styleUnchanged) {
        if (Editor.pageEdits[page]) delete Editor.pageEdits[page][key];
    } else {
        if (!Editor.pageEdits[page]) Editor.pageEdits[page] = {};
        Editor.pageEdits[page][key] = {
            type: 'paragraph',
            blockId,
            spanIds: spans.map(s => s.id),
            redactRects: spans.map(s => s.pdfRect),
            text: newText,
            originalText: para.text,
            pdfRect: para.pdfRect,
            font: style.font,
            fontSize: style.fontSize,
            fontSizeDisplay: style.fontSizeDisplay,
            fill: style.fill,
            color: style.color,
            bold: style.bold,
            italic: style.italic,
            flags: style.flags,
            origin: para.origin,
            styleChanged: !styleUnchanged,
        };
        pushHistory();
    }
    refreshOverlay();
}

// ── History ────────────────────────────────────────────────

function pushHistory() {
    const snapshot = JSON.stringify(Editor.pageEdits);
    Editor.editHistory = Editor.editHistory.slice(0, Editor.historyIndex + 1);
    Editor.editHistory.push(snapshot);
    if (Editor.editHistory.length > 50) Editor.editHistory.shift();
    Editor.historyIndex = Editor.editHistory.length - 1;
    updateUndoRedoButtons();
}

function undo() {
    if (Editor.historyIndex <= 0) return;
    Editor.historyIndex--;
    Editor.pageEdits = JSON.parse(Editor.editHistory[Editor.historyIndex]);
    refreshOverlay();
    updateUndoRedoButtons();
}

function redo() {
    if (Editor.historyIndex >= Editor.editHistory.length - 1) return;
    Editor.historyIndex++;
    Editor.pageEdits = JSON.parse(Editor.editHistory[Editor.historyIndex]);
    refreshOverlay();
    updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
    document.getElementById('btn-undo').disabled = Editor.historyIndex <= 0;
    document.getElementById('btn-redo').disabled = Editor.historyIndex >= Editor.editHistory.length - 1;
}

// ── Tools ──────────────────────────────────────────────────

function setEditMode(mode) {
    Editor.editMode = mode;
    document.querySelectorAll('#edit-mode-group [data-edit-mode]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.editMode === mode);
    });
}

function setTool(tool) {
    Editor.tool = tool;
    updateToolButtons();
    refreshOverlay();
}

function updateToolButtons() {
    const addBtn = document.getElementById('btn-add-text');
    if (addBtn) {
        addBtn.classList.toggle('active', Editor.tool === 'add-text');
    }
}

// ── Navigation & zoom ────────────────────────────────────

function updatePageIndicator() {
    document.getElementById('page-indicator').textContent =
        `${Editor.currentPage} / ${Editor.totalPages}`;
    document.getElementById('btn-prev-page').disabled = Editor.currentPage <= 1;
    document.getElementById('btn-next-page').disabled = Editor.currentPage >= Editor.totalPages;
}

function updateZoomIndicator() {
    document.getElementById('zoom-indicator').textContent =
        `${Math.round(Editor.scale * 100)}%`;
}

async function goToPage(page) {
    if (page < 1 || page > Editor.totalPages) return;
    Editor.currentPage = page;
    await renderPage(page, true);
    updatePageIndicator();
}

function changeZoom(delta) {
    const newScale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, Editor.scale + delta));
    if (newScale === Editor.scale) return;
    Editor.scale = newScale;
    Editor.pageItems = {};
    Editor.pageParagraphs = {};
    Editor.pageBaseImage = {};
    updateZoomIndicator();
    renderPage(Editor.currentPage, true);
}

function zoomFit() {
    const viewport = document.getElementById('canvas-viewport');
    if (!Editor.pdfDoc) return;
    Editor.pdfDoc.getPage(Editor.currentPage).then(page => {
        const base = page.getViewport({ scale: 1 });
        const fitScale = (viewport.clientWidth - 48) / base.width;
        Editor.scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, fitScale));
        Editor.pageItems = {};
        Editor.pageParagraphs = {};
        Editor.pageBaseImage = {};
        updateZoomIndicator();
        renderPage(Editor.currentPage, true);
    });
}

// ── Save ───────────────────────────────────────────────────

async function saveDocument() {
    if (!Editor.fileId) return;
    closeActiveEditor();
    showLoading('Saving PDF...');

    const pages = {};
    Object.keys(Editor.pageEdits).forEach(pageKey => {
        const edits = Object.values(Editor.pageEdits[pageKey] || {});
        if (edits.length) pages[pageKey] = { edits, scale: Editor.scale };
    });

    if (!Object.keys(pages).length) {
        hideLoading();
        toast('No changes to save', 'info');
        return;
    }

    try {
        const data = await api(`/api/files/${Editor.fileId}/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pages }),
        });
        Editor.fileMeta = data.file;
        Editor.pageEdits = {};
        Editor.pageItems = {};
        Editor.pageParagraphs = {};
        Editor.pageBaseImage = {};
        Editor.editHistory = [JSON.stringify({})];
        Editor.historyIndex = 0;
        updateUndoRedoButtons();
        toast(`Saved as version ${data.file.version}`, 'success');

        const pdfUrl = `/api/files/${Editor.fileId}/pdf?v=${data.file.version}`;
        Editor.pdfDoc = await pdfjsLib.getDocument(pdfUrl).promise;
        Editor.totalPages = Editor.pdfDoc.numPages;
        await renderPage(Editor.currentPage, true);
        await loadFileList();
        await loadVersionList();
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        hideLoading();
    }
}

function downloadDocument() {
    if (!Editor.fileId) return;
    window.location.href = `/api/files/${Editor.fileId}/download`;
}

// ── Events ─────────────────────────────────────────────────

function bindEvents() {
    ['upload-input', 'welcome-upload'].forEach(id => {
        document.getElementById(id).addEventListener('change', (e) => {
            if (e.target.files[0]) uploadFile(e.target.files[0]);
            e.target.value = '';
        });
    });

    const dropZone = document.getElementById('drop-zone');
    ['dragenter', 'dragover'].forEach(evt => {
        dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    });
    ['dragleave', 'drop'].forEach(evt => {
        dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); });
    });
    dropZone.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]); });
    dropZone.addEventListener('click', () => document.getElementById('upload-input').click());

    document.querySelectorAll('#edit-mode-group [data-edit-mode]').forEach(btn => {
        btn.addEventListener('click', () => {
            setEditMode(btn.dataset.editMode);
            setTool('edit');
        });
    });

    document.getElementById('btn-add-text').addEventListener('click', () => {
        setTool(Editor.tool === 'add-text' ? 'edit' : 'add-text');
    });

    document.getElementById('text-layer').addEventListener('mousedown', onAddTextClick);

    document.getElementById('fmt-font-size').addEventListener('change', applyFormatToActiveEdit);
    document.getElementById('fmt-font-family').addEventListener('change', applyFormatToActiveEdit);
    document.getElementById('fmt-color').addEventListener('input', applyFormatToActiveEdit);
    document.getElementById('fmt-bold').addEventListener('click', () => {
        document.getElementById('fmt-bold').classList.toggle('active');
        applyFormatToActiveEdit();
    });
    document.getElementById('fmt-italic').addEventListener('click', () => {
        document.getElementById('fmt-italic').classList.toggle('active');
        applyFormatToActiveEdit();
    });

    document.getElementById('format-toolbar').addEventListener('mousedown', (e) => {
        e.preventDefault();
    });

    document.getElementById('btn-undo').addEventListener('click', undo);
    document.getElementById('btn-redo').addEventListener('click', redo);
    document.getElementById('btn-prev-page').addEventListener('click', () => goToPage(Editor.currentPage - 1));
    document.getElementById('btn-next-page').addEventListener('click', () => goToPage(Editor.currentPage + 1));
    document.getElementById('btn-zoom-in').addEventListener('click', () => changeZoom(SCALE_STEP));
    document.getElementById('btn-zoom-out').addEventListener('click', () => changeZoom(-SCALE_STEP));
    document.getElementById('btn-zoom-fit').addEventListener('click', zoomFit);
    document.getElementById('btn-save').addEventListener('click', saveDocument);
    document.getElementById('btn-download').addEventListener('click', downloadDocument);

    document.addEventListener('keydown', (e) => {
        if (e.target.isContentEditable) return;
        const ctrl = e.ctrlKey || e.metaKey;
        if (ctrl && e.key === 's') { e.preventDefault(); saveDocument(); }
        else if (ctrl && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
        else if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
        else if (e.key === 'ArrowLeft') goToPage(Editor.currentPage - 1);
        else if (e.key === 'ArrowRight') goToPage(Editor.currentPage + 1);
        else if (ctrl && (e.key === '=' || e.key === '+')) { e.preventDefault(); changeZoom(SCALE_STEP); }
        else if (ctrl && e.key === '-') { e.preventDefault(); changeZoom(-SCALE_STEP); }
        else if (e.key === 't' || e.key === 'T') setTool(Editor.tool === 'add-text' ? 'edit' : 'add-text');
        else if (e.key === 'v' || e.key === 'V') setTool('edit');
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    bindEvents();
    try { await loadFileList(); } catch (err) { toast('Could not load files: ' + err.message, 'error'); }
});
