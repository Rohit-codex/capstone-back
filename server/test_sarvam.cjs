const axios = require('axios');
const fs = require('fs');
require('dotenv').config({ path: '.env' });

async function testSarvam() {
  const apiKey = process.env.sarvamai;
  if (!apiKey) {
    console.error("No API key found in .env under 'sarvamai'");
    return;
  }
  
  try {
    const FormData = require('form-data');
    let form = new FormData();
    fs.writeFileSync('test.txt', 'This is a test document');
    form.append('file', fs.createReadStream('test.txt'));
    
    let res = await axios.post('https://api.sarvam.ai/document/parse', form, {
      headers: {
        'api-subscription-key': apiKey,
        ...form.getHeaders()
      }
    });
    console.log("Success /document/parse!", res.data);
  } catch(e) {
    // console.log("/document/parse failed:", e.response?.status, e.response?.data);
  }

  try {
    let res = await axios.post('https://api.sarvam.ai/doc-digitization/job/v1', {
      job_parameters: {
        language: 'en-IN',
        output_format: 'md'
      }
    }, {
      headers: {
        'api-subscription-key': apiKey,
        'Content-Type': 'application/json'
      }
    });
    console.log("Job Response:", res.data);
  } catch (error) {
    console.error("Error:", error.response?.status, error.response?.data || error.message);
  }
}

testSarvam();
