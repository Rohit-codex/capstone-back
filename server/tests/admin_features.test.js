import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const BASE_URL = `http://localhost:${process.env.PORT || 5000}/api`;

async function testSuite() {
  console.log('🚀 Starting Admin Features Integration Tests...');
  let adminToken = '';

  // 1. Log in as Admin
  try {
    const loginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@gmail.com',
        password: '#theadmin'
      })
    });
    const loginData = await loginRes.json();
    if (!loginRes.ok) {
      throw new Error(`Login failed: ${loginData.message}`);
    }
    adminToken = loginData.token;
    console.log('✅ 1. Admin login successful.');
  } catch (err) {
    console.error('❌ 1. Admin login failed:', err.message);
    process.exit(1);
  }

  const adminHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${adminToken}`
  };

  // 2. Test Multi-Tier Subscription Price & Limits
  try {
    // Get all prices
    const getPriceRes = await fetch(`${BASE_URL}/subscription/price`);
    const getPriceData = await getPriceRes.json();
    if (!getPriceRes.ok) throw new Error(`GET /subscription/price failed: ${getPriceData.message}`);
    if (!Array.isArray(getPriceData.prices)) throw new Error('Prices response is not an array.');
    console.log('✅ 2a. GET /subscription/price successful. Loaded tiers count:', getPriceData.prices.length);

    // Find standard tier before update
    const standardBefore = getPriceData.prices.find(p => p.tier === 'standard');
    if (!standardBefore) throw new Error('Standard tier not found in defaults.');

    // Update standard tier price and message limit
    const newPrice = 149900; // in paise (1499 INR)
    const newLimit = 45;
    const updatePriceRes = await fetch(`${BASE_URL}/subscription/price`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({
        tier: 'standard',
        amount: newPrice,
        messageLimit: newLimit
      })
    });
    const updatePriceData = await updatePriceRes.json();
    if (!updatePriceRes.ok) throw new Error(`PUT /subscription/price failed: ${updatePriceData.message}`);
    console.log('✅ 2b. PUT /subscription/price successful for standard tier.');

    // Verify update
    const verifyPriceRes = await fetch(`${BASE_URL}/subscription/price`);
    const verifyPriceData = await verifyPriceRes.json();
    const standardAfter = verifyPriceData.prices.find(p => p.tier === 'standard');
    if (!standardAfter) throw new Error('Standard tier not found after update.');
    if (standardAfter.amount !== newPrice || standardAfter.messageLimit !== newLimit) {
      throw new Error(`Verification failed. Expected price ${newPrice} and limit ${newLimit}, got price ${standardAfter.amount} and limit ${standardAfter.messageLimit}`);
    }
    console.log('✅ 2c. Multi-tier price and limit verification successful.');
  } catch (err) {
    console.error('❌ 2. Multi-tier subscription test failed:', err.message);
    process.exit(1);
  }

  // 3. Test Contact Submissions
  try {
    // Submit a new inquiry
    const submitRes = await fetch(`${BASE_URL}/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'John Doe',
        email: 'johndoe@example.com',
        phone: '1234567890',
        subject: 'Demo Request for Corporate Plan',
        message: 'Hello, I would like to schedule a demo of your enterprise solution.',
        type: 'demo',
        company: 'ACME Corp',
        role: 'Legal Lead',
        teamSize: '10-50'
      })
    });
    const submitData = await submitRes.json();
    if (!submitRes.ok) throw new Error(`POST /contact/submit failed: ${submitData.message}`);
    console.log('✅ 3a. POST /contact/submit successful.');

    // Fetch submissions as admin
    const listRes = await fetch(`${BASE_URL}/contact/admin/submissions`, {
      headers: adminHeaders
    });
    const listData = await listRes.json();
    if (!listRes.ok) throw new Error(`GET /contact/admin/submissions failed: ${listData.message}`);
    
    const matched = listData.data.find(s => s.email === 'johndoe@example.com');
    if (!matched) throw new Error('Submitted inquiry was not found in admin list.');
    console.log('✅ 3b. GET /contact/admin/submissions successful. Found created inquiry.');

    // Mark as read
    const markReadRes = await fetch(`${BASE_URL}/contact/admin/submissions/${matched._id}/read`, {
      method: 'PUT',
      headers: adminHeaders
    });
    if (!markReadRes.ok) throw new Error('PUT /contact/admin/submissions/:id/read failed');
    console.log('✅ 3c. PUT /contact/admin/submissions/:id/read successful.');

    // Delete submission
    const deleteRes = await fetch(`${BASE_URL}/contact/admin/submissions/${matched._id}`, {
      method: 'DELETE',
      headers: adminHeaders
    });
    if (!deleteRes.ok) throw new Error('DELETE /contact/admin/submissions/:id failed');
    console.log('✅ 3d. DELETE /contact/admin/submissions/:id successful.');
  } catch (err) {
    console.error('❌ 3. Contact submissions test failed:', err.message);
    process.exit(1);
  }

  // 4. Test Lawyers Management
  try {
    // Create lawyer
    const createRes = await fetch(`${BASE_URL}/admin/lawyers`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        name: 'Jane Smith',
        phone: '9876543210',
        email: 'janesmith@lawyer.com',
        address: '123 Court Chamber, New Delhi'
      })
    });
    const createdLawyer = await createRes.json();
    if (!createRes.ok) throw new Error(`POST /admin/lawyers failed: ${createdLawyer.message}`);
    console.log('✅ 4a. POST /admin/lawyers successful. Created:', createdLawyer.name);

    // List lawyers (Public)
    const listRes = await fetch(`${BASE_URL}/lawyers`);
    const lawyersList = await listRes.json();
    if (!listRes.ok) throw new Error('GET /lawyers failed');
    const found = lawyersList.find(l => l._id === createdLawyer._id);
    if (!found) throw new Error('Created lawyer not found in public list.');
    console.log('✅ 4b. GET /lawyers successful. Found created lawyer.');

    // Update lawyer
    const updateRes = await fetch(`${BASE_URL}/admin/lawyers/${createdLawyer._id}`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({
        name: 'Jane Doe Smith',
        phone: '9876543210',
        email: 'janesmith@lawyer.com',
        address: '456 High Court Chambers, New Delhi'
      })
    });
    const updatedLawyer = await updateRes.json();
    if (!updateRes.ok) throw new Error(`PUT /admin/lawyers/:id failed: ${updatedLawyer.message}`);
    if (updatedLawyer.name !== 'Jane Doe Smith') throw new Error('Lawyer name update not reflected.');
    console.log('✅ 4c. PUT /admin/lawyers/:id successful. Updated name:', updatedLawyer.name);

    // Delete lawyer
    const deleteRes = await fetch(`${BASE_URL}/admin/lawyers/${createdLawyer._id}`, {
      method: 'DELETE',
      headers: adminHeaders
    });
    const deleteData = await deleteRes.json();
    if (!deleteRes.ok) throw new Error(`DELETE /admin/lawyers/:id failed: ${deleteData.message}`);
    console.log('✅ 4d. DELETE /admin/lawyers/:id successful.');
  } catch (err) {
    console.error('❌ 4. Lawyers test failed:', err.message);
    process.exit(1);
  }

  console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! 🎉');
  process.exit(0);
}

testSuite();
