import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

// Config
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const TEST_FILE = {
    publicId: 'chat-files/jwbf8aoekeh9wa71iyuq',
    url: 'https://res.cloudinary.com/ddtnwszra/image/upload/v1771153261/chat-files/jwbf8aoekeh9wa71iyuq.pdf',
    type: 'pdf'
};
async function main() {
    console.log('--- Config Check ---');
    console.log(`Cloud Name: ${process.env.CLOUDINARY_CLOUD_NAME}`);

    // Default version
    let resourceVersion = TEST_FILE.version || '1';

    // Inspect Resource via Admin API (to get real version)
    try {
        console.log('\nInspecting Resource via Admin API...');
        const resource = await cloudinary.api.resource(TEST_FILE.publicId, {
            resource_type: 'image',
            type: 'upload'
        });
        console.log('Resource Details:');
        console.log(`- Public ID: ${resource.public_id}`);
        console.log(`- Type: ${resource.type}`);
        console.log(`- Access Mode: ${resource.access_mode}`);
        console.log(`- Format: ${resource.format}`);
        console.log(`- Version: ${resource.version}`);
        console.log(`- Access Control:`, JSON.stringify(resource.access_control));
        resourceVersion = resource.version;
    } catch (e) {
        console.log('Admin API Inspection Failed:', e.message);
        // Fallback to TEST_FILE.version if Admin API fails
        resourceVersion = TEST_FILE.version;
    }

    const runTest = async (cfg) => {
        console.log(`\n-----------------------------------`);
        console.log(`Testing: type=${cfg.type}, resource_type=${cfg.resource_type}, publicId=${cfg.publicId}, version=${cfg.version}`);

        const options = {
            sign_url: true,
            type: cfg.type,
            resource_type: cfg.resource_type,
            secure: true,
            version: cfg.version,
        };

        if (cfg.transformation) options.transformation = cfg.transformation;
        if (cfg.resource_type === 'image' && cfg.type !== 'token_auth') options.format = 'pdf';

        const url = cloudinary.url(cfg.publicId, options);
        console.log(`Generated URL: ${url}`);

        try {
            const res = await fetch(url);
            console.log(`Status: ${res.status}`);
            if (res.ok) console.log('✅ SUCCESS!');
            else console.log(`❌ Failed: ${res.status}`);
        } catch (e) {
            console.log(`❌ Network Error: ${e.message}`);
        }
    };

    console.log(`\nTesting: Authenticated (Original)...`);
    await runTest({
        type: 'authenticated',
        resource_type: 'image',
        publicId: TEST_FILE.publicId,
        version: resourceVersion
    });

    console.log(`\nTesting: Private (Original)...`);
    await runTest({
        type: 'private',
        resource_type: 'image',
        publicId: TEST_FILE.publicId,
        version: resourceVersion,
        format: 'pdf' // Private URLs often need extension
    });
    try {
        console.log("\nTesting: Token Auth...");
        // Path in URL: /image/upload/v1771149753/chat-files/ghagdvs2nq7tlbccqsrp.pdf
        const aclPath = `/image/upload/v${TEST_FILE.version}/${TEST_FILE.publicId}.pdf`;

        const token = cloudinary.utils.generate_auth_token({
            acl: aclPath,
            key: process.env.CLOUDINARY_API_KEY,
            startTime: Math.floor(Date.now() / 1000),
            duration: 300
        });

        const publicUrl = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}${aclPath}`;
        const tokenUrl = `${publicUrl}?__cld_token__=${token}`;

        console.log(`Generated URL: ${tokenUrl}`);
        const res = await fetch(tokenUrl);
        console.log(`Status: ${res.status}`);
        if (res.ok) console.log('✅ SUCCESS!');
        else console.log(`❌ Failed: ${res.status}`);

    } catch (mainErr) {
        console.error("Token Auth Error:", mainErr);
    }
}

main().catch(e => console.error("Top level error:", e));
