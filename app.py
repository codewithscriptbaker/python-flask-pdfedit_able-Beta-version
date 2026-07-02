from flask import Flask, request, jsonify, render_template
import fitz  # PyMuPDF

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/update_text', methods=['POST'])
def update_text():
    data = request.json
    pdf_path = 'Complaint.pdf'
    page_num = data['page_num']
    x = data['x']
    y = data['y']
    width = data['width']
    height = data['height']
    new_text = data['new_text']

    pdf_document = fitz.open(pdf_path)
    page = pdf_document.load_page(page_num - 1)  # Page number is 0-indexed in PyMuPDF

    # Find and replace text logic here
    # You need to use some heuristic or text search to find the exact position
    # where to replace the text. PyMuPDF does not support direct text replacement,
    # so you'll need to draw new text over the old one.

    # Example (you need to refine this):
    rect = fitz.Rect(x, y - height, x + width, y)
    page.insert_textbox(rect, new_text, fontsize=11)  # Adjust fontsize and other options

    pdf_document.save('Updated_Complaint.pdf', incremental=True)
    pdf_document.close()

    return jsonify({'status': 'success'})

if __name__ == '__main__':
    app.run(debug=True)
