import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pdfPath =
  process.argv[2] ||
  path.join(
    __dirname,
    '../../../database/SECTION WISE OATH COPY OF MJC/MJC 1423 OF 2021 UMESH BAITHA-SECTION-17.pdf'
  );

const buffer = fs.readFileSync(pdfPath);
const pdfParse = require('pdf-parse');
const data = await pdfParse(buffer);
const info = await pdfParse.getInfo?.({ parsePageInfo: true }) || data;
console.log('pages', info.pages ?? data?.numpages ?? '?');
console.log('---TEXT START---');
console.log(String(data?.text || '').slice(0, 6000));
