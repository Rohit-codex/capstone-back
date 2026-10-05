import Razorpay from 'razorpay';
import { AppError } from './errors.js';
import redis from './redisClient.js';

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});


const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;


const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));


export const createOrderWithRetry = async (amount, currency = 'INR', retries = 0) => {
  try {
    const options = {
      amount: amount * 100,
      currency,
      receipt: `receipt_${Date.now()}`,
    };

    const order = await razorpay.orders.create(options);
    return order;
  } catch (error) {
    if (retries < MAX_RETRIES) {
      await delay(RETRY_DELAY * (retries + 1));
      return createOrderWithRetry(amount, currency, retries + 1);
    }
    throw new AppError('Payment gateway timeout. Please try again.', 503);
  }
};


export const verifyPaymentWithRetry = async (paymentId, orderId, signature, retries = 0) => {
  try {
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    if (generatedSignature !== signature) {
      throw new AppError('Invalid payment signature', 400);
    }

    
    await redis.set(
      `payment:${paymentId}`,
      JSON.stringify({ verified: true, timestamp: Date.now() }),
      'EX',
      3600
    );

    return true;
  } catch (error) {
    if (retries < MAX_RETRIES) {
      await delay(RETRY_DELAY * (retries + 1));
      return verifyPaymentWithRetry(paymentId, orderId, signature, retries + 1);
    }
    throw new AppError('Payment verification failed. Please contact support.', 503);
  }
};


export const handleFailedPayment = async (orderId, error) => {
  try {
    
    await PaymentLog.create({
      orderId,
      status: 'failed',
      error: error.message,
      timestamp: new Date()
    });

    
    

    return true;
  } catch (error) {
    console.error('Error handling failed payment:', error);
    return false;
  }
}; 