/**
 * seedAdminUser.js
 * 
 * Automatically creates the Super Admin user in MongoDB
 * using credentials stored in .env:
 *   ADMIN_EMAIL    (e.g. admin@gmail.com)
 *   ADMIN_PASSWORD (e.g. #theadmin)
 */

import bcrypt from 'bcryptjs';
import User from '../models/User.js';

const seedAdminUser = async () => {
  const email    = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.log('[Seed] ADMIN_EMAIL or ADMIN_PASSWORD not set — skipping super admin seed.');
    return;
  }

  try {
    const existing = await User.findOne({ email: email.toLowerCase() });
    const hashedPassword = await bcrypt.hash(password, 12);

    if (existing) {
      existing.password = hashedPassword;
      existing.isAdmin = true;
      existing.isVerified = true;
      existing.isActive = true;
      existing.firstName = 'Super';
      existing.lastName = 'Admin';
      await existing.save();
      console.log(`[Seed] ✅ Super Admin user (${email}) updated with current .env password.`);
      return;
    }

    await User.create({
      email:        email.toLowerCase(),
      password:     hashedPassword,
      firstName:    'Super',
      lastName:     'Admin',
      isAdmin:      true,
      isVerified:   true,
      isActive:     true,
      subscriptionStatus: 'premium',
      userTier:     'premium',
    });

    console.log(`[Seed] ✅ Super Admin user created: ${email}`);
  } catch (err) {
    console.error('[Seed] Failed to seed super admin user:', err.message);
  }
};

export default seedAdminUser;
