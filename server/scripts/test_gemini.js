import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function testGemini() {
    console.log('--- Gemini Configuration Check ---');
    console.log(`API Key Present: ${Boolean(process.env.GEMINI_API_KEY)}`);

    if (!process.env.GEMINI_API_KEY) {
        console.error('❌ Missing GEMINI_API_KEY');
        process.exit(1);
    }

    const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
    console.log(`Target Model: ${modelName}`);

    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: modelName });

        console.log('Sending test prompt...');
        const result = await model.generateContent('Hello, are you online?');
        const response = await result.response;
        const text = response.text();

        console.log('✅ Response received:');
        console.log(text);
        console.log('--- Gemini Test SUCCESS ---');
        return true;
    } catch (error) {
        console.error('❌ Gemini Test Failed:', error.message);
        if (error.message.includes('404')) {
            console.error('   Hint: The model name might be invalid for your API key or region.');
        }
        return false;
    }
}

testGemini();
