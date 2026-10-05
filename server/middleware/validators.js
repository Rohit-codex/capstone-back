import Joi from 'joi';

export const validateRequest = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true
  });

  if (error) {
    const messages = error.details.map(detail => detail.message);
    return res.status(400).json({
      success: false,
      error: 'Validation error',
      details: messages
    });
  }

  req.body = value;
  next();
};

export const schemas = {
  chat: {
    sendMessage: Joi.object({
      message: Joi.string().required().min(1).max(5000),
      fileId: Joi.string().optional().allow(null, ''),
      language: Joi.string().valid('en', 'hi').optional().allow(null, ''),
      intentOverride: Joi.string().optional().allow(null, ''),
      templatePath: Joi.string().optional().allow(null, '')
    })
  },
  auth: {
    signup: Joi.object({
      firstName: Joi.string().required().min(2),
      lastName: Joi.string().required().min(2),
      email: Joi.string().email().required(),
      password: Joi.string().required().min(6),
      confirmPassword: Joi.string().required().min(6),
      otp: Joi.string().required()
    }),
    login: Joi.object({
      email: Joi.string().email().required(),
      password: Joi.string().required()
    }),
    checkEmail: Joi.object({
      email: Joi.string().email().required()
    }),
    refresh: Joi.object({
      refreshToken: Joi.string().required()
    }),
    verify2fa: Joi.object({
      email: Joi.string().email().required(),
      otp: Joi.string().required()
    })
  },
  profile: {
    update: Joi.object({
      firstName: Joi.string().min(2).optional(),
      lastName: Joi.string().min(2).optional(),
      email: Joi.string().email().optional(),
      newEmail: Joi.string().email().optional()
    })
  },
  subscription: {
    verifyPayment: Joi.object({
      razorpay_order_id: Joi.string().required(),
      razorpay_payment_id: Joi.string().required(),
      razorpay_signature: Joi.string().required()
    })
  }
};
