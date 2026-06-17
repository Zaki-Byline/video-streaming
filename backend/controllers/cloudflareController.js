import pool from '../config/database.js';
import config from '../config/config.js';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { generateVideoId } from '../utils/videoIdGenerator.js';
import { ensureDirectoryExists, getFileSize } from '../utils/fileUtils.js';
import * as videoService from '../services/videoService.js';
import * as redirectService from '../services/redirectService.js';
import * as qrCodeService from '../services/qrCodeService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get all My Storage resources
 * Automatically converts mock Cloudflare URLs to localhost streaming URLs
 */
export async function getMyStorageResources(req, res) {
  try {
    const [resources] = await pool.execute(
      'SELECT * FROM cloudflare_resources ORDER BY created_at DESC'
    );
    
    // Verify files exist in my-storage and filter out orphaned database entries
    const backendDir = path.dirname(__dirname);
    const basePath = path.dirname(backendDir);
    let uploadPath = path.isAbsolute(config.upload.uploadPath) 
      ? config.upload.uploadPath 
      : path.resolve(basePath, config.upload.uploadPath);
    
    // Try multiple possible paths for my-storage folder
    const possibleMyStoragePaths = [
      path.join(uploadPath, 'my-storage'),
      path.join(basePath, 'video-storage', 'my-storage'),
      path.join(basePath, 'my-storage'),
      path.join(basePath, 'video-storage', 'video-storage', 'my-storage'),
    ];
    
    // Find the my-storage folder
    let myStoragePath = null;
    for (const tryPath of possibleMyStoragePaths) {
      if (fsSync.existsSync(tryPath)) {
        myStoragePath = tryPath;
        console.log(`[My Storage] Found my-storage folder at: ${myStoragePath}`);
        break;
      }
    }
    
    if (!myStoragePath) {
      console.error('[My Storage] WARNING: my-storage folder not found in any of these paths:', possibleMyStoragePaths);
    } else {
      // List all files in my-storage for debugging
      try {
        const allFiles = fsSync.readdirSync(myStoragePath);
        const videoFiles = allFiles.filter(f => 
          f.endsWith('.mp4') || f.endsWith('.mov') || f.endsWith('.webm')
        );
        console.log(`[My Storage] Found ${videoFiles.length} video files in my-storage:`, videoFiles);
      } catch (err) {
        console.error('[My Storage] Error reading my-storage directory:', err.message);
      }
    }
    
    // Convert mock URLs to localhost URLs and verify files exist
    const convertedResources = resources
      .map(resource => {
        const mockUrlPatterns = [
          'your-account.r2.cloudflarestorage.com',
          'mock-cloudflare.example.com',
          'test.cloudflare'
        ];
        
        const isMockUrl = resource.cloudflare_url && mockUrlPatterns.some(pattern => 
          resource.cloudflare_url.includes(pattern)
        );
        
        if (isMockUrl && resource.cloudflare_key) {
          // Extract video ID from storage path
          // Format: my-storage/{videoId}_master.mp4 or cloudflare/.../{videoId}_master.mp4
          const storagePath = resource.cloudflare_key.replace(/^cloudflare\//, 'my-storage/');
          const videoIdMatch = storagePath.match(/(?:my-storage|cloudflare)\/([^/]+)_master\./);
          
          if (videoIdMatch) {
            const videoId = videoIdMatch[1];
            const localhostUrl = `${config.urls.base}/s/${videoId}`;
            return {
              ...resource,
              cloudflare_url: localhostUrl,
              original_url: resource.cloudflare_url, // Keep original for reference
              converted: true
            };
          }
        }
        
        return resource;
      })
      .filter(resource => {
        // If no my-storage path found, show all resources (might be remote URLs)
        if (!myStoragePath) {
          console.log(`[My Storage] No my-storage folder found, keeping resource ${resource.id} (might be remote)`);
          return true;
        }
        
        // If no cloudflare_key, keep it (might be remote URL)
        if (!resource.cloudflare_key) {
          console.log(`[My Storage] Resource ${resource.id} has no cloudflare_key, keeping it`);
          return true;
        }
        
        const storagePath = resource.cloudflare_key.replace(/^cloudflare\//, 'my-storage/');
        const fileName = path.basename(storagePath);
        
        // Strategy 1: Check exact filename match
        let filePath = path.join(myStoragePath, fileName);
        let fileExists = fsSync.existsSync(filePath);
        
        // Strategy 2: If not found, try to find by video ID pattern
        if (!fileExists && fileName) {
          // Extract potential video ID from filename (e.g., VID1764744941896master_master.mp4 -> VID1764744941896)
          const videoIdMatch = fileName.match(/^(VID\d+)/i);
          if (videoIdMatch) {
            const videoIdPrefix = videoIdMatch[1];
            // Try to find any file starting with this prefix
            try {
              const files = fsSync.readdirSync(myStoragePath);
              const matchingFile = files.find(f => 
                f.startsWith(videoIdPrefix) && 
                (f.endsWith('.mp4') || f.endsWith('.mov') || f.endsWith('.webm'))
              );
              if (matchingFile) {
                filePath = path.join(myStoragePath, matchingFile);
                fileExists = fsSync.existsSync(filePath);
                console.log(`✓ Found file by video ID pattern: ${matchingFile} for resource ${resource.id} (${resource.file_name})`);
              }
            } catch (err) {
              console.warn(`Error reading my-storage directory: ${err.message}`);
            }
          }
        }
        
        // Strategy 3: Try matching by extracting numbers from cloudflare_key
        if (!fileExists && resource.cloudflare_key) {
          try {
            const files = fsSync.readdirSync(myStoragePath);
            // Extract all numbers from cloudflare_key
            const numbers = resource.cloudflare_key.match(/\d+/g);
            if (numbers && numbers.length > 0) {
              // Try to find file containing these numbers
              const matchingFile = files.find(f => {
                const fNumbers = f.match(/\d+/g);
                if (!fNumbers) return false;
                // Check if any number from cloudflare_key appears in filename
                return numbers.some(num => fNumbers.includes(num));
              });
              if (matchingFile) {
                filePath = path.join(myStoragePath, matchingFile);
                fileExists = fsSync.existsSync(filePath);
                console.log(`✓ Found file by number matching: ${matchingFile} for resource ${resource.id} (${resource.file_name})`);
              }
            }
          } catch (err) {
            console.warn(`Error in number matching: ${err.message}`);
          }
        }
        
        // Strategy 4: Try fixed format: <video_id>.mp4 (if we can extract video_id)
        if (!fileExists && resource.cloudflare_key) {
          // Try to extract video ID from cloudflare_key or file_name
          const possibleVideoId = resource.cloudflare_key
            .replace(/^cloudflare\//, '')
            .replace(/^my-storage\//, '')
            .replace(/_master\.mp4$/, '')
            .replace(/\.mp4$/, '')
            .replace(/master$/, '');
          
          if (possibleVideoId) {
            const fixedFormatPath = path.join(myStoragePath, `${possibleVideoId}.mp4`);
            if (fsSync.existsSync(fixedFormatPath)) {
              filePath = fixedFormatPath;
              fileExists = true;
              console.log(`✓ Found file using fixed format: ${possibleVideoId}.mp4 for resource ${resource.id}`);
            }
          }
        }
        
        // Strategy 5: Try partial match by filename (without _master suffix)
        if (!fileExists && fileName) {
          const baseName = fileName.replace(/_master\.mp4$/, '.mp4').replace(/master\.mp4$/, '.mp4');
          const partialPath = path.join(myStoragePath, baseName);
          if (fsSync.existsSync(partialPath)) {
            filePath = partialPath;
            fileExists = true;
            console.log(`✓ Found file by partial match: ${baseName} for resource ${resource.id}`);
          }
        }
        
        if (!fileExists) {
          console.log(`⚠ Resource ${resource.id} (${resource.file_name}) - cloudflare_key: ${resource.cloudflare_key} - No matching file found. Tried: ${fileName}`);
          // DON'T filter out - show it anyway so user can see what's in database
          // return false; // This was filtering out resources
        }
        
        // Show all resources, even if file not found (user can see what's in DB)
        return true; // Changed from fileExists to true - show all resources
      });
    
    console.log(`[My Storage] Returning ${convertedResources.length} resources (filtered from ${resources.length} total)`);
    console.log(`[My Storage] My-storage path: ${myStoragePath || 'Not found'}`);
    
    res.json({ 
      resources: convertedResources,
      total: resources.length,
      filtered: convertedResources.length,
      myStoragePath: myStoragePath || 'Not found'
    });
  } catch (error) {
    console.error('Error getting My Storage resources:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to get My Storage resources', 
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

/**
 * Get misc folder files (for left side)
 */
export async function getMiscFiles(req, res) {
  try {
    // Use same path resolution as uploadToMyStorage
    const backendDir = path.dirname(__dirname);
    const basePath = path.dirname(backendDir);
    let uploadPath = path.isAbsolute(config.upload.uploadPath) 
      ? config.upload.uploadPath 
      : path.resolve(basePath, config.upload.uploadPath);
    
    // Try multiple possible paths for misc folder (prioritize the one with files)
    const possibleMiscPaths = [
      path.join(basePath, 'video-storage', 'misc'), // First: basePath/video-storage/misc (where files actually are)
      path.join(uploadPath, 'misc'), // Second: uploadPath/misc (default)
      path.join(basePath, 'misc'), // Third: basePath/misc (fallback)
    ];
    
    // Find the first path that exists and has files
    let miscPath = null;
    let maxFiles = 0;
    for (const tryPath of possibleMiscPaths) {
      if (fsSync.existsSync(tryPath)) {
        try {
          const files = await fs.readdir(tryPath);
          // Count actual files (not directories)
          const fileCount = files.filter(f => {
            try {
              return fsSync.statSync(path.join(tryPath, f)).isFile();
            } catch {
              return false;
            }
          }).length;
          
          if (fileCount > maxFiles) {
            miscPath = tryPath;
            maxFiles = fileCount;
            console.log(`✓ Found misc folder with ${fileCount} files at: ${miscPath}`);
            // Update uploadPath to match
            uploadPath = path.dirname(miscPath);
          }
        } catch (err) {
          console.warn(`Could not read directory: ${tryPath}`, err.message);
        }
      }
    }
    
    // If no misc folder found, use the default
    if (!miscPath) {
      miscPath = possibleMiscPaths[1]; // Use default
      console.log(`Using default misc path: ${miscPath}`);
    } else {
      console.log(`Using misc folder with ${maxFiles} files: ${miscPath}`);
    }
    
    console.log('getMiscFiles path resolution:', {
      backendDir,
      basePath,
      configUploadPath: config.upload.uploadPath,
      resolvedUploadPath: uploadPath,
      resolvedMiscPath: miscPath,
      miscPathExists: fsSync.existsSync(miscPath)
    });
    
    // Check if directory exists, create if it doesn't
    try {
      await fs.access(miscPath);
    } catch {
      console.warn(`Misc folder does not exist at: ${miscPath}, creating it...`);
      try {
        await ensureDirectoryExists(miscPath);
        console.log(`✓ Misc folder created at: ${miscPath}`);
        return res.json({ files: [], message: 'Misc folder was empty or did not exist. It has been created. Please add video files to this folder.' });
      } catch (createError) {
        console.error('Error creating misc folder:', createError);
        return res.json({ 
          files: [], 
          error: 'Misc folder does not exist and could not be created',
          message: `Please create the misc folder at: ${miscPath}`
        });
      }
    }
    
    // Read directory
    const files = await fs.readdir(miscPath);
    console.log(`getMiscFiles: Found ${files.length} items in misc folder:`, files.slice(0, 10));
    
    // Get file stats
    const fileList = await Promise.all(
      files.map(async (filename) => {
        try {
          const filePath = path.join(miscPath, filename);
          const stats = await fs.stat(filePath);
          
          if (stats.isFile()) {
            return {
              filename,
              size: stats.size,
              sizeFormatted: formatFileSize(stats.size),
              path: filePath,
              relativePath: `misc/${filename}`,
              modified: stats.mtime
            };
          }
          return null;
        } catch (err) {
          console.error(`Error reading file ${filename}:`, err);
          return null;
        }
      })
    );
    
    const validFiles = fileList.filter(file => file !== null);
    console.log(`getMiscFiles: Returning ${validFiles.length} valid files`);
    res.json({ files: validFiles });
  } catch (error) {
    console.error('Error getting misc files:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to get misc files', 
      message: error.message
    });
  }
}

/**
 * Delete a file from misc folder
 */
export async function deleteMiscFile(req, res) {
  try {
    const { filename, path: filePath } = req.body;
    
    if (!filename && !filePath) {
      return res.status(400).json({ 
        error: 'Missing required field',
        message: 'Either filename or path is required'
      });
    }
    
    // Use same path resolution as getMiscFiles
    const backendDir = path.dirname(__dirname);
    const basePath = path.dirname(backendDir);
    let uploadPath = path.isAbsolute(config.upload.uploadPath) 
      ? config.upload.uploadPath 
      : path.resolve(basePath, config.upload.uploadPath);
    
    // Try multiple possible paths for misc folder
    const possibleMiscPaths = [
      path.join(basePath, 'video-storage', 'misc'),
      path.join(uploadPath, 'misc'),
      path.join(basePath, 'misc'),
    ];
    
    // Find the misc folder
    let miscPath = null;
    let maxFiles = 0;
    for (const tryPath of possibleMiscPaths) {
      if (fsSync.existsSync(tryPath)) {
        try {
          const files = await fs.readdir(tryPath);
          const fileCount = files.filter(f => {
            try {
              return fsSync.statSync(path.join(tryPath, f)).isFile();
            } catch {
              return false;
            }
          }).length;
          
          if (fileCount > maxFiles) {
            miscPath = tryPath;
            maxFiles = fileCount;
          }
        } catch (err) {
          console.warn(`Could not read directory: ${tryPath}`, err.message);
        }
      }
    }
    
    if (!miscPath) {
      miscPath = possibleMiscPaths[1]; // Use default
    }
    
    // Determine the full path to the file
    let fullFilePath;
    if (filePath && fsSync.existsSync(filePath)) {
      // Use provided absolute path if it exists
      fullFilePath = filePath;
    } else if (filename) {
      // Use filename with misc path
      fullFilePath = path.join(miscPath, filename);
    } else {
      return res.status(400).json({ 
        error: 'Invalid file path',
        message: 'Could not determine file path'
      });
    }
    
    // Security check: ensure file is within misc folder
    const resolvedMiscPath = path.resolve(miscPath);
    const resolvedFilePath = path.resolve(fullFilePath);
    
    if (!resolvedFilePath.startsWith(resolvedMiscPath)) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'File must be within misc folder'
      });
    }
    
    // Check if file exists
    if (!fsSync.existsSync(fullFilePath)) {
      return res.status(404).json({ 
        error: 'File not found',
        message: `File does not exist: ${fullFilePath}`
      });
    }
    
    // Delete the file
    await fs.unlink(fullFilePath);
    console.log(`✓ Deleted misc file: ${fullFilePath}`);
    
    res.json({ 
      success: true,
      message: 'File deleted successfully',
      deletedFile: filename || path.basename(fullFilePath)
    });
  } catch (error) {
    console.error('Error deleting misc file:', error);
    res.status(500).json({ 
      error: 'Failed to delete file', 
      message: error.message 
    });
  }
}

/**
 * Upload file to local storage (my-storage folder) and create video entry with localhost URL
 * Stores all videos in my-storage folder for localhost streaming
 */
export async function uploadToMyStorage(req, res) {
  console.log('\n========== UPLOAD REQUEST ==========');
  console.log('uploadToMyStorage called with:', {
    body: req.body,
    method: req.method,
    path: req.path,
    url: req.url,
    hasFile: !!req.file,
    fileInfo: req.file ? {
      originalname: req.file.originalname,
      size: req.file.size,
      path: req.file.path,
      mimetype: req.file.mimetype
    } : 'No file uploaded',
    contentType: req.headers['content-type']
  });
  console.log('====================================\n');
  
  // Initialize variables to prevent undefined errors
  let sourceFilePath = null;
  let targetFilePath = null;
  let videoId = null;
  let nameWithoutExt = null;
  let relativePath = null;
  let shortSlug = null;
  let shortUrl = null;
  let streamingUrl = null;
  let thumbnailUrl = null;
  let actualFileSize = 0;
  let miscPath = null;
  let fileNameOnly = null;
  let possiblePaths = [];
  
  try {
    // Extract data from request - handle both JSON and FormData
    // For FormData, multer parses fields into req.body
    const bodyData = req.body || {};
    let fileName = bodyData.fileName || (req.file ? req.file.originalname : null);
    let fileSize = bodyData.fileSize || (req.file ? req.file.size : null);
    const fileType = bodyData.fileType || (req.file ? req.file.mimetype : null);
    let sourceType = bodyData.sourceType || null; // Will be set with default later if needed
    const sourcePath = bodyData.sourcePath || null;
    const testMode = bodyData.testMode === 'true' || bodyData.testMode === true;
    
    console.log('Extracted request data:', {
      fileName: fileName || 'NOT PROVIDED',
      fileSize: fileSize || 'NOT PROVIDED',
      fileType: fileType || 'NOT PROVIDED',
      sourceType: sourceType || 'NOT PROVIDED',
      sourcePath: sourcePath || 'NOT PROVIDED',
      hasFile: !!req.file,
      bodyKeys: Object.keys(bodyData),
      contentType: req.headers['content-type']
    });
    
    // Validate required fields
    if (!fileName && !req.file) {
      return res.status(400).json({ 
        error: 'Missing required field: fileName',
        message: 'File name is required for upload. Either provide fileName in request body or upload a file.',
        debug: {
          hasFile: !!req.file,
          bodyKeys: Object.keys(bodyData),
          contentType: req.headers['content-type']
        }
      });
    }
    
    // Set default sourceType if not provided
    if (!sourceType) {
      // If we have a file, assume it's an upload; otherwise default to misc
      sourceType = req.file ? 'upload' : 'misc';
    }
    console.log(`Using sourceType: ${sourceType} (hasFile: ${!!req.file})`);
    
    // Validate sourceType and sourcePath for misc uploads
    if (sourceType === 'misc' && !sourcePath) {
      return res.status(400).json({ 
        error: 'Missing required field: sourcePath',
        message: 'sourcePath is required when sourceType is "misc"',
        debug: {
          sourceType: sourceType,
          sourcePath: sourcePath || 'NOT PROVIDED',
          bodyKeys: Object.keys(bodyData)
        }
      });
    }
    
    // Resolve paths
    const backendDir = path.dirname(__dirname);
    const basePath = path.dirname(backendDir);
    let uploadPath = path.isAbsolute(config.upload.uploadPath) 
      ? config.upload.uploadPath 
      : path.resolve(basePath, config.upload.uploadPath);
    
    // Try multiple possible paths for misc folder (prioritize the one with files)
    const possibleMiscPaths = [
      path.join(basePath, 'video-storage', 'misc'), // First: basePath/video-storage/misc (where files actually are)
      path.join(uploadPath, 'misc'), // Second: uploadPath/misc (default)
      path.join(basePath, 'misc'), // Third: basePath/misc (fallback)
    ];
    
    // Find the path that exists and has the most files
    let foundMiscPath = null;
    let maxFiles = 0;
    for (const tryPath of possibleMiscPaths) {
      if (fsSync.existsSync(tryPath)) {
        try {
          const files = fsSync.readdirSync(tryPath);
          // Count actual files (not directories)
          const fileCount = files.filter(f => {
            try {
              return fsSync.statSync(path.join(tryPath, f)).isFile();
            } catch {
              return false;
            }
          }).length;
          
          if (fileCount > maxFiles) {
            foundMiscPath = tryPath;
            maxFiles = fileCount;
            console.log(`✓ Found misc folder with ${fileCount} files at: ${foundMiscPath}`);
            // Update uploadPath to match
            uploadPath = path.dirname(foundMiscPath);
          }
        } catch (err) {
          console.warn(`Could not read directory: ${tryPath}`, err.message);
        }
      }
    }
    
    // If no misc folder found, use the default
    if (!foundMiscPath) {
      foundMiscPath = possibleMiscPaths[1]; // Use default
      console.log(`Using default misc path: ${foundMiscPath}`);
    } else {
      console.log(`Using misc folder with ${maxFiles} files: ${foundMiscPath}`);
    }
    
    console.log('Upload path resolution:', {
      backendDir,
      basePath,
      configUploadPath: config.upload.uploadPath,
      resolvedUploadPath: uploadPath,
      uploadPathExists: fsSync.existsSync(uploadPath),
      foundMiscPath,
      foundMiscPathExists: foundMiscPath ? fsSync.existsSync(foundMiscPath) : false,
      possiblePaths: possibleMiscPaths.map(p => ({
        path: p,
        exists: fsSync.existsSync(p)
      }))
    });
    
    // Create my-storage folder if it doesn't exist
    const myStoragePath = path.join(uploadPath, 'my-storage');
    await ensureDirectoryExists(myStoragePath);
    console.log(`My Storage folder ensured at: ${myStoragePath}`);
    
    // Determine source file path
    
    if (sourceType === 'misc' && sourcePath) {
      // File is in misc folder - use the found path or default
      miscPath = foundMiscPath || path.join(uploadPath, 'misc');
      
      // Create misc folder if it doesn't exist
      if (!fsSync.existsSync(miscPath)) {
        console.warn(`Misc folder not found at ${miscPath}, creating it...`);
        await ensureDirectoryExists(miscPath);
        console.log(`✓ Misc folder created at: ${miscPath}`);
      }
      
      // sourcePath from frontend is like "misc/VID_1764744941896_master.mp4"
      // But actual file might be "VID_1764744941896.mp4" or "VID_1764744941896_master.mp4"
      fileNameOnly = path.basename(sourcePath); // Get just the filename part
      
      console.log('File path resolution:', {
        sourcePath,
        fileName,
        fileNameOnly,
        miscPath,
        miscPathExists: fsSync.existsSync(miscPath)
      });
      
      // Read files from misc folder if it exists
      let miscFiles = [];
      try {
        if (fsSync.existsSync(miscPath)) {
          const allItems = await fs.readdir(miscPath);
          // Filter to only files (not directories) and get their actual names
          for (const item of allItems) {
            try {
              const itemPath = path.join(miscPath, item);
              const stats = await fs.stat(itemPath);
              if (stats.isFile()) {
                miscFiles.push(item);
              }
            } catch (err) {
              // Skip items we can't stat
              console.warn(`Could not stat item: ${item}`, err.message);
            }
          }
          console.log(`Found ${miscFiles.length} files in misc folder:`, miscFiles.slice(0, 10));
        } else {
          console.warn(`Misc folder does not exist at: ${miscPath}`);
        }
      } catch (err) {
        console.error('Error reading misc folder:', err);
      }
      
      // Try multiple path variations in order of likelihood
      possiblePaths = [
        path.join(miscPath, fileNameOnly), // Most likely: just filename in misc folder
        path.join(uploadPath, sourcePath), // Full path: uploadPath/misc/filename
        path.join(miscPath, fileName) // Use fileName directly
      ];
      
      // Also try without _master suffix if present
      if (fileNameOnly.includes('_master')) {
        const nameWithoutMaster = fileNameOnly.replace(/_master\./, '.');
        possiblePaths.push(path.join(miscPath, nameWithoutMaster));
      }
      if (fileName.includes('_master')) {
        const nameWithoutMaster = fileName.replace(/_master\./, '.');
        possiblePaths.push(path.join(miscPath, nameWithoutMaster));
      }
      
      // Try exact match from actual files list (case-insensitive, handle spaces)
      if (miscFiles.length > 0) {
        const exactMatch = miscFiles.find(f => {
          const fLower = f.toLowerCase().trim();
          const fileNameLower = fileName.toLowerCase().trim();
          const fileNameOnlyLower = fileNameOnly.toLowerCase().trim();
          return fLower === fileNameOnlyLower || fLower === fileNameLower;
        });
        if (exactMatch) {
          possiblePaths.unshift(path.join(miscPath, exactMatch)); // Add to front of list
          console.log(`Found exact match in file list: ${exactMatch}`);
        }
      }
      
      // Try to find existing file
      for (const tryPath of possiblePaths) {
        try {
          if (fsSync.existsSync(tryPath)) {
            sourceFilePath = tryPath;
            console.log(`✓ Found file at: ${sourceFilePath}`);
            break;
          }
        } catch (err) {
          console.warn(`Error checking path: ${tryPath}`, err.message);
        }
      }
      
      // If still not found, search by VID number using already-read file list
      if (!sourceFilePath && miscFiles.length > 0) {
        const vidMatch = fileName.match(/VID_(\d+)/) || fileNameOnly.match(/VID_(\d+)/);
        if (vidMatch) {
          const matchingFile = miscFiles.find(f => f.includes(`VID_${vidMatch[1]}`));
          if (matchingFile) {
            sourceFilePath = path.join(miscPath, matchingFile);
            console.log(`✓ Found file by VID number: ${sourceFilePath}`);
          }
        }
      }
      
      // Also try partial name matching (for files like "SS_G1_U1_L1_My Home.mp4")
      if (!sourceFilePath && miscFiles.length > 0) {
        // Try to find file by partial name match - improved for files with spaces
        const nameBase = fileName.replace(/\.[^/.]+$/, '').toLowerCase();
        const nameParts = nameBase.split(/[_\s-]+/).filter(p => p.length > 1);
        
        if (nameParts.length > 0) {
          // Try exact match first (handles spaces)
          let partialMatch = miscFiles.find(f => {
            const fBase = f.replace(/\.[^/.]+$/, '').toLowerCase();
            return fBase === nameBase || fBase.includes(nameBase) || nameBase.includes(fBase);
          });
          
          // If no exact match, try partial matching
          if (!partialMatch) {
            partialMatch = miscFiles.find(f => {
              const fLower = f.toLowerCase();
              // Check if all significant parts are present
              return nameParts.every(part => fLower.includes(part)) || 
                     nameParts.some(part => fLower.includes(part) && part.length > 3);
            });
          }
          
          if (partialMatch) {
            sourceFilePath = path.join(miscPath, partialMatch);
            console.log(`✓ Found file by partial name match: ${sourceFilePath}`);
          }
        }
      }
    } else if (sourceType === 'upload') {
      // File was uploaded from PC - handle multipart/form-data upload
      // Check if file was uploaded via multer
      const uploadedFile = req.file;
      
      console.log('Checking for uploaded file:', {
        hasFile: !!uploadedFile,
        sourceType,
        contentType: req.headers['content-type'],
        bodyKeys: Object.keys(req.body || {}),
        fileInfo: uploadedFile ? {
          originalname: uploadedFile.originalname,
          size: uploadedFile.size,
          path: uploadedFile.path
        } : null
      });
      
      if (!uploadedFile) {
        console.error('ERROR: No file received in req.file');
        console.error('Request details:', {
          method: req.method,
          contentType: req.headers['content-type'],
          hasBody: !!req.body,
          bodyKeys: Object.keys(req.body || {}),
          sourceType: sourceType || 'NOT SET',
          multerError: req.multerError || 'No multer error'
        });
        
        return res.status(400).json({ 
          error: 'No file uploaded',
          message: 'Please select a file to upload. The file was not received by the server.',
          debug: {
            contentType: req.headers['content-type'],
            hasFile: false,
            sourceType: sourceType || 'NOT SET',
            bodyKeys: Object.keys(req.body || {})
          }
        });
      }
      
      // Use the uploaded file
      sourceFilePath = uploadedFile.path;
      fileName = uploadedFile.originalname || fileName;
      actualFileSize = uploadedFile.size || fileSize || 0;
      
      console.log('File uploaded from PC:', {
        originalName: uploadedFile.originalname,
        tempPath: sourceFilePath,
        size: actualFileSize,
        mimetype: uploadedFile.mimetype
      });
      
      // Verify the uploaded file exists
      if (!fsSync.existsSync(sourceFilePath)) {
        return res.status(400).json({ 
          error: 'Uploaded file not found',
          message: 'The uploaded file could not be found on the server.'
        });
      }
    } else {
      return res.status(400).json({ 
        error: 'Invalid source type',
        message: `Unknown source type: ${sourceType}. Use 'misc' or 'upload'.`,
        debug: {
          sourceType: sourceType,
          hasFile: !!req.file,
          contentType: req.headers['content-type']
        }
      });
    }
    
    // Final check - if still not found, return error with helpful info
    if (!sourceFilePath || !fsSync.existsSync(sourceFilePath)) {
      // Ensure miscPath is set if not already
      if (!miscPath) {
        miscPath = path.join(uploadPath, 'misc');
      }
      
      // Read files from misc folder
      let miscFiles = [];
      let readError = null;
      try {
        if (fsSync.existsSync(miscPath)) {
          miscFiles = await fs.readdir(miscPath);
          // Filter out directories, only get files
          const fileStats = await Promise.all(
            miscFiles.map(async (f) => {
              try {
                const filePath = path.join(miscPath, f);
                const stats = await fs.stat(filePath);
                return stats.isFile() ? f : null;
              } catch {
                return null;
              }
            })
          );
          miscFiles = fileStats.filter(f => f !== null);
          console.log(`Found ${miscFiles.length} files in misc folder:`, miscFiles.slice(0, 10));
        } else {
          readError = `Misc folder does not exist at: ${miscPath}`;
        }
      } catch (err) {
        console.error('Error reading misc folder:', err);
        readError = err.message;
      }
      
      // Get fileNameOnly safely - use the one we already have or get from sourcePath
      if (!fileNameOnly) {
        fileNameOnly = sourcePath ? path.basename(sourcePath) : fileName;
      }
      
      // Try to find similar files
      const vidMatch = fileName.match(/VID_(\d+)/) || (fileNameOnly ? fileNameOnly.match(/VID_(\d+)/) : null);
      const similarFiles = vidMatch ? miscFiles.filter(f => f.includes(`VID_${vidMatch[1]}`)) : [];
      
      // Also try case-insensitive partial matches
      const partialMatches = miscFiles.filter(f => {
        const fLower = f.toLowerCase();
        const nameLower = fileName.toLowerCase();
        const nameOnlyLower = fileNameOnly ? fileNameOnly.toLowerCase() : '';
        return fLower.includes(nameLower) || (nameOnlyLower && fLower.includes(nameOnlyLower)) ||
               nameLower.includes(fLower) || (nameOnlyLower && nameOnlyLower.includes(fLower));
      });
      
      // Build helpful error message
      let errorMessage = `Could not find file "${fileName}" in misc folder.`;
      if (miscFiles.length === 0) {
        errorMessage += ` The misc folder is empty. Please add the file "${fileName}" to the misc folder at: ${miscPath}`;
      } else {
        errorMessage += ` Found ${miscFiles.length} file(s) in misc folder, but none match.`;
        if (similarFiles.length > 0) {
          errorMessage += ` Found similar files by VID: ${similarFiles.join(', ')}`;
        } else if (partialMatches.length > 0) {
          errorMessage += ` Found partial matches: ${partialMatches.join(', ')}`;
        } else {
          errorMessage += ` Available files: ${miscFiles.slice(0, 10).join(', ')}${miscFiles.length > 10 ? '...' : ''}`;
        }
      }
      
      console.error('File not found after all attempts:', {
        fileName,
        fileNameOnly,
        sourcePath,
        triedPaths: possiblePaths || [],
        miscFilesCount: miscFiles.length,
        miscFiles: miscFiles.slice(0, 20),
        similarFiles,
        partialMatches,
        readError
      });
      
      return res.status(400).json({ 
        error: `Source file not found: ${sourcePath || fileName}`,
        message: errorMessage,
        debug: {
          triedPaths: possiblePaths || [],
          fileName,
          fileNameOnly: fileNameOnly || 'N/A',
          sourcePath,
          miscPath,
          miscPathExists: fsSync.existsSync(miscPath),
          miscFiles: miscFiles.slice(0, 20), // Show first 20 files for debugging
          miscFilesCount: miscFiles.length,
          similarFiles: similarFiles.slice(0, 5),
          partialMatches: partialMatches.slice(0, 5),
          readError: readError || null
        }
      });
    }
    
    console.log(`✓ Using source file path: ${sourceFilePath}`);
    
    // Generate video ID from filename (remove extension)
    nameWithoutExt = path.basename(fileName, path.extname(fileName));
    videoId = generateVideoId({ title: nameWithoutExt });
    
    // Check if video already exists, if so, append timestamp to make it unique
    let existingVideo = await videoService.getVideoByVideoId(videoId, true);
    if (existingVideo) {
      console.warn(`Video ID "${videoId}" already exists, generating unique ID...`);
      videoId = `${videoId}_${Date.now()}`;
      // Check again with new ID
      existingVideo = await videoService.getVideoByVideoId(videoId, true);
      if (existingVideo) {
        return res.status(400).json({ 
          error: `Unable to generate unique video ID. Please rename the file.` 
        });
      }
    }
    
    console.log(`Using video ID: ${videoId}`);
    
    // Copy file to my-storage folder
    const fileExtension = path.extname(fileName);
    const targetFileName = `${videoId}_master${fileExtension}`;
    targetFilePath = path.join(myStoragePath, targetFileName);
    relativePath = `my-storage/${targetFileName}`;
    
    // Verify source file exists before copying
    if (!fsSync.existsSync(sourceFilePath)) {
      return res.status(404).json({ 
        error: 'Source file not found',
        message: `The file "${sourceFilePath}" does not exist. Please check the file path.`
      });
    }
    
    // Copy file to my-storage folder
    try {
      await fs.copyFile(sourceFilePath, targetFilePath);
      console.log(`✓ File copied to my-storage: ${targetFilePath}`);
      
      // If file was uploaded from PC (temp location), clean up temp file
      if (sourceType === 'upload' && sourceFilePath.includes('temp-uploads')) {
        try {
          await fs.unlink(sourceFilePath);
          console.log(`✓ Cleaned up temp file: ${sourceFilePath}`);
        } catch (cleanupError) {
          console.warn('Failed to clean up temp file (non-critical):', cleanupError.message);
          // Don't fail the upload if cleanup fails
        }
      }
    } catch (copyError) {
      console.error('Error copying file:', copyError);
      
      // Clean up temp file on error if it exists
      if (sourceType === 'upload' && sourceFilePath.includes('temp-uploads') && fsSync.existsSync(sourceFilePath)) {
        try {
          await fs.unlink(sourceFilePath);
          console.log(`✓ Cleaned up temp file after error: ${sourceFilePath}`);
        } catch (cleanupError) {
          console.warn('Failed to clean up temp file after error:', cleanupError.message);
        }
      }
      
      return res.status(500).json({ 
        error: 'Failed to copy file to my-storage folder',
        message: copyError.message,
        sourcePath: sourceFilePath,
        targetPath: targetFilePath
      });
    }
    
    // Get actual file size
    actualFileSize = await getFileSize(targetFilePath);
    
    // Get default thumbnail from thumbnails folder
    // thumbnailUrl is already declared at the top of the function
    try {
      // Read thumbnails directory directly
      const thumbnailsDir = path.join(uploadPath, 'thumbnails');
      if (fsSync.existsSync(thumbnailsDir)) {
        const thumbnailFiles = await fs.readdir(thumbnailsDir);
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
        const thumbnails = thumbnailFiles.filter(file => {
          const ext = path.extname(file).toLowerCase();
          return imageExtensions.includes(ext);
        });
        
        if (thumbnails.length > 0) {
          // Use thumbnail based on video ID hash to cycle through available thumbnails
          const thumbnailIndex = Math.abs(videoId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % thumbnails.length;
          const selectedThumbnail = thumbnails[thumbnailIndex];
          thumbnailUrl = `thumbnails/${selectedThumbnail}`;
          console.log(`Using default thumbnail: ${thumbnailUrl}`);
        } else {
          // Use default thumbnail path if no thumbnails available
          thumbnailUrl = 'thumbnails/default.png';
          console.log('No thumbnails found, using default path');
        }
      } else {
        thumbnailUrl = 'thumbnails/default.png';
        console.log('Thumbnails directory not found, using default path');
      }
    } catch (thumbError) {
      console.warn('Error getting thumbnails, using default:', thumbError.message);
      thumbnailUrl = 'thumbnails/default.png';
    }
    
    // Create redirect with short URL
    let redirectResult;
    let shortUrl;
    let shortSlug;
    try {
      let redirectSlug = videoId;
      const redirectUrl = `${config.urls.frontend}/stream/${videoId}`;
      
      // Check if redirect_slug already exists in videos table
      let existingVideoWithSlug = await videoService.getVideoByRedirectSlug(redirectSlug, true);
      if (existingVideoWithSlug) {
        console.warn(`Redirect slug "${redirectSlug}" already used by another video, generating unique slug...`);
        redirectSlug = `${videoId}_${Date.now()}`;
        // Check again with new slug
        existingVideoWithSlug = await videoService.getVideoByRedirectSlug(redirectSlug, true);
        if (existingVideoWithSlug) {
          // If still exists, try one more time with more randomness
          redirectSlug = `${videoId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        }
      }
      
      // Try to create redirect, if it fails due to duplicate, try with unique slug
      try {
        redirectResult = await redirectService.createRedirect(redirectSlug, redirectUrl, true);
        shortUrl = redirectResult.shortUrl || redirectUrl;
        shortSlug = redirectResult.shortSlug || redirectSlug;
        console.log(`✓ Redirect created: ${shortUrl}`);
      } catch (redirectError) {
        // If redirect slug already exists, try with unique slug
        if (redirectError.code === 'ER_DUP_ENTRY' || redirectError.message?.includes('Duplicate entry')) {
          console.warn(`Redirect slug "${redirectSlug}" already exists in redirects table, generating unique slug...`);
          redirectSlug = `${videoId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
          redirectResult = await redirectService.createRedirect(redirectSlug, redirectUrl, true);
          shortUrl = redirectResult.shortUrl || redirectUrl;
          shortSlug = redirectResult.shortSlug || redirectSlug;
          console.log(`✓ Redirect created with unique slug: ${shortUrl}`);
        } else {
          throw redirectError; // Re-throw if it's a different error
        }
      }
    } catch (redirectError) {
      console.error('Error creating redirect:', redirectError);
      // Use videoId as fallback
      shortUrl = `${config.urls.base}/${videoId}`;
      shortSlug = videoId;
      console.warn('Using videoId as redirect slug due to error');
    }
    
    // Build streaming URL using localhost with redirect slug
    streamingUrl = videoService.buildStreamingUrl(relativePath, videoId, shortSlug, req);
    console.log(`✓ Streaming URL: ${streamingUrl}`);
    
    // Generate QR code
    let qrUrl = null;
    try {
      qrUrl = await qrCodeService.generateQRCode(videoId, shortUrl);
      console.log(`✓ QR code generated: ${qrUrl}`);
    } catch (qrError) {
      console.warn('Failed to generate QR code:', qrError.message);
      // Continue without QR code - not critical
    }
    
    // NOTE: Manual uploads (PC/misc) only create cloudflare_resources entries
    // They do NOT create video entries, so they won't appear in the Videos page
    // Only CSV bulk uploads create both cloudflare_resources AND video entries
    console.log(`✓ Manual upload: Only creating cloudflare_resources entry (not video entry)`);
    console.log(`  Videos uploaded via CSV bulk upload will appear in Videos page`);
    console.log(`  Videos uploaded manually (PC/misc) will only appear in My Storage section`);
    
    // Create entry in cloudflare_resources table for tracking (database schema uses cloudflare_* names)
    // But we store localhost URLs and my-storage paths
    let resourceResult;
    try {
      const localhostUrl = streamingUrl;
    const [result] = await pool.execute(
      `INSERT INTO cloudflare_resources 
       (file_name, original_file_name, file_size, file_type, cloudflare_url, cloudflare_key, storage_type, source_type, source_path, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fileName,
        fileName,
          actualFileSize,
        fileType || 'application/octet-stream',
          localhostUrl,
          relativePath, // This is the my-storage path
          'my-storage',
        sourceType || 'upload',
        sourcePath || null,
        'completed'
      ]
    );
      resourceResult = result;
      console.log(`✓ Resource entry created with ID: ${result.insertId}`);
    } catch (resourceError) {
      console.error('Error creating resource entry:', resourceError);
      console.error('Resource error details:', {
        message: resourceError.message,
        code: resourceError.code,
        sqlState: resourceError.sqlState,
        sqlMessage: resourceError.sqlMessage
      });
      // Don't fail the whole upload if resource entry fails - video is already created
      resourceResult = { insertId: null };
    }
    
    // Auto-generate co-located VTT beside video (async, non-blocking)
    console.log(`[Cloudflare Upload] 🎤 Scheduling VTT generation for ${videoId}...`);
    (async () => {
      try {
        if (!targetFilePath || !fsSync.existsSync(targetFilePath)) {
          console.error(`[Cloudflare Upload] ❌ Video file not found: ${targetFilePath}`);
          return;
        }

        const { scheduleVttGeneration } = await import('../utils/vttLifecycle.js');
        let videoForVtt = await videoService.getVideoByVideoId(videoId);
        if (!videoForVtt) {
          videoForVtt = { video_id: videoId, file_path: relativePath };
        }
        scheduleVttGeneration(videoForVtt, targetFilePath);
      } catch (subtitleError) {
        console.error(`[Cloudflare Upload] ❌ VTT generation failed (non-critical):`, subtitleError.message);
      }
    })();
    
    res.json({
      success: true,
      message: 'Video uploaded to My Storage successfully',
      resource: {
        id: resourceResult.insertId,
        video_id: videoId,
        file_name: fileName,
        streaming_url: streamingUrl,
        short_url: shortUrl,
        storage_path: relativePath,
        storage_type: 'my-storage',
        thumbnail_url: thumbnailUrl
      },
      note: 'This video is stored in My Storage and will appear in the My Storage section, not in the Videos page. Use CSV bulk upload or Upload Video page to create videos that appear in the Videos page.'
    });
  } catch (error) {
    console.error('\n========== UPLOAD ERROR ==========');
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error name:', error.name);
    if (error.sqlMessage) {
      console.error('SQL Message:', error.sqlMessage);
      console.error('SQL State:', error.sqlState);
      console.error('SQL Code:', error.sqlCode);
    }
    console.error('Error stack:', error.stack);
    console.error('Request body:', JSON.stringify(req.body, null, 2));
    console.error('Variables at error:', {
      sourceFilePath: sourceFilePath || 'null',
      targetFilePath: targetFilePath || 'null',
      videoId: videoId || 'null',
      nameWithoutExt: nameWithoutExt || 'null',
      relativePath: relativePath || 'null',
      shortSlug: shortSlug || 'null',
      streamingUrl: streamingUrl || 'null'
    });
    console.error('==================================\n');
    
    // Return detailed error for debugging
    const errorResponse = {
      error: 'Failed to upload file',
      message: error.message || 'Unknown error occurred',
      type: error.constructor.name,
      code: error.code,
      fileName: req.body?.fileName,
      sourcePath: req.body?.sourcePath
    };
    
    // Add SQL error details if available
    if (error.sqlMessage) {
      errorResponse.sqlError = {
        message: error.sqlMessage,
        state: error.sqlState,
        code: error.sqlCode
      };
    }
    
    // Add stack trace in development
    if (process.env.NODE_ENV === 'development' || config.nodeEnv === 'development') {
      errorResponse.stack = error.stack;
      errorResponse.details = {
        name: error.name,
        variables: {
          sourceFilePath: sourceFilePath || 'null',
          targetFilePath: targetFilePath || 'null',
          videoId: videoId || 'null'
        }
      };
    }
    
    // Make sure response hasn't been sent
    if (!res.headersSent) {
      res.status(500).json(errorResponse);
    } else {
      console.error('ERROR: Response already sent, cannot send error response');
    }
  }
}

/**
 * Get videos using mock Cloudflare URLs
 */
export async function getVideosWithMockUrls(req, res) {
  try {
    const [videos] = await pool.execute(
      `SELECT id, video_id, title, streaming_url, file_path, created_at
       FROM videos
       WHERE status = 'active'
       AND (
         streaming_url LIKE '%your-account.r2.cloudflarestorage.com%' OR
         streaming_url LIKE '%mock-cloudflare.example.com%' OR
         streaming_url LIKE '%example.com%' OR
         (streaming_url LIKE '%test.cloudflare%')
       )
       ORDER BY created_at DESC`
    );
    
    res.json({ videos });
  } catch (error) {
    console.error('Error getting videos with mock URLs:', error);
    res.status(500).json({ error: 'Failed to get videos', message: error.message });
  }
}

/**
 * Update My Storage resource URL and optionally update videos using it
 */
export async function updateMyStorageResource(req, res) {
  try {
    const { id } = req.params;
    const { cloudflare_url, cloudflare_key, updateVideos = false } = req.body;
    
    if (!cloudflare_url) {
      return res.status(400).json({ error: 'Streaming URL is required' });
    }
    
    // Get old URL before updating
    const [oldResources] = await pool.execute(
      'SELECT cloudflare_url FROM cloudflare_resources WHERE id = ?',
      [id]
    );
    
    if (oldResources.length === 0) {
      return res.status(404).json({ error: 'Resource not found' });
    }
    
    const oldUrl = oldResources[0].cloudflare_url;
    
    // Update in database
    const updateFields = [];
    const updateValues = [];
    
    if (cloudflare_url) {
      updateFields.push('cloudflare_url = ?');
      updateValues.push(cloudflare_url);
    }
    
    if (cloudflare_key) {
      updateFields.push('cloudflare_key = ?');
      updateValues.push(cloudflare_key);
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    updateValues.push(id);
    
    const [result] = await pool.execute(
      `UPDATE cloudflare_resources 
       SET ${updateFields.join(', ')} 
       WHERE id = ?`,
      updateValues
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Resource not found' });
    }
    
    // If updateVideos is true, update all videos using the old URL
    let videosUpdated = 0;
    if (updateVideos && oldUrl) {
      try {
        const [updateResult] = await pool.execute(
          `UPDATE videos 
           SET streaming_url = ?, file_path = ?, updated_at = CURRENT_TIMESTAMP
           WHERE (streaming_url = ? OR file_path = ?) 
           AND status = 'active'`,
          [cloudflare_url, cloudflare_url, oldUrl, oldUrl]
        );
        videosUpdated = updateResult.affectedRows;
        console.log(`Updated ${videosUpdated} video(s) with new streaming URL`);
      } catch (updateError) {
        console.error('Error updating videos:', updateError);
        // Don't fail the resource update if video update fails
      }
    }
    
    // Get updated resource
    const [resources] = await pool.execute(
      'SELECT * FROM cloudflare_resources WHERE id = ?',
      [id]
    );
    
    res.json({ 
      success: true, 
      message: `Resource updated successfully${videosUpdated > 0 ? ` and ${videosUpdated} video(s) updated` : ''}`,
      resource: resources[0],
      videosUpdated
    });
  } catch (error) {
    console.error('Error updating My Storage resource:', error);
    res.status(500).json({ error: 'Failed to update resource', message: error.message });
  }
}

/**
 * Get videos using a specific streaming URL
 */
export async function getVideosByStreamingUrl(req, res) {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }
    
    const [videos] = await pool.execute(
      `SELECT id, video_id, title, streaming_url, file_path, created_at
       FROM videos
       WHERE status = 'active'
       AND (streaming_url = ? OR file_path = ?)
       ORDER BY created_at DESC`,
      [url, url]
    );
    
    res.json({ videos });
  } catch (error) {
    console.error('Error getting videos by streaming URL:', error);
    res.status(500).json({ error: 'Failed to get videos', message: error.message });
  }
}

/**
 * Delete My Storage resource
 */
export async function deleteMyStorageResource(req, res) {
  try {
    const { id } = req.params;
    
    // CRITICAL: Get resource info BEFORE deleting from database
    const [resources] = await pool.execute(
      'SELECT cloudflare_key, file_name FROM cloudflare_resources WHERE id = ?',
      [id]
    );
    
    if (resources.length === 0) {
      return res.status(404).json({ error: 'Resource not found' });
    }
    
    const resource = resources[0];
    const cloudflareKey = resource.cloudflare_key;
    const fileName = resource.file_name;
    
    // Delete from my-storage folder if file exists
    let fileDeleted = false;
    if (cloudflareKey) {
      try {
        const storagePath = cloudflareKey.replace(/^cloudflare\//, 'my-storage/');
        const backendDir = path.dirname(__dirname);
        const basePath = path.dirname(backendDir);
        let uploadPath = path.isAbsolute(config.upload.uploadPath) 
          ? config.upload.uploadPath 
          : path.resolve(basePath, config.upload.uploadPath);
        
        // Try multiple possible paths for my-storage folder
        const possibleMyStoragePaths = [
          path.join(uploadPath, 'my-storage'),
          path.join(basePath, 'video-storage', 'my-storage'),
          path.join(basePath, 'my-storage'),
          path.join(basePath, 'video-storage', 'video-storage', 'my-storage'),
        ];
        
        // Try to find and delete the file
        for (const myStoragePath of possibleMyStoragePaths) {
          if (!fsSync.existsSync(myStoragePath)) {
            continue;
          }
          
          // Try exact path from cloudflare_key
          let filePath = path.join(myStoragePath, path.basename(storagePath));
          if (fsSync.existsSync(filePath)) {
            await fs.unlink(filePath);
            console.log(`✓ Deleted file from my-storage: ${filePath}`);
            fileDeleted = true;
            break;
          }
          
          // Try with full storage path
          filePath = path.join(uploadPath, storagePath);
          if (fsSync.existsSync(filePath)) {
            await fs.unlink(filePath);
            console.log(`✓ Deleted file from my-storage: ${filePath}`);
            fileDeleted = true;
            break;
          }
          
          // Try by filename
          if (fileName) {
            filePath = path.join(myStoragePath, fileName);
            if (fsSync.existsSync(filePath)) {
              await fs.unlink(filePath);
              console.log(`✓ Deleted file from my-storage by filename: ${filePath}`);
              fileDeleted = true;
              break;
            }
          }
          
          // Try to find file by searching directory
          try {
            const files = await fs.readdir(myStoragePath);
            const matchingFile = files.find(f => 
              f === fileName || 
              f === path.basename(storagePath) ||
              (cloudflareKey && f.includes(path.basename(cloudflareKey)))
            );
            
            if (matchingFile) {
              filePath = path.join(myStoragePath, matchingFile);
              await fs.unlink(filePath);
              console.log(`✓ Deleted file from my-storage (found by search): ${filePath}`);
              fileDeleted = true;
              break;
            }
          } catch (searchError) {
            console.warn(`Could not search my-storage directory ${myStoragePath}:`, searchError.message);
          }
        }
        
        if (!fileDeleted) {
          console.warn(`⚠ File not found in my-storage for deletion. cloudflare_key: ${cloudflareKey}`);
        }
      } catch (fileError) {
        console.error('Error deleting file from my-storage:', fileError.message);
        // Continue with database deletion even if file deletion fails
      }
    }
    
    // Delete from database
    const [result] = await pool.execute(
      'DELETE FROM cloudflare_resources WHERE id = ?',
      [id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Resource not found' });
    }
    
    res.json({ 
      success: true, 
      message: 'Resource deleted successfully',
      fileDeleted: fileDeleted
    });
  } catch (error) {
    console.error('Error deleting My Storage resource:', error);
    res.status(500).json({ error: 'Failed to delete resource', message: error.message });
  }
}

/**
 * Cleanup orphaned files in my-storage (files without database entries)
 */
export async function cleanupOrphanedFiles(req, res) {
  try {
    const backendDir = path.dirname(__dirname);
    const basePath = path.dirname(backendDir);
    let uploadPath = path.isAbsolute(config.upload.uploadPath) 
      ? config.upload.uploadPath 
      : path.resolve(basePath, config.upload.uploadPath);
    
    // Try multiple possible paths for my-storage folder
    const possibleMyStoragePaths = [
      path.join(uploadPath, 'my-storage'),
      path.join(basePath, 'video-storage', 'my-storage'),
      path.join(basePath, 'my-storage'),
      path.join(basePath, 'video-storage', 'video-storage', 'my-storage'),
    ];
    
    // Find the my-storage folder
    let myStoragePath = null;
    for (const tryPath of possibleMyStoragePaths) {
      if (fsSync.existsSync(tryPath)) {
        myStoragePath = tryPath;
        break;
      }
    }
    
    if (!myStoragePath) {
      return res.status(404).json({ error: 'My Storage folder not found' });
    }
    
    // Get all files in my-storage
    const files = await fs.readdir(myStoragePath);
    const videoFiles = files.filter(f => {
      try {
        return fsSync.statSync(path.join(myStoragePath, f)).isFile() && 
               /\.(mp4|webm|mov|avi|m3u8)$/i.test(f);
      } catch {
        return false;
      }
    });
    
    console.log(`Found ${videoFiles.length} video files in my-storage`);
    
    // Get all cloudflare_key values from database
    const [dbResources] = await pool.execute(
      'SELECT cloudflare_key, file_name FROM cloudflare_resources'
    );
    
    const dbPaths = new Set();
    const dbFileNames = new Set();
    dbResources.forEach(resource => {
      if (resource.cloudflare_key) {
        const storagePath = resource.cloudflare_key.replace(/^cloudflare\//, 'my-storage/');
        dbPaths.add(path.basename(storagePath));
        dbPaths.add(storagePath);
      }
      if (resource.file_name) {
        dbFileNames.add(resource.file_name);
      }
    });
    
    console.log(`Found ${dbResources.length} resources in database`);
    
    // Find orphaned files (files without database entries)
    const orphanedFiles = [];
    for (const file of videoFiles) {
      const filePath = path.join(myStoragePath, file);
      const fileName = path.basename(file);
      
      // Check if file exists in database
      const existsInDb = dbPaths.has(fileName) || 
                        dbPaths.has(`my-storage/${fileName}`) ||
                        dbFileNames.has(fileName) ||
                        dbResources.some(r => {
                          const key = r.cloudflare_key?.replace(/^cloudflare\//, 'my-storage/');
                          return key && (key.endsWith(fileName) || path.basename(key) === fileName);
                        });
      
      if (!existsInDb) {
        orphanedFiles.push({
          fileName: file,
          filePath: filePath,
          size: fsSync.statSync(filePath).size
        });
      }
    }
    
    console.log(`Found ${orphanedFiles.length} orphaned files`);
    
    // Delete orphaned files if requested
    const { deleteFiles } = req.query;
    const deletedFiles = [];
    
    if (deleteFiles === 'true' || deleteFiles === '1') {
      for (const orphan of orphanedFiles) {
        try {
          await fs.unlink(orphan.filePath);
          deletedFiles.push(orphan.fileName);
          console.log(`✓ Deleted orphaned file: ${orphan.fileName}`);
        } catch (deleteError) {
          console.error(`Error deleting orphaned file ${orphan.fileName}:`, deleteError.message);
        }
      }
    }
    
    res.json({
      success: true,
      totalFiles: videoFiles.length,
      dbResources: dbResources.length,
      orphanedFiles: orphanedFiles.length,
      orphanedFilesList: orphanedFiles.map(f => ({
        fileName: f.fileName,
        size: formatFileSize(f.size)
      })),
      deletedFiles: deletedFiles.length,
      deletedFilesList: deletedFiles,
      message: deleteFiles === 'true' || deleteFiles === '1' 
        ? `Cleaned up ${deletedFiles.length} orphaned files`
        : `Found ${orphanedFiles.length} orphaned files. Add ?deleteFiles=true to delete them.`
    });
  } catch (error) {
    console.error('Error cleaning up orphaned files:', error);
    res.status(500).json({ error: 'Failed to cleanup orphaned files', message: error.message });
  }
}

/**
 * Helper function to format file size
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

