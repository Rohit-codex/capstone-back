import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment from ../.env
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const config = {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
};

cloudinary.config(config);

const args = process.argv.slice(2);
const targetPublicId = args[0] || 'chat-files/ghagdvs2nq7tlbccqsrp'; // Default from recent issue
const targetType = args[1] || 'upload'; // upload, private, authenticated
const targetResourceType = args[2] || 'image'; // image, raw, video

async function testFetch(url, description) {
    try {
        console.log(`\nTesting: ${description}`);
        console.log(`URL: ${url}`);
        const res = await fetch(url, { headers: { 'User-Agent': 'DastavezAI-Debugger' } });
        console.log(`Status: ${res.status} ${res.statusText}`);
        if (res.ok) {
            console.log('✅ SUCCESS');
            return true;
        } else {
            console.log('❌ FAILED');
            return false;
        }
    } catch (e) {
        console.log(`❌ ERROR: ${e.message}`);
        return false;
    }
}

async function main() {
    console.log('==========================================');
    console.log('CLOUDINARY DEBUGGER - DASTAVEZ AI');
    console.log('==========================================');

    // 1. Config Check
    console.log('\n[1] CONFIGURATION CHECK');
    console.log(`Cloud Name: ${config.cloud_name || 'MISSING'}`);
    console.log(`API Key:    ${config.api_key ? 'Set' : 'MISSING'}`);
    console.log(`API Secret: ${config.api_secret ? 'Set' : 'MISSING'}`);

    if (!config.cloud_name || !config.api_key || !config.api_secret) {
        console.error('❌ Missing credentials. Check .env file.');
        process.exit(1);
    }

    // 2. Ping
    console.log('\n[2] API CONNECTIVITY');
    try {
        const ping = await cloudinary.api.ping();
        console.log('✅ Ping Successful:', ping.status);
    } catch (e) {
        console.error('❌ Ping Failed:', e.message);
        console.error('   Check your API Key and Secret.');
    }

    // 3. Resource Inspection
    console.log('\n[3] RESOURCE INSPECTION');
    console.log(`Targeting Public ID: ${targetPublicId}`);

    let resourceDetails = null;
    try {
        resourceDetails = await cloudinary.api.resource(targetPublicId, {
            resource_type: targetResourceType,
            type: targetType
        });
        console.log('✅ Resource Found via Admin API:');
        console.log(`   - Use Type: ${resourceDetails.type}`);
        console.log(`   - Format: ${resourceDetails.format}`);
        console.log(`   - Bytes: ${resourceDetails.bytes}`);
        console.log(`   - Access Mode: ${resourceDetails.access_mode}`);
        console.log(`   - Secure URL: ${resourceDetails.secure_url}`);
    } catch (e) {
        console.error(`⚠️ Resource not found via Admin API (${targetType}/${targetResourceType}): ${e.message}`);
        console.log('   (This is common if the resource type or access type is guessed wrong)');
    }

    const version = resourceDetails?.version || '1234567890'; // Use real or dummy
    const format = resourceDetails?.format || (targetResourceType === 'image' ? 'pdf' : ''); // Guess format if missing

    // 4. Access Strategy Tests
    console.log('\n[4] ACCESS STRATEGY TESTS');

    // Strategy A: Public Access
    const publicUrl = cloudinary.url(targetPublicId, {
        resource_type: targetResourceType,
        type: targetType,
        format: format,
        version: version,
        secure: true
    });
    await testFetch(publicUrl, 'Standard Public URL');

    // Strategy B: Signed 'upload' (Transformation)
    const signedUploadUrl = cloudinary.url(targetPublicId, {
        resource_type: targetResourceType,
        type: 'upload',
        format: format,
        version: version,
        secure: true,
        sign_url: true,
        transformation: [{ quality: 'auto' }] // Dummy transform to force signing
    });
    await testFetch(signedUploadUrl, 'Signed Upload URL (q_auto)');

    // Strategy C: Signed 'authenticated'
    const signedAuthUrl = cloudinary.url(targetPublicId, {
        resource_type: targetResourceType,
        type: 'authenticated',
        format: format, // Vital for PDFs treated as images
        version: version,
        secure: true,
        sign_url: true
    });
    await testFetch(signedAuthUrl, 'Signed Authenticated URL');

    // Strategy D: Token Authentication
    const aclPath = `/${targetResourceType}/${targetType}/v${version}/${targetPublicId}${format ? '.' + format : ''}`;
    const token = cloudinary.utils.generate_auth_token({
        acl: aclPath,
        key: config.api_key,
        startTime: Math.floor(Date.now() / 1000),
        duration: 300
    });
    const tokenUrl = `https://res.cloudinary.com/${config.cloud_name}${aclPath}?__cld_token__=${token}`;
    await testFetch(tokenUrl, 'Token Authenticated URL');

    console.log('\n==========================================');
    console.log('DEBUG COMPLETE');
    console.log('If "Token Authenticated URL" worked, ensure backend uses generate_auth_token.');
    console.log('If "Signed Authenticated URL" worked, ensure backend uses type: "authenticated".');
    console.log('==========================================');
}

main();
