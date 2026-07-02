import json
import os
import re
import shutil
import uuid
from datetime import datetime, timezone

import fitz

from config import UPLOAD_FOLDER

UUID_RE = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    re.I,
)


def ensure_dirs():
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)


def is_valid_file_id(file_id):
    return bool(file_id and UUID_RE.match(file_id))


def file_dir(file_id):
    if not is_valid_file_id(file_id):
        raise ValueError('Invalid file id')
    return os.path.join(UPLOAD_FOLDER, file_id)


def meta_path(file_id):
    return os.path.join(file_dir(file_id), 'meta.json')


def current_pdf_path(file_id):
    return os.path.join(file_dir(file_id), 'current.pdf')


def versions_dir(file_id):
    return os.path.join(file_dir(file_id), 'versions')


def is_pdf_file(path):
    with open(path, 'rb') as handle:
        return handle.read(5) == b'%PDF-'


def create_file_record(original_name, source_path):
    ensure_dirs()
    file_id = str(uuid.uuid4())
    directory = file_dir(file_id)
    os.makedirs(directory, exist_ok=True)
    os.makedirs(versions_dir(file_id), exist_ok=True)

    original_path = os.path.join(directory, 'original.pdf')
    shutil.copy2(source_path, original_path)
    shutil.copy2(source_path, current_pdf_path(file_id))

    doc = fitz.open(current_pdf_path(file_id))
    page_count = doc.page_count
    doc.close()

    meta = {
        'id': file_id,
        'original_name': original_name,
        'page_count': page_count,
        'version': 1,
        'created_at': datetime.now(timezone.utc).isoformat(),
        'updated_at': datetime.now(timezone.utc).isoformat(),
    }
    save_meta(file_id, meta)
    return meta


def save_meta(file_id, meta):
    meta['updated_at'] = datetime.now(timezone.utc).isoformat()
    with open(meta_path(file_id), 'w', encoding='utf-8') as handle:
        json.dump(meta, handle, indent=2)


def load_meta(file_id):
    if not is_valid_file_id(file_id):
        return None
    path = meta_path(file_id)
    if not os.path.isfile(path):
        return None
    with open(path, 'r', encoding='utf-8') as handle:
        return json.load(handle)


def list_files():
    ensure_dirs()
    files = []
    for name in os.listdir(UPLOAD_FOLDER):
        if not is_valid_file_id(name):
            continue
        meta = load_meta(name)
        if meta:
            files.append(meta)
    files.sort(key=lambda item: item.get('updated_at', ''), reverse=True)
    return files


def delete_file(file_id):
    if not is_valid_file_id(file_id):
        return False
    directory = file_dir(file_id)
    if os.path.isdir(directory):
        shutil.rmtree(directory)
        return True
    return False


def list_versions(file_id):
    meta = load_meta(file_id)
    if not meta:
        return []
    directory = versions_dir(file_id)
    if not os.path.isdir(directory):
        return []
    versions = []
    for name in sorted(os.listdir(directory), reverse=True):
        if not name.endswith('.pdf'):
            continue
        path = os.path.join(directory, name)
        versions.append({
            'filename': name,
            'version': _version_from_name(name),
            'saved_at': datetime.fromtimestamp(
                os.path.getmtime(path), tz=timezone.utc
            ).isoformat(),
            'size': os.path.getsize(path),
        })
    return versions


def _version_from_name(name):
    try:
        return int(name.split('_')[0][1:])
    except (IndexError, ValueError):
        return 0


def archive_current_version(file_id, version):
    src = current_pdf_path(file_id)
    if not os.path.isfile(src):
        return
    directory = versions_dir(file_id)
    os.makedirs(directory, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')
    dest = os.path.join(directory, f'v{version}_{stamp}.pdf')
    shutil.copy2(src, dest)
