import User from '../models/User.js';
import { generateOTP, otpStore, verifyOTP } from '../utils/otp.js';
import { sendEmail } from '../utils/email.js';
import { hashPassword, comparePassword } from '../utils/password.js';
import { uploadToCloudinaryWithRetry, deleteFromCloudinaryWithRetry } from '../utils/fileHandler.js';
import { AppError } from '../utils/errors.js';

export const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -otp').lean();
    if (!user) {
      throw new AppError('User not found', 404);
    }
    res.json(user);
  } catch (error) {
    throw new AppError(error.message || 'Error retrieving profile', 500);
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { firstName, lastName } = req.body;
    const user = await User.findById(req.user.id).lean();
    if (!user) {
      throw new AppError('User not found', 404);
    }
    await User.findByIdAndUpdate(req.user.id, {
      firstName: firstName || user.firstName,
      lastName: lastName || user.lastName
    });
    const updatedUser = await User.findById(req.user.id).select('-password -otp').lean();
    res.json({ message: 'Profile updated successfully', user: updatedUser });
  } catch (error) {
    throw new AppError(error.message || 'Error updating profile', 500);
  }
};

export const uploadProfileImage = async (req, res) => {
  try {
    if (!req.file) {
      throw new AppError('No image file provided', 400);
    }

    
    if (!req.file.mimetype.startsWith('image/')) {
      throw new AppError('Only image files are allowed', 400);
    }

    const user = await User.findById(req.user.id).lean();
    if (!user) {
      throw new AppError('User not found', 404);
    }

    
    const cloudinaryResult = await uploadToCloudinaryWithRetry(req.file, 'profile-images');

    
    if (user.profileImage && user.profileImagePublicId) {
      try {
        await deleteFromCloudinaryWithRetry(user.profileImagePublicId);
      } catch (error) {
        console.error('Error deleting old image:', error);
        
      }
    }

    
    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      {
        profileImage: cloudinaryResult.secure_url,
        profileImagePublicId: cloudinaryResult.public_id
      },
      { new: true }
    ).select('-password -otp').lean();

    res.json({ 
      message: 'Profile image updated successfully',
      imageUrl: updatedUser.profileImage
    });
  } catch (error) {
    console.error('Profile image upload error:', error);
    throw new AppError(error.message || 'Error uploading profile image', 500);
  }
};

export const initiateEmailChange = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      throw new AppError('User not found', 404);
    }
    const otp = generateOTP();
    otpStore.set(`email-current-${user.id}`, {
      otp,
      timestamp: Date.now(),
      email: user.email
    });
    await sendEmail(
      user.email,
      'Verify Email Change',
      `Your OTP for email change verification is: ${otp}`
    );
    res.json({ message: 'OTP sent to current email' });
  } catch (error) {
    throw new AppError(error.message || 'Error initiating email change', 500);
  }
};

export const verifyCurrentEmail = async (req, res) => {
  try {
    const { otp } = req.body;
    const result = verifyOTP(req.user.id, otp, 'email-current');
    if (!result.valid) {
      throw new AppError(result.message, 400);
    }
    res.json({ message: 'Current email verified' });
  } catch (error) {
    throw new AppError(error.message || 'Error verifying current email', 500);
  }
};

export const initiateNewEmail = async (req, res) => {
  try {
    const { newEmail } = req.body;
    const existingUser = await User.findOne({ email: newEmail });
    if (existingUser) {
      throw new AppError('Email already in use', 400);
    }
    const currentEmailVerified = otpStore.get(`email-current-${req.user.id}`);
    if (!currentEmailVerified) {
      throw new AppError('Please verify your current email first', 400);
    }
    const otp = generateOTP();
    otpStore.set(`email-new-${req.user.id}`, {
      otp,
      timestamp: Date.now(),
      email: newEmail
    });
    await sendEmail(
      newEmail,
      'Verify New Email',
      `Your OTP to verify your new email is: ${otp}`
    );
    res.json({ message: 'OTP sent to new email' });
  } catch (error) {
    throw new AppError(error.message || 'Error initiating new email verification', 500);
  }
};

export const completeEmailChange = async (req, res) => {
  try {
    const { otp } = req.body;
    const result = verifyOTP(req.user.id, otp, 'email-new');
    if (!result.valid) {
      throw new AppError(result.message, 400);
    }
    const user = await User.findById(req.user.id);
    user.email = result.data.email;
    await user.save();
    otpStore.delete(`email-current-${req.user.id}`);
    otpStore.delete(`email-new-${req.user.id}`);
    res.json({ message: 'Email updated successfully', email: user.email });
  } catch (error) {
    throw new AppError(error.message || 'Error completing email change', 500);
  }
};

export const initiatePasswordChange = async (req, res) => {
  try {
    const { currentPassword } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) {
      throw new AppError('User not found', 404);
    }
    const isMatch = await comparePassword(currentPassword, user.password);
    if (!isMatch) {
      throw new AppError('Current password is incorrect', 401);
    }
    const otp = generateOTP();
    console.log(otp);
    user.otp = { code: otp, expiresAt: new Date(Date.now() + 10 * 60 * 1000) };
    await user.save();

    await sendEmail(
      user.email,
      'Password Change Verification',
      `Your OTP for password change is: ${otp}. This OTP will expire in 10 minutes.`,
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Password Change Verification</h2>
          <p>Your OTP is: <strong>${otp}</strong></p>
          <p>This OTP will expire in 10 minutes.</p>
          <p>If you didn't request this change, please secure your account immediately.</p>
        </div>
      `
    );

    res.json({ message: 'OTP sent to your email' });
  } catch (error) {
    throw new AppError(error.message || 'Error initiating password change', 500);
  }
};

export const completePasswordChange = async (req, res) => {
  try {
    const { otp, newPassword, confirmPassword } = req.body;
    const user = await User.findById(req.user.id).lean();
    if (!user) {
      throw new AppError('User not found', 404);
    }

    if (!user.otp || user.otp.code !== otp) {
      throw new AppError('Invalid OTP', 400);
    }
    if (user.otp.expiresAt && user.otp.expiresAt < new Date()) {
      throw new AppError('OTP has expired', 400);
    }

    if (newPassword !== confirmPassword) {
      throw new AppError('Passwords do not match', 400);
    }

    const hashedPassword = await hashPassword(newPassword);
    await User.findByIdAndUpdate(req.user.id, {
      password: hashedPassword,
      otp: undefined
    });

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    throw new AppError(error.message || 'Error changing password', 500);
  }
};

export const resendPasswordOTP = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).lean();
    if (!user) {
      throw new AppError('User not found', 404);
    }

    const otp = generateOTP();
    console.log(otp);
    otpStore.set(`password-${user.id}`, {
      otp,
      timestamp: Date.now()
    });

    await sendEmail(
      user.email,
      'Password Change Verification',
      `Your new OTP for password change verification is: ${otp}`
    );

    res.json({ message: 'New OTP sent successfully' });
  } catch (error) {
    throw new AppError(error.message || 'Error resending password OTP', 500);
  }
};

export const resendCurrentEmailOTP = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).lean();
    if (!user) {
      throw new AppError('User not found', 404);
    }

    const otp = generateOTP();
    console.log(otp);
    otpStore.set(`email-current-${user.id}`, {
      otp,
      timestamp: Date.now(),
      email: user.email
    });

    await sendEmail(
      user.email,
      'Verify Email Change',
      `Your new OTP for email change verification is: ${otp}`
    );

    res.json({ message: 'New OTP sent to current email' });
  } catch (error) {
    throw new AppError(error.message || 'Error resending current email OTP', 500);
  }
};

export const resendNewEmailOTP = async (req, res) => {
  try {
    const stored = otpStore.get(`email-new-${req.user.id}`);
    
    if (!stored) {
      throw new AppError('No new email verification in progress', 400);
    }

    const otp = generateOTP();
    console.log(otp);
    otpStore.set(`email-new-${req.user.id}`, {
      otp,
      timestamp: Date.now(),
      email: stored.email
    });

    await sendEmail(
      stored.email,
      'Verify New Email',
      `Your new OTP to verify your new email is: ${otp}`
    );

    res.json({ message: 'New OTP sent to new email' });
  } catch (error) {
    throw new AppError(error.message || 'Error resending new email OTP', 500);
  }
};

export const getPreferences = async (req, res) => {
  const user = await User.findById(req.user.id).select('preferences').lean();
  if (!user) throw new AppError('User not found', 404);
  res.json(user.preferences || {
    language: 'en',
    aiResponseLanguage: 'auto',
    defaultCourt: '',
    editorFontSize: 14,
    theme: 'system',
  });
};

export const updatePreferences = async (req, res) => {
  const allowed = ['language', 'aiResponseLanguage', 'defaultCourt', 'editorFontSize', 'theme', 'autoSaveInterval', 'defaultJurisdiction', 'scanDepth', 'showLineNumbers'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updates[`preferences.${key}`] = req.body[key];
    }
  }
  if (Object.keys(updates).length === 0) {
    throw new AppError('No valid preference fields provided', 400);
  }
  const user = await User.findByIdAndUpdate(req.user.id, { $set: updates }, { new: true, runValidators: true }).select('preferences');
  if (!user) throw new AppError('User not found', 404);
  res.json(user.preferences);
};

export const setupCompany = async (req, res) => {
  try {
    const { companyName, sector } = req.body;
    if (!companyName || !companyName.trim()) {
      throw new AppError('Company name is required', 400);
    }
    if (!sector || !sector.trim()) {
      throw new AppError('Sector is required', 400);
    }

    // Generate unique short slug
    // Format: lowercase, alphanumeric characters only (super short)
    let baseSlug = companyName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]/g, '')
      .substring(0, 5); // 5 characters target length

    if (!baseSlug) {
      baseSlug = 'comp';
    }

    let finalSlug = baseSlug;
    let counter = 1;
    let isUnique = false;
    
    while (!isUnique) {
      const existingUser = await User.findOne({ companySlug: finalSlug });
      if (!existingUser) {
        isUnique = true;
      } else {
        const suffix = String(counter);
        const maxBaseLength = Math.max(2, 5 - suffix.length);
        finalSlug = baseSlug.substring(0, maxBaseLength) + suffix;
        counter++;
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      {
        companyName: companyName.trim(),
        sector: sector.trim(),
        companySlug: finalSlug
      },
      { new: true }
    ).select('-password -otp').lean();

    res.json({
      message: 'Company setup successful',
      user: updatedUser
    });
  } catch (error) {
    throw new AppError(error.message || 'Error configuring company details', 500);
  }
};