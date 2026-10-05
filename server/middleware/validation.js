import Joi from 'joi';
import { errorResponse } from '../utils/responseWrapper.js';

/**
 * Validation Middleware Factory
 * Creates middleware to validate request body, params, or query against a Joi schema
 * 
 * @param {Joi.Schema} schema - Joi validation schema
 * @param {string} property - Request property to validate ('body', 'params', 'query')
 */
export const validate = (schema, property = 'body') => {
    return (req, res, next) => {
        const { error, value } = schema.validate(req[property], {
            abortEarly: false, // return all errors
            stripUnknown: true // remove unknown fields
        });

        if (error) {
            const errors = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message
            }));

            return res.status(400).json(
                errorResponse('Validation failed', 400, errors)
            );
        }

        // Replace with validated value
        req[property] = value;
        next();
    };
};

/**
 * Common validation schemas
 */
export const schemas = {
    // Email validation
    email: Joi.string().email().trim().lowercase().required()
        .messages({
            'string.email': 'Please provide a valid email address',
            'any.required': 'Email is required'
        }),

    // Password validation (min 8 chars, at least one letter and one number)
    password: Joi.string().min(8).pattern(/^(?=.*[A-Za-z])(?=.*\d)/)
        .required()
        .messages({
            'string.min': 'Password must be at least 8 characters long',
            'string.pattern.base': 'Password must contain at least one letter and one number',
            'any.required': 'Password is required'
        }),

    // MongoDB ObjectId validation
    objectId: Joi.string().regex(/^[0-9a-fA-F]{24}$/)
        .messages({
            'string.pattern.base': 'Invalid ID format'
        }),

    // File upload validation
    fileId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required()
        .messages({
            'string.pattern.base': 'Invalid file ID format',
            'any.required': 'File ID is required'
        }),

    // Pagination
    pagination: {
        page: Joi.number().integer().min(1).default(1),
        limit: Joi.number().integer().min(1).max(100).default(20)
    },

    // OTP validation
    otp: Joi.string().length(6).pattern(/^\d+$/).required()
        .messages({
            'string.length': 'OTP must be 6 digits',
            'string.pattern.base': 'OTP must contain only numbers',
            'any.required': 'OTP is required'
        })
};

/**
 * Common validation schemas for endpoints
 */
export const validationSchemas = {
    // Auth endpoints
    login: Joi.object({
        email: schemas.email,
        password: Joi.string().required()
    }),

    signup: Joi.object({
        email: schemas.email,
        password: schemas.password,
        confirmPassword: Joi.string().valid(Joi.ref('password')).required()
            .messages({
                'any.only': 'Passwords must match',
                'any.required': 'Please confirm your password'
            }),
        firstName: Joi.string().min(2).max(50).required()
            .messages({
                'string.min': 'First name must be at least 2 characters',
                'string.max': 'First name cannot exceed 50 characters',
                'any.required': 'First name is required'
            }),
        lastName: Joi.string().min(2).max(50).required()
            .messages({
                'string.min': 'Last name must be at least 2 characters',
                'string.max': 'Last name cannot exceed 50 characters',
                'any.required': 'Last name is required'
            }),
        otp: schemas.otp
    }),

    checkEmail: Joi.object({
        email: schemas.email
    }),

    verifyOTP: Joi.object({
        email: schemas.email,
        otp: schemas.otp
    }),

    // File endpoints
    analyzeFile: Joi.object({
        question: Joi.string().min(1).max(1000).required()
            .messages({
                'string.min': 'Question cannot be empty',
                'string.max': 'Question is too long (max 1000 characters)',
                'any.required': 'Question is required'
            })
    }),

    // Profile endpoints
    updateProfile: Joi.object({
        firstName: Joi.string().min(2).max(50).optional(),
        lastName: Joi.string().min(2).max(50).optional()
    }).min(1), // At least one field must be provided

    // Chat endpoints
    sendMessage: Joi.object({
        message: Joi.string().min(1).max(5000).required()
            .messages({
                'string.min': 'Message cannot be empty',
                'string.max': 'Message is too long (max 5000 characters)',
                'any.required': 'Message is required'
            })
    })
};
