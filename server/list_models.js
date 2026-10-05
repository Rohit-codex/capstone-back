import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
    console.error('❌ GEMINI_API_KEY not found in environment variables');
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

async function listModels() {
    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        // Note: The SDK might not have a direct listModels method exposed easily on the instance 
        // depending on the version, but typically it is on the client or via a separate API call.
        // Actually, for the JS SDK, it's often not directly exposed in the main class in older versions,
        // but let's try to just test the specific model the user is asking for or print what we can.

        // There isn't a simple "listModels" in the high-level GoogleGenerativeAI class in all versions.
        // Instead, I will test if 'gemini-2.0-flash-lite-preview-02-05' works, or just print standard ones.

        console.log('Checking model availability...');

        const candidates = [
            'gemini-2.5-flash-lite', // The requested model
            'gemini-2.5-flash',
            'gemini-2.0-flash-lite-preview-02-05',
            'gemini-2.0-flash',
            'gemini-1.5-flash',
            'gemini-1.5-pro'
        ];

        for (const modelName of candidates) {
            try {
                const m = genAI.getGenerativeModel({ model: modelName });
                const result = await m.generateContent('Hello');
                if (result && result.response) {
                    console.log(`✅ Available: ${modelName}`);
                }
            } catch (e) {
                console.log(`❌ Unavailable: ${modelName} (${e.message.split(' ')[0]})`);
            }
        }

    } catch (error) {
        console.error('Error listing models:', error);
    }
}

listModels();
