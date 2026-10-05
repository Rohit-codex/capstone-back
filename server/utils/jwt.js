import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key';

const isDev = process.env.NODE_ENV === 'development';
const ACCESS_TOKEN_EXPIRES = isDev ? '24h' : '20m';
const REFRESH_TOKEN_EXPIRES = isDev ? '30d' : '7d';

export const generateTokens = (user) => {
  const accessToken = jwt.sign(
    {
      id: user._id,
      email: user.email,
      subscriptionStatus: user.subscriptionStatus,
      isAdmin: user.isAdmin || false,
      displayName: user.displayName,
      type: 'access'
    },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES }
  );

  const refreshToken = jwt.sign(
    {
      id: user._id,
      type: 'refresh'
    },
    JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRES }
  );

  return { accessToken, refreshToken };
};

export const generateToken = (user) => {
  return generateTokens(user).accessToken;
};

export const verifyToken = (token) => {
  try {
    
    if (isDev) {
      return jwt.verify(token, JWT_SECRET, { ignoreExpiration: true });
    }
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    throw new Error('Invalid token');
  }
};

export const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET);
  } catch (error) {
    throw new Error('Invalid refresh token');
  }
};

export const decodeToken = (token) => {
  try {
    return jwt.decode(token);
  } catch (error) {
    throw new Error('Invalid token');
  }
};
