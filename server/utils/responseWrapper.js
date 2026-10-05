/**
 * Standard API Response Wrapper
 * Ensures all API responses follow a consistent format
 */

/**
 * Success response wrapper
 * @param {*} data - The data to return
 * @param {string} message - Optional success message
 * @param {number} statusCode - HTTP status code (default: 200)
 */
export const successResponse = (data, message = 'Success', statusCode = 200) => {
    return {
        success: true,
        statusCode,
        message,
        data,
        timestamp: new Date().toISOString()
    };
};

/**
 * Error response wrapper  
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code (default: 500)
 * @param {*} errors - Optional detailed error information
 */
export const errorResponse = (message, statusCode = 500, errors = null) => {
    const response = {
        success: false,
        statusCode,
        message,
        timestamp: new Date().toISOString()
    };

    if (errors) {
        response.errors = errors;
    }

    return response;
};

/**
 * Pagination metadata
 * @param {number} page - Current page
 * @param {number} limit - Items per page
 * @param {number} total - Total items
 */
export const paginationMeta = (page, limit, total) => {
    return {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1
    };
};

/**
 * Paginated response wrapper
 */
export const paginatedResponse = (data, page, limit, total, message = 'Success') => {
    return {
        success: true,
        statusCode: 200,
        message,
        data,
        pagination: paginationMeta(page, limit, total),
        timestamp: new Date().toISOString()
    };
};
