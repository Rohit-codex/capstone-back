
export function extractPlaceholders(templateText) {
  const regex = /\{\{([a-z_][a-z0-9_]*)\}\}/gi;
  const matches = [];
  const keys = new Set();
  
  let match;
  while ((match = regex.exec(templateText)) !== null) {
    const key = match[1];
    if (!keys.has(key)) {
      keys.add(key);
      matches.push({
        key,
        fullMatch: match[0],
        position: match.index
      });
    }
  }
  
  return matches;
}

export function isPlaceholderValue(val) {
  if (!val || typeof val !== 'string') return false;
  
  const str = String(val).trim();
  
  
  if (str.length === 0) return true;
  
  
  if (/\(not provided\)/i.test(str)) return true;
  if (/\(enter .+?\)/i.test(str)) return true;
  if (/\(fill .+?\)/i.test(str)) return true;
  
  
  if (/s\/o\s*:\s*\(/i.test(str)) return true;
  if (/r\/o\s*:\s*\(/i.test(str)) return true;
  if (/d\/o\s*:\s*\(/i.test(str)) return true;
  if (/w\/o\s*:\s*\(/i.test(str)) return true;
  
  
  if (/…{2,}|\.{4,}|_{3,}/.test(str)) return true;
  
  
  if (/\{\{.+?\}\}/.test(str)) return true;
  
  
  if (/^(x|y|z|n\/a|na|tbd|xxx|pending)$/i.test(str)) return true;
  
  return false;
}

export function validateFieldValue(field, value) {
  const { key, type, required, label } = field;
  
  
  if (required && (value === undefined || value === null || value === '')) {
    return {
      valid: false,
      field: key,
      reason: `Required field "${label || key}" is missing`
    };
  }
  
  
  if (!value && !required) {
    return { valid: true };
  }
  
  
  if (isPlaceholderValue(value)) {
    return {
      valid: false,
      field: key,
      reason: `Field "${label || key}" appears to be unfilled (contains placeholder markers)`
    };
  }
  
  
  switch (type) {
    case 'email':
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return {
          valid: false,
          field: key,
          reason: `Field "${label || key}" must be a valid email address`
        };
      }
      break;
      
    case 'phone':
      
      const cleaned = String(value).replace(/[\s\-\(\)]/g, '');
      if (!/^(\+?91)?[6-9]\d{9}$/.test(cleaned)) {
        return {
          valid: false,
          field: key,
          reason: `Field "${label || key}" must be a valid Indian phone number`
        };
      }
      break;
      
    case 'number':
    case 'amount':
      if (isNaN(value) || value < 0) {
        return {
          valid: false,
          field: key,
          reason: `Field "${label || key}" must be a positive number`
        };
      }
      break;
      
    case 'date':
      
      const date = new Date(value);
      if (isNaN(date.getTime())) {
        return {
          valid: false,
          field: key,
          reason: `Field "${label || key}" must be a valid date`
        };
      }
      break;
      
    case 'array':
      if (!Array.isArray(value)) {
        return {
          valid: false,
          field: key,
          reason: `Field "${label || key}" must be an array/list`
        };
      }
      
      for (let i = 0; i < value.length; i++) {
        if (isPlaceholderValue(value[i])) {
          return {
            valid: false,
            field: key,
            reason: `Item ${i + 1} in "${label || key}" appears to be unfilled`
          };
        }
      }
      break;
      
    case 'text':
    case 'textarea':
    default:
      
      const minLength = key.includes('address') ? 10 : 
                       key.includes('description') ? 20 : 
                       2;
      
      if (String(value).trim().length < minLength) {
        return {
          valid: false,
          field: key,
          reason: `Field "${label || key}" is too short (minimum ${minLength} characters)`
        };
      }
      break;
  }
  
  return { valid: true };
}

export function validateTemplateData(templateText, userData = {}, templateSchema = []) {
  const errors = [];
  
  
  const placeholders = extractPlaceholders(templateText);
  
  if (placeholders.length === 0 && templateSchema.length === 0) {
    
    return {
      valid: true,
      warnings: ['Template contains no {{placeholders}}. This may be a static template.']
    };
  }
  
  
  const missingFields = [];
  const providedKeys = new Set(Object.keys(userData));
  
  for (const placeholder of placeholders) {
    if (!providedKeys.has(placeholder.key)) {
      missingFields.push(placeholder.key);
    }
  }
  
  if (missingFields.length > 0) {
    errors.push({
      type: 'missing_fields',
      message: `Missing data for ${missingFields.length} placeholder(s)`,
      fields: missingFields
    });
  }
  
  
  const schemaMap = {};
  for (const field of templateSchema) {
    schemaMap[field.key] = field;
  }
  
  for (const [key, value] of Object.entries(userData)) {
    const field = schemaMap[key];
    
    if (field) {
      const validation = validateFieldValue(field, value);
      if (!validation.valid) {
        errors.push({
          type: 'invalid_field',
          message: validation.reason,
          field: validation.field
        });
      }
    }
  }
  
  
  const templateKeys = new Set(placeholders.map(p => p.key));
  const orphanedFields = [];
  
  for (const key of providedKeys) {
    if (!templateKeys.has(key)) {
      orphanedFields.push(key);
    }
  }
  
  const warnings = [];
  if (orphanedFields.length > 0) {
    warnings.push(`${orphanedFields.length} field(s) provided but not used in template: ${orphanedFields.slice(0, 5).join(', ')}${orphanedFields.length > 5 ? '...' : ''}`);
  }
  
  
  const unfilledValues = [];
  for (const [key, value] of Object.entries(userData)) {
    if (isPlaceholderValue(value)) {
      unfilledValues.push(key);
    }
  }
  
  if (unfilledValues.length > 0) {
    errors.push({
      type: 'unfilled_values',
      message: `${unfilledValues.length} field(s) contain unfilled placeholder markers`,
      fields: unfilledValues
    });
  }
  
  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
    stats: {
      placeholders: placeholders.length,
      dataProvided: providedKeys.size,
      schemaFields: templateSchema.length,
      missingFields: missingFields.length,
      orphanedFields: orphanedFields.length
    }
  };
}

export function formatValidationErrors(validation) {
  if (validation.valid) {
    return 'All validations passed ✓';
  }
  
  const lines = ['❌ Template validation failed:\n'];
  
  for (const error of validation.errors || []) {
    switch (error.type) {
      case 'missing_fields':
        lines.push(`📋 Missing required fields (${error.fields.length}):`);
        for (const field of error.fields.slice(0, 10)) {
          lines.push(`   • ${field}`);
        }
        if (error.fields.length > 10) {
          lines.push(`   ... and ${error.fields.length - 10} more`);
        }
        break;
        
      case 'invalid_field':
        lines.push(`⚠️  ${error.message}`);
        break;
        
      case 'unfilled_values':
        lines.push(`🔍 Unfilled placeholders detected (${error.fields.length}):`);
        for (const field of error.fields.slice(0, 10)) {
          lines.push(`   • ${field}`);
        }
        if (error.fields.length > 10) {
          lines.push(`   ... and ${error.fields.length - 10} more`);
        }
        break;
        
      default:
        lines.push(`❓ ${error.message}`);
    }
    lines.push('');
  }
  
  if (validation.warnings && validation.warnings.length > 0) {
    lines.push('⚠️  Warnings:');
    for (const warning of validation.warnings) {
      lines.push(`   ${warning}`);
    }
  }
  
  return lines.join('\n');
}

export function canGenerate(templateText, userData, templateSchema) {
  const validation = validateTemplateData(templateText, userData, templateSchema);
  return validation.valid;
}

export default {
  extractPlaceholders,
  isPlaceholderValue,
  validateFieldValue,
  validateTemplateData,
  formatValidationErrors,
  canGenerate
};
