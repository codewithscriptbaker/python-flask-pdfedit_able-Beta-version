# Python Flask PDF Editor (Beta)

A beta web application for viewing and editing PDF documents in the browser. The project includes **two separate Flask apps** that demonstrate different approaches to PDF editing: server-side text overlay with PyMuPDF, and client-side editing with Fabric.js.

## Overview

| App | Entry point | Template | Purpose |
|-----|-------------|----------|---------|
| **App 1** | `app.py` | `templates/index.html` | Edit text in a fixed PDF (`Complaint.pdf`) and save changes server-side |
| **App 2** | `app2.py` | `templates/index2.html` | Upload any PDF and edit extracted text on a Fabric.js canvas (client-side only) |

Only one app can run at a time on the default port (`5000`) unless you change the port in code.

## Features

### App 1 — Click-to-edit with PyMuPDF (`app.py`)

- Renders `Complaint.pdf` on an HTML canvas using [PDF.js](https://mozilla.github.io/pdf.js/)
- Click on text to open an inline input field
- Sends edited text to the Flask backend
- Backend uses [PyMuPDF](https://pymupdf.readthedocs.io/) (`fitz`) to draw new text over the selected region
- Saves the result as `Updated_Complaint.pdf`

### App 2 — Upload & Fabric.js canvas (`app2.py`)

- Upload a PDF file through the browser
- Renders the first page with PDF.js
- Extracts text items and places them as editable `fabric.IText` objects on a Fabric.js canvas
- Double-click text to edit it in the browser
- Uses Bootstrap 5 for layout styling

> **Note:** App 2 edits text only in the browser. Changes are **not** saved back to the PDF on the server.

## Tech Stack

### Backend (Python)

| Package | Used in | Purpose |
|---------|---------|---------|
| [Flask](https://flask.palletsprojects.com/) | `app.py`, `app2.py` | Web server and API routes |
| [PyMuPDF](https://pypi.org/project/PyMuPDF/) | `app.py` | PDF read/write and text overlay |

### Frontend (CDN — no npm install required)

| Library | Used in | Purpose |
|---------|---------|---------|
| PDF.js | `index.html`, `index2.html` | Render PDF pages to canvas |
| Fabric.js | `index2.html` | Interactive, editable text on canvas |
| Bootstrap 5 | `index2.html` | UI layout and styling |
| jQuery | `index2.html` | File upload AJAX handling |

## Project Structure

```
python-flask-pdfedit_able-Beta-version-main/
├── app.py                  # Flask app: fixed PDF + server-side text update
├── app2.py                 # Flask app: PDF upload + Fabric.js editor
├── requirements.txt        # Python dependencies
├── Complaint.pdf           # Sample PDF used by app.py
├── templates/
│   ├── index.html          # Frontend for app.py
│   └── index2.html         # Frontend for app2.py
├── uploads/                # Uploaded PDFs (created/used by app2.py)
└── pdf-edit/               # Local Python virtual environment (optional)
```

## Prerequisites

- Python 3.11+ (tested with 3.11.7)
- `pip` package manager
- A modern web browser

## Installation

1. **Clone or download** this repository.

2. **Create and activate a virtual environment** (recommended):

   ```bash
   python -m venv pdf-edit

   # Windows
   pdf-edit\Scripts\activate

   # macOS / Linux
   source pdf-edit/bin/activate
   ```

3. **Install dependencies:**

   ```bash
   pip install -r requirements.txt
   ```

## Usage

### Run App 1 — Server-side PDF text editing

```bash
python app.py
```

Open [http://127.0.0.1:5000](http://127.0.0.1:5000) in your browser.

1. The page loads `Complaint.pdf` from the project root.
2. Click on any text region to edit it.
3. Press Tab or click outside the input to save.
4. The server writes changes to `Updated_Complaint.pdf`.

### Run App 2 — Upload and Fabric.js editing

```bash
python app2.py
```

Open [http://127.0.0.1:5000](http://127.0.0.1:5000) in your browser.

1. Choose a PDF file using the file input.
2. The first page is rendered and text is extracted onto the Fabric.js canvas.
3. Double-click any text object to edit it in the browser.

## API Reference

### App 1 (`app.py`)

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/` | Serves the PDF editor page |
| `POST` | `/update_text` | Updates text in the PDF |

**`POST /update_text`** — JSON body:

```json
{
  "page_num": 1,
  "x": 100,
  "y": 200,
  "width": 80,
  "height": 14,
  "new_text": "Updated text"
}
```

**Response:**

```json
{ "status": "success" }
```

### App 2 (`app2.py`)

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/` | Serves the upload and editor page |
| `POST` | `/upload` | Uploads a PDF file; returns the saved filename |
| `GET` | `/uploads/<filename>` | Serves an uploaded PDF file |

## How It Works

### App 1 — Text update flow

```
Browser (PDF.js)          Flask (app.py)           PyMuPDF
      │                        │                      │
      │  Render Complaint.pdf  │                      │
      │◄───────────────────────│                      │
      │                        │                      │
      │  User clicks text      │                      │
      │  POST /update_text     │                      │
      │───────────────────────►│  Open PDF            │
      │                        │─────────────────────►│
      │                        │  insert_textbox()    │
      │                        │  Save Updated_...pdf │
      │◄───────────────────────│                      │
```

PyMuPDF does not support true in-place text replacement. The app overlays new text in a bounding rectangle at the clicked coordinates. The original text may still be visible underneath.

### App 2 — Client-side editing flow

```
Browser                         Flask (app2.py)
   │                                  │
   │  POST /upload (PDF file)         │
   │─────────────────────────────────►│  Save to uploads/
   │◄─────────────────────────────────│  Return filename
   │                                  │
   │  GET /uploads/<filename>         │
   │─────────────────────────────────►│
   │◄─────────────────────────────────│
   │                                  │
   │  PDF.js render + Fabric.js       │
   │  extract & edit text (local)     │
```

## Known Limitations (Beta)

- **Two separate apps** — `app.py` and `app2.py` are independent; they are not merged into a single application.
- **App 1 uses a hardcoded PDF** — Only `Complaint.pdf` is supported; coordinates are not re-mapped between canvas scale and PDF space.
- **Text overlay, not replacement** — App 1 draws new text on top of existing content rather than removing the old text.
- **Single page** — App 1 renders page 1 only; App 2 processes the first page of uploaded PDFs.
- **No persistence in App 2** — Fabric.js edits exist only in the browser session.
- **Debug mode enabled** — Both apps run with `debug=True`; disable this before any production deployment.
- **No authentication** — Uploaded files are stored on disk without access controls.

## Development Notes

- Place `Complaint.pdf` in the project root before running `app.py`.
- The `uploads/` folder is created automatically by `app2.py` if it does not exist.
- To run both apps simultaneously, change the port in one file:

  ```python
  app.run(debug=True, port=5001)
  ```

## License

No license file is included in this repository. Contact the project author for usage terms.
