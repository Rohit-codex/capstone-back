import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { getRemainingMessages } from '../models/SubscriptionPrice.js';
import { hashPassword, comparePassword } from '../utils/password.js';
import { generateOTP } from '../utils/otp.js';
import { sendEmail } from '../utils/email.js';
import redis from '../utils/redisClient.js';
import { AppError } from '../utils/errors.js';
import { OAuth2Client } from 'google-auth-library';
import { generateTokens, verifyToken, verifyRefreshToken } from '../utils/jwt.js';
import { generateCsrfToken } from '../utils/csrfToken.js';

export const checkEmail = async (req, res) => {
  try {
    const { email } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) throw new AppError('Email is required', 400);
    const user = await User.findOne({ email: normalizedEmail }).select('+password');

    if (user) {
      return res.json({ exists: true });
    }

    const otp = generateOTP();
    console.log(otp);
    
    await sendEmail(
      normalizedEmail,
      'Your OTP for Dastavez AI Signup',
      `Your OTP is: ${otp}. This OTP will expire in 10 minutes.`,
      `
        <div style=\"font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;\">
          <h2>Your Dastavez AI Verification Code</h2>
          <p>Your OTP is: <strong>${otp}</strong></p>
          <p>This OTP will expire in 10 minutes.</p>
          <p>If you didn't request this code, please ignore this email.</p>
        </div>
      `
    );

    
    await redis.set(`otp:${normalizedEmail}`, otp, 'EX', 600);

    res.json({ exists: false, message: 'OTP sent successfully' });
  } catch (error) {
    throw new AppError(error?.message || 'Error processing request', 500);
  }
};

export const signup = async (req, res) => {
  try {
    const { firstName, lastName, password, confirmPassword, otp, email } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    
    const storedOTP = await redis.get(`otp:${normalizedEmail}`);
    if (!storedOTP || otp !== storedOTP) {
      throw new AppError('Invalid or expired OTP', 400);
    }

    if (password !== confirmPassword) {
      throw new AppError('Passwords do not match', 400);
    }

    const hashedPassword = await hashPassword(password);

    const user = new User({
      email: normalizedEmail,
      firstName,
      lastName,
      password: hashedPassword,
      isVerified: true,
      subscriptionStatus: 'free'
    });

    await user.save();

    const { accessToken, refreshToken } = generateTokens({
      _id: user._id,
      email: user.email,
      subscriptionStatus: 'free',
      isAdmin: user.isAdmin || false
    });
    const csrfToken = await generateCsrfToken(user._id);

    
    await redis.del(`otp:${normalizedEmail}`);

    res.json({
      token: accessToken,
      refreshToken,
      csrfToken,
      user: { email: normalizedEmail, firstName, lastName, subscriptionStatus: 'free', twoFactorEnabled: user.twoFactorEnabled }
    });
  } catch (error) {
    throw new AppError(error?.message || 'Error creating account', 500);
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    
    if (!email || !password) {
      throw new AppError('Email and password are required', 400);
    }
    
    const normalizedEmail = String(email).trim().toLowerCase();
    const ip = req.ip;
    
    
    const attempts = await redis.incr(`login:attempts:${ip}`);
    if (attempts === 1) await redis.expire(`login:attempts:${ip}`, 60);
    if (attempts > 5) {
      throw new AppError('Too many login attempts. Please try again later.', 429);
    }

    const user = await User.findOne({ email: normalizedEmail }).select('+password');
    if (!user) {
      throw new AppError('Invalid email or password', 401);
    }

    
    console.log('Login attempt:', { 
      email: normalizedEmail, 
      hasPassword: !!password, 
      hasUserPassword: !!user.password,
      passwordType: typeof password,
      userPasswordType: typeof user.password
    });

    const isPasswordValid = await comparePassword(password, user.password);
    if (!isPasswordValid) {
      throw new AppError('Invalid email or password', 401);
    }

    
    await redis.del(`login:attempts:${ip}`);

    
    user.lastLogin = new Date();
    await user.save();

    if (user.twoFactorEnabled) {
      const otp = generateOTP();
      await redis.set(`2fa:${user._id}`, otp, 'EX', 300);
      await sendEmail(
        normalizedEmail,
        'Your Dastavez AI Login OTP',
        `Your OTP is: ${otp}. This OTP will expire in 5 minutes.`,
        `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Your Dastavez AI Login OTP</h2>
            <p>Your OTP is: <strong>${otp}</strong></p>
            <p>This OTP will expire in 5 minutes.</p>
          </div>
        `
      );
      return res.json({
        requiresTwoFactor: true,
        email: normalizedEmail,
        message: 'OTP sent to your email'
      });
    }

    const { accessToken, refreshToken } = generateTokens({
      _id: user._id,
      email: user.email,
      subscriptionStatus: user.subscriptionStatus,
      isAdmin: user.isAdmin || false
    });
    const csrfToken = await generateCsrfToken(user._id);

    res.json({ 
      token: accessToken,
      refreshToken,
      csrfToken,
      user: { 
        email: normalizedEmail, 
        firstName: user.firstName, 
        lastName: user.lastName,
        subscriptionStatus: user.subscriptionStatus,
        remainingMessages: await getRemainingMessages(user._id, user.subscriptionStatus),
        twoFactorEnabled: user.twoFactorEnabled
      } 
    });
  } catch (error) {
    console.error('Login error:', error);
    throw new AppError(error?.message || 'Error logging in', 500);
  }
};

export const verifyTwoFactor = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      throw new AppError('Email and OTP are required', 400);
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      throw new AppError('User not found', 404);
    }

    const storedOtp = await redis.get(`2fa:${user._id}`);
    if (!storedOtp || storedOtp !== otp) {
      throw new AppError('Invalid or expired OTP', 400);
    }

    await redis.del(`2fa:${user._id}`);

    const { accessToken, refreshToken } = generateTokens({
      _id: user._id,
      email: user.email,
      subscriptionStatus: user.subscriptionStatus,
      isAdmin: user.isAdmin || false
    });
    const csrfToken = await generateCsrfToken(user._id);

    res.json({
      token: accessToken,
      refreshToken,
      csrfToken,
      user: {
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        subscriptionStatus: user.subscriptionStatus,
        remainingMessages: await getRemainingMessages(user._id, user.subscriptionStatus),
        twoFactorEnabled: user.twoFactorEnabled
      }
    });
  } catch (error) {
    throw new AppError(error?.message || 'OTP verification failed', 400);
  }
};

export const refreshAccessToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) throw new AppError('Refresh token required', 400);

    const decoded = verifyRefreshToken(refreshToken);
    const user = await User.findById(decoded.id);
    if (!user) throw new AppError('User not found', 404);

    const { accessToken } = generateTokens({
      _id: user._id,
      email: user.email,
      subscriptionStatus: user.subscriptionStatus,
      isAdmin: user.isAdmin || false
    });

    res.json({ accessToken, expiresIn: '20m' });
  } catch (error) {
    throw new AppError(error?.message || 'Invalid refresh token', 401);
  }
};

export const toggleTwoFactor = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError('Unauthorized', 401);

    const user = await User.findById(userId);
    if (!user) throw new AppError('User not found', 404);

    user.twoFactorEnabled = !user.twoFactorEnabled;
    await user.save();

    res.json({ success: true, twoFactorEnabled: user.twoFactorEnabled });
  } catch (error) {
    throw new AppError(error?.message || 'Failed to update 2FA', 500);
  }
};

export const getCurrentUser = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      throw new AppError('No token provided', 401);
    }

    const decoded = verifyToken(token);
    const user = await User.findById(decoded.id).select('-password -__v').lean();
    
    if (!user) {
      throw new AppError('User not found', 404);
    }

    const remainingMessages = await getRemainingMessages(user._id, user.subscriptionStatus);
    res.json({
      ...user,
      remainingMessages
    });
  } catch (error) {
    throw new AppError(error?.message || 'Invalid token', 401);
  }
};

export const logout = (req, res) => {
  res.json({ message: 'Logged out successfully' });
}; 


export const forgotPasswordRequest = async (req, res) => {
  try {
    const { email } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      
      return res.json({ message: 'If this email exists, an OTP has been sent.' });
    }
    const otp = generateOTP();
    console.log(otp);
    await redis.set(`resetotp:${normalizedEmail}`, otp, 'EX', 600);
    await sendEmail(
      normalizedEmail,
      'Your OTP for Password Reset',
      `Your OTP is: ${otp}. This OTP will expire in 10 minutes.`,
      `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Password Reset Verification</h2>
        <p>Your OTP is: <strong>${otp}</strong></p>
        <p>This OTP will expire in 10 minutes.</p>
        <p>If you didn't request this, please ignore this email.</p>
      </div>`
    );
    res.json({ message: 'If this email exists, an OTP has been sent.' });
  } catch (error) {
    throw new AppError(error?.message || 'Error processing request', 500);
  }
};


export const verifyResetOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const storedOTP = await redis.get(`resetotp:${normalizedEmail}`);
    if (!storedOTP || otp !== storedOTP) {
      throw new AppError('Invalid or expired OTP', 400);
    }
    res.json({ message: 'OTP verified. You may now reset your password.' });
  } catch (error) {
    throw new AppError(error?.message || 'Error verifying OTP', 400);
  }
};


export const resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword, confirmPassword } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const storedOTP = await redis.get(`resetotp:${normalizedEmail}`);
    if (!storedOTP || otp !== storedOTP) {
      throw new AppError('Invalid or expired OTP', 400);
    }
    if (newPassword !== confirmPassword) {
      throw new AppError('Passwords do not match', 400);
    }
    const hashedPassword = await hashPassword(newPassword);
    await User.findOneAndUpdate({ email: normalizedEmail }, { password: hashedPassword });
    await redis.del(`resetotp:${normalizedEmail}`);
    res.json({ message: 'Password has been reset successfully.' });
  } catch (error) {
    throw new AppError(error?.message || 'Error resetting password', 500);
  }
}; 


const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
export const googleAuth = async (req, res) => {
  try {
    const { idToken } = req.body || {};
    if (!idToken) throw new AppError('Missing idToken', 400);

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload) throw new AppError('Invalid Google token', 401);

    const googleId = payload.sub;
    const email = String(payload.email || '').trim().toLowerCase();
    const firstName = payload.given_name || 'User';
    const lastName = payload.family_name || '';

    if (!email) throw new AppError('Google account has no verified email', 400);

    let user = await User.findOne({ $or: [{ googleId }, { email }] });
    if (!user) {
      user = await User.create({
        email,
        googleId,
        firstName,
        lastName,
        isVerified: true,
        subscriptionStatus: 'free',
      });
    } else {
      if (!user.googleId) {
        user.googleId = googleId;
      }
      if (!user.isVerified) user.isVerified = true;
      await user.save();
    }

    const { accessToken, refreshToken } = generateTokens({
      _id: user._id,
      email: user.email,
      subscriptionStatus: user.subscriptionStatus,
      isAdmin: user.isAdmin || false
    });
    const csrfToken = await generateCsrfToken(user._id);

    res.json({
      token: accessToken,
      refreshToken,
      csrfToken,
      user: {
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        subscriptionStatus: user.subscriptionStatus,
        remainingMessages: await getRemainingMessages(user._id, user.subscriptionStatus),
        twoFactorEnabled: user.twoFactorEnabled
      },
    });
  } catch (error) {
    throw new AppError(error?.message || 'Google authentication failed', 401);
  }
};