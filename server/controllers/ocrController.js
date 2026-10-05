import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const digitizeDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const scriptPath = path.join(__dirname, '../scripts/sarvam_ocr.py');

    // Make sure the sarvamai key is set in environment from process.env
    const env = { ...process.env };
    if (!env.sarvamai) {
      return res.status(500).json({ success: false, message: 'SARVAM_API_KEY missing in server env (sarvamai)' });
    }

    // Spawn python script
    const pyProcess = spawn('python', [scriptPath, filePath], { env });

    let dataOutput = '';
    let errorOutput = '';

    pyProcess.stdout.on('data', (data) => {
      dataOutput += data.toString();
    });

    pyProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    pyProcess.on('close', (code) => {
      if (code !== 0) {
        console.error('Python script error:', errorOutput);
        return res.status(500).json({ 
          success: false, 
          message: 'Error executing OCR script',
          error: errorOutput || dataOutput
        });
      }

      try {
        const result = JSON.parse(dataOutput);
        if (result.error) {
          return res.status(500).json({ success: false, message: result.error });
        }
        
        return res.status(200).json({
          success: true,
          text: result.text,
          sessionId: result.job_id
        });
      } catch (err) {
        console.error('Error parsing python output:', err, dataOutput);
        return res.status(500).json({ success: false, message: 'Failed to parse OCR response' });
      }
    });

  } catch (error) {
    console.error('OCR Controller Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};
