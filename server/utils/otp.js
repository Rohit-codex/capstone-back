
export const otpStore = new Map();


export const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};


export const verifyOTP = (userId, otp, type) => {
  const stored = otpStore.get(`${type}-${userId}`);
  
  if (!stored) {
    return { valid: false, message: 'No OTP found. Please request a new one.' };
  }

  if (stored.otp !== otp) {
    return { valid: false, message: 'Invalid OTP' };
  }

  if (Date.now() - stored.timestamp > 600000) {
    otpStore.delete(`${type}-${userId}`);
    return { valid: false, message: 'OTP has expired. Please request a new one.' };
  }

  return { valid: true, data: stored };
}; 