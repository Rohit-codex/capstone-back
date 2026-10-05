import os

path = 'C:/Users/ris15/Desktop/dastavezai-web/backend/server/controllers/fileController.js'

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

marker = "    const { file } = req;"
if marker in content:
    replacement = """    const { file } = req;
    
    if (file && file.originalname) {
      // Fix multer latin1 filename mangling for UTF-8 filenames
      try {
        file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
      } catch (e) {
        console.warn('Failed to decode filename', e);
      }
    }
"""
    content = content.replace(marker, replacement)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("Fixed multer filename encoding")
else:
    print("Marker not found")