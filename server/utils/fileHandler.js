import { v2 as cloudinary } from 'cloudinary';
import { AppError } from './errors.js';
import File from '../models/File.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


const LOCAL_UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'files');


if (!fs.existsSync(LOCAL_UPLOADS_DIR)) {
  fs.mkdirSync(LOCAL_UPLOADS_DIR, { recursive: true });
}


const CLOUDINARY_DISABLED = process.env.CLOUDINARY_DISABLE === 'true';


if (!CLOUDINARY_DISABLED) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
}


const MAX_FILE_SIZE = 10 * 1024 * 1024;


const ALLOWED_FILE_TYPES = {
  'application/pdf': true,
  'application/msword': true,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
  'text/plain': true,
  'text/csv': true,
  'application/json': true,
  'application/rtf': true,
  'text/rtf': true,
  'text/richtext': true,
  'application/x-rtf': true
};


export const validateFile = (file) => {
  if (!file) {
    throw new AppError('No file provided', 400);
  }

  console.log('📋 Validating file:', {
    originalname: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
    encoding: file.encoding
  });

  if (file.size > MAX_FILE_SIZE) {
    throw new AppError(`File size exceeds 10MB limit (received: ${(file.size / 1024 / 1024).toFixed(2)}MB)`, 400);
  }

  
  const allowedTypes = [
    ...Object.keys(ALLOWED_FILE_TYPES),
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];

  if (!allowedTypes.includes(file.mimetype) && !ALLOWED_FILE_TYPES[file.mimetype]) {
    
    const ext = '.' + (file.originalname.split('.').pop() || '').toLowerCase();
    const allowedExtensions = ['.pdf', '.txt', '.md', '.csv', '.json', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.rtf'];
    
    if (!allowedExtensions.includes(ext)) {
      const supportedFormats = 'PDF, Word (.doc/.docx), Excel (.xls/.xlsx), Text (.txt), RTF (.rtf), Markdown, CSV, JSON, Images (JPG/PNG/GIF/WebP)';
      throw new AppError(
        `File type "${file.mimetype}" is not allowed. Supported: ${supportedFormats}`,
        400
      );
    }
  }

  console.log('✅ File validation passed');
  return true;
};


const saveFileLocally = async (file) => {
  const uniqueId = crypto.randomBytes(8).toString('hex');
  const ext = path.extname(file.originalname) || '';
  const safeFilename = `${uniqueId}_${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
  const filePath = path.join(LOCAL_UPLOADS_DIR, safeFilename);
  
  
  fs.writeFileSync(filePath, file.buffer);
  
  
  return {
    secure_url: `/uploads/files/${safeFilename}`,
    public_id: `local_${uniqueId}`,
    localPath: filePath
  };
};


const deleteFileLocally = async (publicId) => {
  try {
    
    const files = fs.readdirSync(LOCAL_UPLOADS_DIR);
    const idPart = publicId.replace('local_', '');
    const targetFile = files.find(f => f.startsWith(idPart));
    
    if (targetFile) {
      fs.unlinkSync(path.join(LOCAL_UPLOADS_DIR, targetFile));
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error deleting local file:', error);
    return false;
  }
};


export const uploadToCloudinaryWithRetry = async (fileOrBase64, folder = 'chat-files', retries = 0) => {
  
  if (CLOUDINARY_DISABLED) {
    console.log('📁 Cloudinary disabled - saving file locally');
    if (typeof fileOrBase64 === 'object' && fileOrBase64.buffer) {
      return await saveFileLocally(fileOrBase64);
    }
    throw new AppError('Local storage requires file object with buffer', 400);
  }

  try {
    let base64File;
    
    
    if (typeof fileOrBase64 === 'string') {
      base64File = fileOrBase64;
    } else if (fileOrBase64.buffer) {
      base64File = `data:${fileOrBase64.mimetype};base64,${fileOrBase64.buffer.toString('base64')}`;
    } else {
      throw new AppError('Invalid file format', 400);
    }

    // Use 'raw' for documents/PDFs so they are publicly fetchable
    // Use 'image' for image files, 'auto' only as last resort
    let resourceType = 'raw';
    if (typeof fileOrBase64 === 'object' && fileOrBase64.mimetype) {
      if (fileOrBase64.mimetype.startsWith('image/')) resourceType = 'image';
    } else if (typeof fileOrBase64 === 'string' && fileOrBase64.startsWith('data:image/')) {
      resourceType = 'image';
    }

    const result = await cloudinary.uploader.upload(base64File, {
      folder,
      resource_type: resourceType
    });
    return result;
  } catch (error) {
    if (retries < 3) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (retries + 1)));
      return uploadToCloudinaryWithRetry(fileOrBase64, folder, retries + 1);
    }
    throw new AppError('Failed to upload file. Please try again.', 503);
  }
};


export const deleteFromCloudinaryWithRetry = async (publicId, retries = 0) => {
  
  if (CLOUDINARY_DISABLED) {
    return await deleteFileLocally(publicId);
  }

  try {
    await cloudinary.uploader.destroy(publicId);
    return true;
  } catch (error) {
    if (retries < 3) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (retries + 1)));
      return deleteFromCloudinaryWithRetry(publicId, retries + 1);
    }
    console.error('Failed to delete file from Cloudinary:', error);
    return false;
  }
};


export const cleanupOrphanedFiles = async () => {
  try {
    
    const orphanedFiles = await File.find({
      createdAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      'chatId': { $exists: false }
    });

    for (const file of orphanedFiles) {
      try {
        
        await deleteFromCloudinaryWithRetry(file.publicId);
        
        await file.deleteOne();
      } catch (error) {
        console.error(`Failed to cleanup file ${file._id}:`, error);
      }
    }

    return orphanedFiles.length;
  } catch (error) {
    console.error('Error in cleanupOrphanedFiles:', error);
    return 0;
  }
};


export const scheduleCleanup = () => {
  
  setInterval(async () => {
    const count = await cleanupOrphanedFiles();
    console.log(`Cleaned up ${count} orphaned files`);
  }, 24 * 60 * 60 * 1000);
};

// Fetch raw file buffer from Cloudinary using SDK (handles auth, signed URLs, resource_type detection)
export const getCloudinaryBuffer = async (file) => {
  // Detect resource_type from stored URL or file type
  let resourceType = 'raw';
  if (file.fileUrl) {
    if (file.fileUrl.includes('/image/upload/')) resourceType = 'image';
    else if (file.fileUrl.includes('/video/upload/')) resourceType = 'video';
    else if (file.fileUrl.includes('/raw/upload/')) resourceType = 'raw';
  }
  // If it looks like an image mimetype, use image
  if (file.fileType?.startsWith('image/')) resourceType = 'image';

  // Generate a signed delivery URL using the Cloudinary SDK
  const signedUrl = cloudinary.url(file.publicId, {
    resource_type: resourceType,
    type: 'upload',
    sign_url: true,
    secure: true,
  });

  const { default: axiosLib } = await import('axios');
  const response = await axiosLib.get(signedUrl, {
    responseType: 'arraybuffer',
    timeout: 30000,
    headers: { 'User-Agent': 'DastavezaiServer/1.0' }
  });
  return Buffer.from(response.data);
}; 