# Features Roadmap

This document lists **new features to implement** and **enhancements to existing functionality** for the Python Flask PDF Editor project. It is based on analysis of `app.py`, `app2.py`, and their templates.

---

## Current State Summary

| Area | App 1 (`app.py`) | App 2 (`app2.py`) |
|------|------------------|-------------------|
| PDF source | Fixed `Complaint.pdf` only | User upload |
| Editing | Server-side text overlay (PyMuPDF) | Client-side only (Fabric.js) |
| Save | Writes `Updated_Complaint.pdf` | No save |
| Pages | Page 1 only | Page 1 only |
| UI | Minimal canvas + inline input | Bootstrap upload + Fabric canvas |

Both apps run independently on port `5000` and share no unified workflow.

---

## New Features to Implement

### 1. Unified Application

- [ ] Merge `app.py` and `app2.py` into a single Flask application
- [ ] Single entry point with routes for upload, view, edit, and download
- [ ] Shared configuration file (`config.py`) for upload folder, max file size, allowed extensions, and output paths
- [ ] Blueprint-based structure (`routes/`, `services/`, `utils/`) for maintainability

### 2. PDF Upload & File Management

- [ ] Allow users to upload PDFs in App 1 (not only `Complaint.pdf`)
- [ ] File picker with drag-and-drop support
- [ ] List recently opened / uploaded PDFs in the UI
- [ ] Download edited PDF button (`GET /download/<filename>`)
- [ ] Delete uploaded files endpoint with confirmation
- [ ] Generate unique filenames (UUID) to avoid overwrite collisions

### 3. Server-Side Save for App 2

- [ ] `POST /save_pdf` endpoint to persist Fabric.js edits back to PDF via PyMuPDF
- [ ] Accept edited text objects (position, content, font size, page) as JSON
- [ ] Rebuild PDF page from edited content instead of only browser-side changes
- [ ] Option to save as a new file or overwrite the uploaded copy

### 4. Multi-Page Support

- [ ] Page navigation controls (Previous / Next, page number input, total pages)
- [ ] Thumbnail sidebar for quick page jumping
- [ ] Apply text edits to the correct page on the server (`page_num` already sent by App 1 but only page 1 is rendered)
- [ ] Batch save across all edited pages in one request

### 5. True Text Replacement (Not Just Overlay)

- [ ] Redact old text by drawing a white rectangle over the original text region before inserting new text
- [ ] Use PyMuPDF `add_redact_annot()` + `apply_redactions()` for cleaner removal
- [ ] Match original font family, size, and color when inserting replacement text
- [ ] Extract font metadata from PDF text spans via `page.get_text("dict")`

### 6. Additional Editing Tools

- [ ] Add new text boxes anywhere on the page (not only edit existing text)
- [ ] Delete text regions
- [ ] Move and resize text blocks on the canvas
- [ ] Insert images or signatures
- [ ] Highlight / underline / strike-through annotations
- [ ] Draw shapes (rectangles, arrows) for markup

### 7. Undo / Redo & Edit History

- [ ] Client-side undo/redo stack for Fabric.js edits
- [ ] Server-side revision history (save versions: `document_v1.pdf`, `document_v2.pdf`)
- [ ] "Revert to original" action before any edits are applied

### 8. User Experience

- [ ] Loading spinner while PDF renders or saves
- [ ] Toast / alert notifications for success and error states (replace `console.log`)
- [ ] Keyboard shortcuts (Ctrl+S to save, Esc to cancel edit, arrow keys for page nav)
- [ ] Zoom in/out and fit-to-width controls
- [ ] Responsive layout for tablet and mobile
- [ ] Dark mode toggle

### 9. Security & Validation

- [ ] Validate uploaded files are real PDFs (magic bytes + `PyMuPDF` open check)
- [ ] Enforce max upload size (e.g. 10 MB)
- [ ] Sanitize filenames to prevent path traversal (`../` attacks)
- [ ] Rate limiting on upload and save endpoints
- [ ] Optional user authentication (login) for multi-user deployments
- [ ] CSRF protection on form submissions

### 10. Production Readiness

- [ ] Environment-based config (`.env` for `FLASK_ENV`, `SECRET_KEY`, `UPLOAD_FOLDER`)
- [ ] Disable `debug=True` in production; use Gunicorn or Waitress
- [ ] Structured logging (request ID, file name, errors)
- [ ] Health check endpoint (`GET /health`)
- [ ] Docker support (`Dockerfile` + `docker-compose.yml`)

### 11. Testing & Quality

- [ ] Unit tests for PDF update logic (PyMuPDF text replacement)
- [ ] API tests for `/upload`, `/update_text`, `/save_pdf`
- [ ] Frontend smoke tests for click-to-edit and upload flow
- [ ] CI pipeline (GitHub Actions) to run tests on push

---

## Enhancements to Existing Features

### App 1 — Click-to-Edit (`app.py` + `index.html`)

#### PDF rendering & interaction

| Current behavior | Proposed enhancement |
|------------------|----------------------|
| Hardcoded `Complaint.pdf` | Load PDF from upload or a `/pdfs/<id>` route |
| Only page 1 rendered | Full multi-page viewer with navigation |
| Fixed scale `1.5` | User-controlled zoom slider |
| Re-adds click listener on every `renderPage()` call | Register listener once; use flags to avoid duplicates |
| Re-renders original PDF after save (does not show edits) | Serve `Updated_Complaint.pdf` (or latest version) after successful save |
| `Complaint.pdf` served as static file from root | Serve PDFs through Flask with proper `Content-Type` and caching headers |

#### Text editing accuracy

| Current behavior | Proposed enhancement |
|------------------|----------------------|
| Canvas coordinates sent directly to server | Convert canvas coords → PDF coords using viewport scale and page dimensions |
| Fixed `fontsize=11` in PyMuPDF | Derive font size from clicked text item height |
| Text overlaid on top of old content | White-out original region, then insert new text |
| No validation on `request.json` | Validate required fields; return `400` with error message |
| Always saves to `Updated_Complaint.pdf` | Save to session-specific path; support incremental vs full save |
| `incremental=True` save may fail on some PDFs | Fallback to full save; handle errors gracefully |

#### API response

| Current behavior | Proposed enhancement |
|------------------|----------------------|
| Returns only `{ "status": "success" }` | Return updated file URL, page number, and timestamp |
| No error handling | Return `{ "status": "error", "message": "..." }` with proper HTTP status codes |
| No loading feedback in UI | Disable input and show spinner during save |

---

### App 2 — Upload & Fabric.js (`app2.py` + `index2.html`)

#### Upload flow

| Current behavior | Proposed enhancement |
|------------------|----------------------|
| Plain text error responses (`"No file part"`) | JSON error responses with HTTP 400/415 |
| No file type check | Accept only `.pdf`; reject other MIME types |
| Saves with original filename (overwrite risk) | Prefix with UUID or timestamp |
| No upload progress indicator | Show progress bar during AJAX upload |
| No file size limit | Enforce server and client-side size limits |

#### Canvas & text extraction

| Current behavior | Proposed enhancement |
|------------------|----------------------|
| PDF.js 2.10.377 + Fabric.js overwrites same canvas | Use separate layers: background PDF canvas + Fabric overlay canvas |
| Only first page processed | Loop all pages or add page selector |
| Hardcoded `fontFamily: 'arial'` | Map PDF embedded fonts where possible |
| Text position may drift for complex layouts | Improve transform matrix handling; add manual nudge controls |
| Double-click only to edit | Single-click to select; toolbar for font size/color |
| No save button | Add "Save PDF" and "Download PDF" buttons |
| No way to add new text | Toolbar with "Add Text" tool |

#### UI polish

| Current behavior | Proposed enhancement |
|------------------|----------------------|
| Duplicate `<h1>` headings | Single page title + subtitle layout |
| Basic Bootstrap container | Editor toolbar (upload, save, zoom, page nav) |
| jQuery for one AJAX call | Replace with vanilla `fetch` or keep jQuery consistently across both apps |

---

### Shared / Cross-Cutting Enhancements

| Area | Current behavior | Proposed enhancement |
|------|------------------|----------------------|
| **PDF.js version** | App 1 uses 2.6.347, App 2 uses 2.10.377 | Standardize on one PDF.js version across both templates |
| **Code organization** | All JS inline in HTML templates | Move to `static/js/editor.js` and `static/css/editor.css` |
| **Dependencies** | CDN only | Pin CDN versions; optionally bundle locally for offline use |
| **Error pages** | Flask default errors | Custom 404/500 templates |
| **Documentation** | README describes beta limits | Link README ↔ features.md; mark items done as implemented |

---

## Suggested Implementation Priority

### Phase 1 — Core fixes (high impact, low effort)

1. Fix coordinate mapping (canvas → PDF) in App 1
2. White-out + replace text instead of blind overlay
3. Serve updated PDF after save in App 1 UI
4. Add file validation and JSON errors to App 2 upload
5. Standardize PDF.js version

### Phase 2 — Feature parity

1. Multi-page navigation (both apps)
2. Server-side save for App 2 (`/save_pdf`)
3. Download button for edited PDFs
4. Merge both apps into one Flask application
5. Upload support in App 1 workflow

### Phase 3 — Editor experience

1. Zoom controls and responsive UI
2. Add/delete text tools
3. Undo/redo
4. Font and color matching
5. Loading states and user notifications

### Phase 4 — Production & scale

1. Authentication and access control
2. Docker deployment
3. Automated tests and CI
4. Revision history
5. Rate limiting and security hardening

---

## Technical Notes for Implementers

### Coordinate conversion (App 1)

The frontend sends canvas pixel coordinates. PyMuPDF expects PDF point coordinates. Conversion should account for:

- Canvas `scale` factor (currently `1.5`)
- Page height (PDF y-axis is bottom-up; canvas y-axis is top-down)
- Viewport offset if the canvas is scrolled or centered

### Text replacement pattern (PyMuPDF)

```python
# Recommended approach
rect = fitz.Rect(x0, y0, x1, y1)
page.add_redact_annot(rect, fill=(1, 1, 1))
page.apply_redactions()
page.insert_textbox(rect, new_text, fontsize=font_size, fontname="helv")
```

### Fabric.js → PDF save (App 2)

Export all `fabric.IText` objects as JSON:

```json
{
  "page": 1,
  "items": [
    { "text": "Hello", "left": 72, "top": 120, "fontSize": 12, "fill": "#000000" }
  ]
}
```

Server rebuilds each page using PyMuPDF `insert_textbox` or `insert_text` at mapped coordinates.

---

## Out of Scope (for now)

- Real-time collaborative editing (multiple users on same PDF)
- OCR for scanned/image-only PDFs
- PDF form field filling (AcroForms)
- Digital signatures and encryption
- Mobile native apps

These may be added in future versions if needed.
