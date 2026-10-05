/**
 * API Endpoint Testing Script
 * Tests critical endpoints: Upload, History, File List
 * 
 * Usage: node test_endpoints.js
 */

import fetch from 'node-fetch';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE = 'http://localhost:5000/api';
let authToken = null;

// Test credentials (you should use real test account)
const TEST_EMAIL = 'test@example.com';
const TEST_PASSWORD = 'TestPassword123';

// Color output helpers
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
    log(`✅ ${message}`, 'green');
}

function logError(message) {
    log(`❌ ${message}`, 'red');
}

function logInfo(message) {
    log(`ℹ️  ${message}`, 'blue');
}

function logWarning(message) {
    log(`⚠️  ${message}`, 'yellow');
}

// Test helper function
async function testEndpoint(name, fn) {
    log(`\n${'='.repeat(50)}`, 'blue');
    logInfo(`Testing: ${name}`);
    log('='.repeat(50), 'blue');

    try {
        await fn();
        logSuccess(`${name} - PASSED`);
        return true;
    } catch (error) {
        logError(`${name} - FAILED: ${error.message}`);
        console.error(error);
        return false;
    }
}

// 1. Test Health Endpoint
async function testHealth() {
    const response = await fetch(`${API_BASE}/health`);
    const data = await response.json();

    if (!response.ok) throw new Error(`Health check failed: ${response.status}`);
    if (!data.ok) throw new Error('Health status not OK');

    logInfo(`Server is healthy: ${JSON.stringify(data)}`);
}

// 2. Test Login (to get auth token)
async function testLogin() {
    logInfo(`Attempting login with ${TEST_EMAIL}...`);

    const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: TEST_EMAIL,
            password: TEST_PASSWORD
        })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Login failed: ${response.status} - ${errorData.message || 'Unknown error'}`);
    }

    const data = await response.json();
    authToken = data.token;

    if (!authToken) {
        throw new Error('No token received from login');
    }

    logInfo(`Successfully logged in. Token received.`);
}

// 3. Test Chat History Endpoint
async function testChatHistory() {
    if (!authToken) {
        logWarning('Skipping chat history test - no auth token');
        return;
    }

    const response = await fetch(`${API_BASE}/chat/history`, {
        headers: {
            'Authorization': `Bearer ${authToken}`
        }
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Chat history failed: ${response.status} - ${errorData.message || 'Unknown error'}`);
    }

    const data = await response.json();
    logInfo(`Chat history retrieved: ${Array.isArray(data) ? data.length : 'N/A'} messages`);

    // Log first message if exists
    if (Array.isArray(data) && data.length > 0) {
        logInfo(`Latest message: ${JSON.stringify(data[0]).substring(0, 100)}...`);
    }
}

// 4. Test File List Endpoint
async function testFileList() {
    if (!authToken) {
        logWarning('Skipping file list test - no auth token');
        return;
    }

    const response = await fetch(`${API_BASE}/files/all`, {
        headers: {
            'Authorization': `Bearer ${authToken}`
        }
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`File list failed: ${response.status} - ${errorData.message || 'Unknown error'}`);
    }

    const data = await response.json();
    const files = Array.isArray(data) ? data : (data.files || []);

    logInfo(`Files retrieved: ${files.length} files`);

    if (files.length > 0) {
        logInfo(`Latest file: ${files[0].fileName} (${files[0].fileSize} bytes)`);
    }
}

// 5. Test File Upload Endpoint
async function testFileUpload() {
    if (!authToken) {
        logWarning('Skipping file upload test - no auth token');
        return;
    }

    // Create a test file
    const testFilePath = path.join(__dirname, 'test_upload.txt');
    const testContent = `Test file created at ${new Date().toISOString()}\nThis is a test upload.`;
    fs.writeFileSync(testFilePath, testContent);

    try {
        const form = new FormData();
        form.append('file', fs.createReadStream(testFilePath), {
            filename: 'test_upload.txt',
            contentType: 'text/plain'
        });

        const response = await fetch(`${API_BASE}/files/upload`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                ...form.getHeaders()
            },
            body: form
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`File upload failed: ${response.status} - ${errorData.message || 'Unknown error'}`);
        }

        const data = await response.json();
        logInfo(`File uploaded successfully: ${data.file?.fileName || data.fileName || 'unknown'}`);
        logInfo(`File ID: ${data.file?._id || data._id || 'N/A'}`);
    } finally {
        // Clean up test file
        if (fs.existsSync(testFilePath)) {
            fs.unlinkSync(testFilePath);
            logInfo('Test file cleaned up');
        }
    }
}

// Main test runner
async function runTests() {
    log('\n🚀 Starting API Endpoint Tests\n', 'blue');

    const results = {
        passed: 0,
        failed: 0,
        skipped: 0
    };

    // Run tests in sequence
    const tests = [
        ['Health Check', testHealth],
        ['User Login', testLogin],
        ['Chat History', testChatHistory],
        ['File List', testFileList],
        ['File Upload', testFileUpload]
    ];

    for (const [name, fn] of tests) {
        const passed = await testEndpoint(name, fn);
        if (passed) results.passed++;
        else results.failed++;
    }

    // Summary
    log('\n' + '='.repeat(50), 'blue');
    log('📊 TEST SUMMARY', 'blue');
    log('='.repeat(50), 'blue');
    logSuccess(`Passed: ${results.passed}`);
    if (results.failed > 0) logError(`Failed: ${results.failed}`);
    if (results.skipped > 0) logWarning(`Skipped: ${results.skipped}`);
    log('='.repeat(50) + '\n', 'blue');

    process.exit(results.failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(error => {
    logError(`Fatal error: ${error.message}`);
    console.error(error);
    process.exit(1);
});
