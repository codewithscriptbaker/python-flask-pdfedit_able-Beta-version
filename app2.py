import os
import tempfile

from flask import Flask, jsonify, render_template, request, send_file
from werkzeug.utils import secure_filename

import config
from services import file_manager, pdf_service

app = Flask(__name__)
app.config['SECRET_KEY'] = config.SECRET_KEY
app.config['MAX_CONTENT_LENGTH'] = config.MAX_CONTENT_LENGTH

file_manager.ensure_dirs()


def _error(message, status=400):
    return jsonify({'status': 'error', 'message': message}), status


@app.route('/')
def index():
    return render_template('index2.html')


@app.route('/api/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return _error('No file part in request')

    upload = request.files['file']
    if not upload.filename:
        return _error('No file selected')

    original_name = secure_filename(upload.filename)
    if not original_name.lower().endswith('.pdf'):
        return _error('Only PDF files are allowed', 415)

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp:
            upload.save(tmp.name)
            tmp_path = tmp.name

        if not file_manager.is_pdf_file(tmp_path):
            return _error('Invalid PDF file', 415)

        meta = file_manager.create_file_record(original_name, tmp_path)
        return jsonify({'status': 'success', 'file': meta})
    finally:
        if tmp_path and os.path.isfile(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


@app.route('/api/files', methods=['GET'])
def list_files():
    return jsonify({'status': 'success', 'files': file_manager.list_files()})


@app.route('/api/files/<file_id>', methods=['GET'])
def get_file_info(file_id):
    meta = file_manager.load_meta(file_id)
    if not meta:
        return _error('File not found', 404)
    return jsonify({'status': 'success', 'file': meta})


@app.route('/api/files/<file_id>', methods=['DELETE'])
def delete_file(file_id):
    if not file_manager.delete_file(file_id):
        return _error('File not found', 404)
    return jsonify({'status': 'success'})


@app.route('/api/files/<file_id>/pdf')
def serve_pdf(file_id):
    meta = file_manager.load_meta(file_id)
    if not meta:
        return _error('File not found', 404)
    path = file_manager.current_pdf_path(file_id)
    return send_file(path, mimetype='application/pdf')


@app.route('/api/files/<file_id>/download')
def download_pdf(file_id):
    meta = file_manager.load_meta(file_id)
    if not meta:
        return _error('File not found', 404)
    path = file_manager.current_pdf_path(file_id)
    return send_file(
        path,
        mimetype='application/pdf',
        as_attachment=True,
        download_name=meta.get('original_name', 'document.pdf'),
    )


@app.route('/api/files/<file_id>/versions')
def file_versions(file_id):
    meta = file_manager.load_meta(file_id)
    if not meta:
        return _error('File not found', 404)
    versions = file_manager.list_versions(file_id)
    return jsonify({
        'status': 'success',
        'current_version': meta.get('version', 1),
        'versions': versions,
    })


@app.route('/api/files/<file_id>/versions/<version_name>/download')
def download_version(file_id, version_name):
    meta = file_manager.load_meta(file_id)
    if not meta:
        return _error('File not found', 404)
    if '..' in version_name or '/' in version_name or '\\' in version_name:
        return _error('Invalid version name', 400)
    path = os.path.join(file_manager.versions_dir(file_id), version_name)
    if not os.path.isfile(path):
        return _error('Version not found', 404)
    return send_file(path, mimetype='application/pdf', as_attachment=True)


@app.route('/api/files/<file_id>/pages/<int:page_num>/text')
def page_text(file_id, page_num):
    scale = request.args.get('scale', 1.5, type=float)
    try:
        data = pdf_service.extract_page_text_items(file_id, page_num, scale=scale)
    except ValueError as exc:
        return _error(str(exc), 404)
    return jsonify({'status': 'success', 'page': data})


@app.route('/api/files/<file_id>/save', methods=['POST'])
def save_file(file_id):
    meta = file_manager.load_meta(file_id)
    if not meta:
        return _error('File not found', 404)

    payload = request.get_json(silent=True)
    if not payload or 'pages' not in payload:
        return _error('Missing pages payload')

    try:
        updated = pdf_service.save_document(file_id, payload['pages'])
    except ValueError as exc:
        return _error(str(exc), 400)
    except Exception as exc:
        return _error(f'Failed to save PDF: {exc}', 500)

    return jsonify({'status': 'success', 'file': updated})


if __name__ == '__main__':
    app.run(debug=True)
