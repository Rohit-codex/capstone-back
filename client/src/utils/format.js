/**
 * Format a number as Indian Rupees (INR)
 * @param {number} amount - The amount to format
 * @returns {string} The formatted amount with ₹ symbol
 */
export const formatCurrency = (amount) => {
  if (typeof amount !== 'number') {
    return '₹0';
  }
  
  // Format with 2 decimal places and add ₹ symbol
  return `₹${amount.toFixed(2)}`;
};

/**
 * Format a number with commas for thousands
 * @param {number} number - The number to format
 * @returns {string} The formatted number with commas
 */
export const formatNumber = (number) => {
  if (typeof number !== 'number') {
    return '0';
  }
  
  return number.toLocaleString('en-IN');
}; 