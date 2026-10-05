/**
 * seedDeptUser.js
 * 
 * Automatically creates the departmental login user & developer test user in MongoDB
 * the first time the server starts.
 */

import bcrypt from 'bcryptjs';
import User from '../models/User.js';

const seedDeptUser = async () => {
  // 1. Seed Department User from .env
  const email    = process.env.DEPT_EMAIL;
  const password = process.env.DEPT_PASSWORD;

  if (email && password) {
    try {
      const existing = await User.findOne({ email: email.toLowerCase() });
      const hashedPassword = await bcrypt.hash(password, 12);

      if (existing) {
        existing.password = hashedPassword;
        existing.isAdmin = false;
        existing.isVerified = true;
        existing.isActive = true;
        existing.firstName = 'Department';
        existing.lastName = 'User';
        existing.subscriptionStatus = 'departmental';
        existing.userTier = 'departmental';
        await existing.save();
        console.log(`[Seed] ✅ Department user (${email}) updated with current .env password.`);
      } else {
        await User.create({
          email:        email.toLowerCase(),
          password:     hashedPassword,
          firstName:    'Department',
          lastName:     'User',
          isAdmin:      false,
          isVerified:   true,
          isActive:     true,
          subscriptionStatus: 'departmental',
          userTier:     'departmental',
        });
        console.log(`[Seed] ✅ Department user created: ${email}`);
      }
    } catch (err) {
      console.error('[Seed] Failed to seed department user:', err.message);
    }
  }

  // 2. Seed Test Developer User: mohitkr@gmail.com / test1234
  try {
    const testEmail = 'mohitkr@gmail.com';
    const testPassword = 'test1234';
    const existingTest = await User.findOne({ email: testEmail });
    const hashedTestPassword = await bcrypt.hash(testPassword, 12);

    if (existingTest) {
      existingTest.password = hashedTestPassword;
      existingTest.isVerified = true;
      existingTest.isActive = true;
      if (!existingTest.companySlug) existingTest.companySlug = 'mohit-law-firm';
      await existingTest.save();
      console.log(`[Seed] ✅ Test account (${testEmail}) verified & synced with password '${testPassword}'.`);
    } else {
      await User.create({
        email: testEmail,
        password: hashedTestPassword,
        firstName: 'Mohit',
        lastName: 'Kumar',
        isVerified: true,
        isActive: true,
        subscriptionStatus: 'pro',
        userTier: 'pro',
        companyName: 'Mohit & Associates',
        sector: 'Legal',
        companySlug: 'mohit-law-firm'
      });
      console.log(`[Seed] ✅ Test account created: ${testEmail} / ${testPassword}`);
    }
  } catch (err) {
    console.error('[Seed] Failed to seed test user:', err.message);
  }
};

export default seedDeptUser;
