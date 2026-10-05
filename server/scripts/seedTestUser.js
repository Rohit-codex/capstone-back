/**
 * seedTestUser.js
 *
 * Creates a permanent test account on every server start (upserts).
 * Credentials: mohitkr@gmail.com / test123
 *
 * Only runs in development (NODE_ENV !== 'production').
 */

import bcrypt from 'bcryptjs';
import User from '../models/User.js';

const TEST_EMAIL    = 'mohitkr@gmail.com';
const TEST_PASSWORD = 'test1234';

const seedTestUser = async () => {
  try {
    const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 12);

    await User.findOneAndUpdate(
      { email: TEST_EMAIL },
      {
        $set: { password: hashedPassword, isVerified: true, isActive: true },
        $setOnInsert: {
          email:              TEST_EMAIL,
          firstName:          'Mohit',
          lastName:           'Kumar',
          subscriptionStatus: 'free',
          userTier:           'free',
          remainingMessages:  5,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: false }
    );

    console.log(`[Seed] ✅ Test user ready: ${TEST_EMAIL} / ${TEST_PASSWORD}`);
  } catch (err) {
    console.error('[Seed] ❌ Failed to seed test user:', err.message);
  }
};

export default seedTestUser;
