const axios = require('axios');

(async () => {
  try {
    const payload = {
      model: 'llama3.1:8b',
      prompt: 'How do I file an FIR for vehicle theft in India? Provide procedural steps and a short one-line disclaimer at end.',
      stream: false
    };

    const res = await axios.post('http://localhost:11434/api/generate', payload, { timeout: 30000 });
    console.log('LLM raw response:');
    console.log(JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error('LLM test error:', err.toString());
    if (err.response && err.response.data) {
      console.error('LLM response data:', JSON.stringify(err.response.data, null, 2));
    }
  }
})();
