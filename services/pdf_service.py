import base64
import os
import re
import shutil
import tempfile

import fitz

from services.file_manager import archive_current_version, current_pdf_path, load_meta, save_meta


def _color_int_to_rgb(color_int):
    color_int = int(color_int or 0)
    r = ((color_int >> 16) & 255) / 255
    g = ((color_int >> 8) & 255) / 255
    b = (color_int & 255) / 255
    return (r, g, b)


def _color_int_to_hex(color_int):
    color_int = int(color_int or 0)
    return '#{:02x}{:02x}{:02x}'.format(
        (color_int >> 16) & 255,
        (color_int >> 8) & 255,
        color_int & 255,
    )


def _flags_bold(flags):
    return bool(int(flags or 0) & 16)


def _flags_italic(flags):
    return bool(int(flags or 0) & 2)


def _redact_rect(page, rect):
    page.add_redact_annot(rect, fill=(1, 1, 1))
    page.apply_redactions()


def _replace_text_edit(page, edit):
    """Redact original span and re-insert using the PDF's own font properties."""
    pdf_rect = edit.get('pdfRect')
    if not pdf_rect or len(pdf_rect) != 4:
        return

    text = edit.get('text', '')
    is_new = edit.get('isNew', False)

    if not str(text).strip() and edit.get('deleted'):
        if not is_new:
            _redact_rect(page, fitz.Rect(*pdf_rect))
        return

    if not str(text).strip():
        return

    rect = fitz.Rect(*pdf_rect)
    if not is_new:
        if edit.get('redactRects'):
            for r in edit['redactRects']:
                _redact_rect(page, fitz.Rect(*r))
        else:
            _redact_rect(page, rect)

    fontname = edit.get('font') or 'helv'
    fontsize = float(edit.get('fontSize') or 12)
    color = _color_int_to_rgb(edit.get('color', 0))
    flags = int(edit.get('flags', 0) or 0)
    if edit.get('bold'):
        flags |= 16
    if edit.get('italic'):
        flags |= 2
    origin = edit.get('origin')

    try:
        if origin and len(origin) == 2:
            page.insert_text(
                (float(origin[0]), float(origin[1])),
                text,
                fontname=fontname,
                fontsize=fontsize,
                color=color,
            )
        else:
            page.insert_textbox(
                rect,
                text,
                fontname=fontname,
                fontsize=fontsize,
                color=color,
                align=fitz.TEXT_ALIGN_LEFT,
            )
    except Exception:
        page.insert_textbox(
            rect,
            text,
            fontname='helv',
            fontsize=fontsize,
            color=color,
            align=fitz.TEXT_ALIGN_LEFT,
        )


def _canvas_to_pdf_rect(obj, scale):
    left = float(obj.get('left', 0))
    top = float(obj.get('top', 0))
    scale_x = float(obj.get('scaleX', 1) or 1)
    scale_y = float(obj.get('scaleY', 1) or 1)
    width = float(obj.get('width', 0) or 0) * scale_x
    height = float(obj.get('height', 0) or 0) * scale_y
    x0 = left / scale
    y0 = top / scale
    x1 = (left + width) / scale
    y1 = (top + height) / scale
    return fitz.Rect(x0, y0, max(x1, x0 + 1), max(y1, y0 + 1))


def _draw_highlight(page, obj, scale):
    rect = _canvas_to_pdf_rect(obj, scale)
    color = _color_int_to_rgb(int(obj.get('color', 0xFFFF00)))
    page.draw_rect(rect, color=color, fill=color, width=0, overlay=True)


def _insert_image(page, obj, scale):
    src = obj.get('src', '')
    match = re.match(r'data:image/[^;]+;base64,(.+)', src)
    if not match:
        return
    image_bytes = base64.b64decode(match.group(1))
    rect = _canvas_to_pdf_rect(obj, scale)
    page.insert_image(rect, stream=image_bytes)


def apply_page_edits(page, page_data):
    for edit in page_data.get('edits', []):
        if edit.get('isNew'):
            if str(edit.get('text', '')).strip():
                _replace_text_edit(page, edit)
        elif (
            edit.get('text') != edit.get('originalText')
            or edit.get('deleted')
            or edit.get('styleChanged')
        ):
            _replace_text_edit(page, edit)

    scale = float(page_data.get('scale', 1.5))
    for obj in page_data.get('annotations', []):
        if obj.get('type') == 'highlight':
            _draw_highlight(page, obj, scale)
        elif obj.get('type') == 'image':
            _insert_image(page, obj, scale)


def save_document(file_id, pages_payload):
    meta = load_meta(file_id)
    if not meta:
        raise ValueError('File not found')

    pdf_path = current_pdf_path(file_id)
    doc = fitz.open(pdf_path)

    for page_key, page_data in pages_payload.items():
        page_index = int(page_key) - 1
        if page_index < 0 or page_index >= doc.page_count:
            continue
        page = doc.load_page(page_index)
        apply_page_edits(page, page_data)

    archive_current_version(file_id, meta['version'])
    meta['version'] += 1
    save_meta(file_id, meta)

    directory = os.path.dirname(pdf_path)
    fd, temp_path = tempfile.mkstemp(suffix='.pdf', dir=directory)
    os.close(fd)
    try:
        doc.save(temp_path, garbage=4, deflate=True)
        doc.close()
        doc = None
        shutil.move(temp_path, pdf_path)
    except Exception:
        if doc is not None:
            doc.close()
        if os.path.isfile(temp_path):
            os.unlink(temp_path)
        raise

    return meta


def extract_page_text_items(file_id, page_num, scale=1.5):
    """Extract text spans with full font metadata for in-place PDF editing."""
    meta = load_meta(file_id)
    if not meta:
        raise ValueError('File not found')

    doc = fitz.open(current_pdf_path(file_id))
    page_index = int(page_num) - 1
    if page_index < 0 or page_index >= doc.page_count:
        doc.close()
        raise ValueError('Invalid page number')

    page = doc.load_page(page_index)
    page_rect = page.rect
    items = []
    paragraphs = {}
    span_id = 0

    text_dict = page.get_text('dict')
    for block_idx, block in enumerate(text_dict.get('blocks', [])):
        if block.get('type') != 0:
            continue
        para_span_ids = []
        para_text_parts = []
        para_bbox = None

        for line_idx, line in enumerate(block.get('lines', [])):
            for span in line.get('spans', []):
                text = span.get('text', '')
                if not text.strip():
                    continue

                x0, y0, x1, y1 = span['bbox']
                font_size = float(span.get('size', 12))
                color = span.get('color', 0)
                flags = span.get('flags', 0)
                font_name = span.get('font', 'helv')

                if para_bbox is None:
                    para_bbox = [x0, y0, x1, y1]
                else:
                    para_bbox[0] = min(para_bbox[0], x0)
                    para_bbox[1] = min(para_bbox[1], y0)
                    para_bbox[2] = max(para_bbox[2], x1)
                    para_bbox[3] = max(para_bbox[3], y1)

                para_span_ids.append(span_id)
                para_text_parts.append(text)

                items.append({
                    'id': span_id,
                    'text': text,
                    'left': x0 * scale,
                    'top': y0 * scale,
                    'width': (x1 - x0) * scale,
                    'height': (y1 - y0) * scale,
                    'font': font_name,
                    'fontSize': font_size,
                    'fontSizeDisplay': font_size * scale,
                    'color': color,
                    'fill': _color_int_to_hex(color),
                    'bold': _flags_bold(flags),
                    'italic': _flags_italic(flags),
                    'flags': flags,
                    'pdfRect': [x0, y0, x1, y1],
                    'origin': [x0, y1],
                    'blockId': block_idx,
                    'lineId': line_idx,
                })
                span_id += 1

        if para_span_ids:
            paragraphs[block_idx] = {
                'blockId': block_idx,
                'spanIds': para_span_ids,
                'text': ''.join(para_text_parts),
                'pdfRect': para_bbox,
                'origin': [para_bbox[0], para_bbox[3]],
            }

    result = {
        'page': page_num,
        'page_count': doc.page_count,
        'page_width': page_rect.width * scale,
        'page_height': page_rect.height * scale,
        'pdf_width': page_rect.width,
        'pdf_height': page_rect.height,
        'scale': scale,
        'items': items,
        'paragraphs': list(paragraphs.values()),
    }
    doc.close()
    return result
