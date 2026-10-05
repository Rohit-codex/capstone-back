import 'dotenv/config';
import mongoose from 'mongoose';
import EditSession from '../models/EditSession.js';
import BulkReview from '../models/BulkReview.js';
import User from '../models/User.js';
import { runBulkReviewChat, startBulkReview } from '../controllers/bulkReviewController.js';

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is not set in env.');
  process.exit(1);
}

const runTest = async () => {
  try {
    console.log('Connecting to database...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected.');

    // 1. Get or create a test user
    let user = await User.findOne({ email: 'test_reviewer@dastavezai.com' });
    if (!user) {
      user = await User.create({
        firstName: 'Test',
        lastName: 'Reviewer',
        email: 'test_reviewer@dastavezai.com',
        password: 'Password123'
      });
      console.log('Created test user:', user._id);
    }

    // 2. Create 2 mock EditSession files
    console.log('Creating mock EditSessions...');
    const doc1 = await EditSession.create({
      userId: user._id,
      fileName: 'Office_Lease_Agreement.txt',
      originalText: `LEASE AGREEMENT
This Lease Agreement is entered into on June 15, 2026, by and between Landlord Prime Properties and Tenant TechStart Solutions.
1. LEASE TERM: The lease term shall commence on July 1, 2026, and terminate on June 30, 2029.
2. RENT: Tenant shall pay monthly rent of $3,500 due on the 1st of each month.`,
      currentText: 'Lease details...',
      status: 'active'
    });

    const doc2 = await EditSession.create({
      userId: user._id,
      fileName: 'Mutual_Non_Disclosure_Agreement.txt',
      originalText: `MUTUAL NON-DISCLOSURE AGREEMENT
This NDA is executed on June 20, 2026, by and between TechStart Solutions and Prime Properties.
1. CONFIDENTIALITY PERIOD: The parties agree to maintain confidentiality of Shared Info starting from the Effective Date (June 20, 2026) for a period of 5 years ending on June 20, 2031.`,
      currentText: 'NDA details...',
      status: 'active'
    });

    console.log(`Created Doc 1 (${doc1.fileName}) ID: ${doc1._id}`);
    console.log(`Created Doc 2 (${doc2.fileName}) ID: ${doc2._id}`);

    // Mock request and response to run startBulkReview controller
    let createdSessionId = null;
    const req = {
      body: {
        editSessionIds: [doc1._id, doc2._id]
      },
      user: {
        _id: user._id
      }
    };

    const res = {
      status: (code) => ({
        json: (data) => {
          console.log(`Response Status: ${code}`, data);
          createdSessionId = data.sessionId;
        }
      })
    };

    console.log('\n--- Starting parallel bulk review session ---');
    await startBulkReview(req, res);

    if (!createdSessionId) {
      throw new Error('Failed to create bulk review session');
    }

    // Poll status of processing
    console.log(`Polling status for session ${createdSessionId}...`);
    let session = null;
    for (let i = 0; i < 30; i++) {
      session = await BulkReview.findById(createdSessionId);
      console.log(`Attempt ${i+1}: Status is "${session.status}"`);
      if (session.status === 'completed' || session.status === 'completed_with_errors' || session.status === 'failed') {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    if (session.status !== 'completed' && session.status !== 'completed_with_errors') {
      throw new Error(`Session did not complete successfully. Status: ${session.status}`);
    }

    console.log('\n--- Ingestion Verification ---');
    console.log(`Documents count in session: ${session.documents.length}`);
    session.documents.forEach((doc, idx) => {
      console.log(`Document #${idx + 1}: ${doc.fileName}`);
      console.log(`  Context: ${doc.context.substring(0, 150)}...`);
      console.log(`  Key Points: ${doc.keyPoints.substring(0, 150)}...`);
      console.log(`  Dates Found:`, JSON.stringify(doc.dates));
    });

    console.log('\n--- Simulating Q&A (Agent 4 Chat) ---');
    const query = "What are the commencement dates of the Lease Agreement and the Non-Disclosure Agreement respectively, and which document remains active longer?";
    console.log(`User Message: "${query}"`);
    
    const reply = await runBulkReviewChat(session._id, query);
    console.log('\nAssistant Reply:\n', reply);

    // Clean up test data
    console.log('\nCleaning up mock data...');
    await EditSession.deleteOne({ _id: doc1._id });
    await EditSession.deleteOne({ _id: doc2._id });
    await BulkReview.deleteOne({ _id: createdSessionId });
    console.log('Cleanup complete.');

    console.log('Test completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  }
};

runTest();
