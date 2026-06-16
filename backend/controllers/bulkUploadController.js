import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import crypto from 'crypto';
import { generateVideoId, generateVideoPath } from '../utils/videoIdGenerator.js';
import { ensureDirectoryExists, getFileSize } from '../utils/fileUtils.js';
import * as videoService from '../services/videoService.js';
import * as redirectService from '../services/redirectService.js';
import * as qrCodeService from '../services/qrCodeService.js';
import * as thumbnailService from '../services/thumbnailService.js';
import pool from '../config/database.js';
import config from '../config/config.js';
import { getBaseUrl } from '../utils/urlHelper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get list of videos from misc folder
 */
export async function getMiscVideos(req, res) {
  console.log('[getMiscVideos] Request received');
  console.log('[getMiscVideos] User:', req.user);
  try {
    // Resolve upload path properly (handle both absolute and relative paths)
    const basePath = path.dirname(__dirname);
    const uploadPath = path.isAbsolute(config.upload.uploadPath) 
      ? config.upload.uploadPath 
      : path.resolve(basePath, config.upload.uploadPath);
    
    const miscPath = path.join(uploadPath, 'misc');
    
    console.log('Misc videos path resolution:', {
      basePath,
      configUploadPath: config.upload.uploadPath,
      resolvedUploadPath: uploadPath,
      resolvedMiscPath: miscPath,
      miscPathExists: fsSync.existsSync(miscPath)
    });
    
    // Check if misc folder exists
    if (!fsSync.existsSync(miscPath)) {
      console.warn(`Misc folder not found at: ${miscPath}`);
      return res.json({ 
        videos: [],
        message: `Misc folder not found at: ${miscPath}`,
        debug: {
          basePath,
          configUploadPath: config.upload.uploadPath,
          resolvedUploadPath: uploadPath,
          resolvedMiscPath: miscPath
        }
      });
    }

    // Read directory
    const files = await fs.readdir(miscPath);
    
    // Filter video files
    const videoExtensions = ['.mp4', '.webm', '.mov', '.avi'];
    const videos = [];
    
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (videoExtensions.includes(ext)) {
        const filePath = path.join(miscPath, file);
        
        try {
          const stats = await fs.stat(filePath);
          
          // Use absolute path for CSV - this is important for file path in CSV
          const absolutePath = path.resolve(filePath);
          // Also provide relative path for reference
          const relativePath = `misc/${file}`;
          
          videos.push({
            filename: file,
            path: absolutePath, // Absolute path for CSV
            relativePath: relativePath, // Relative path for reference
            size: stats.size,
            sizeFormatted: formatFileSize(stats.size),
            modified: stats.mtime
          });
        } catch (statError) {
          console.warn(`Failed to get stats for ${file}:`, statError.message);
          // Skip files that can't be accessed
        }
      }
    }

    // Sort by filename
    videos.sort((a, b) => a.filename.localeCompare(b.filename));

    console.log(`Found ${videos.length} video(s) in misc folder`);
    
    // Return videos with debug info in development
    const response = { videos };
    if (process.env.NODE_ENV === 'development') {
      response.debug = {
        basePath,
        configUploadPath: config.upload.uploadPath,
        resolvedUploadPath: uploadPath,
        resolvedMiscPath: miscPath,
        miscPathExists: fsSync.existsSync(miscPath)
      };
    }
    
    res.json(response);
  } catch (error) {
    console.error('Get misc videos error:', error);
    console.error('Error stack:', error.stack);
    
    // Return detailed error with path info
    const basePath = path.dirname(__dirname);
    const uploadPath = path.isAbsolute(config.upload.uploadPath) 
      ? config.upload.uploadPath 
      : path.resolve(basePath, config.upload.uploadPath);
    const miscPath = path.join(uploadPath, 'misc');
    
    res.status(500).json({ 
      error: 'Failed to fetch videos from misc folder',
      details: error.message,
      debug: {
        basePath,
        configUploadPath: config.upload.uploadPath,
        resolvedUploadPath: uploadPath,
        resolvedMiscPath: miscPath,
        miscPathExists: fsSync.existsSync(miscPath)
      },
      hint: 'Check server logs for path resolution details'
    });
  }
}

/**
 * Generate unique PartnerID
 */
function generatePartnerID(index = 0) {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `PARTNER_${timestamp}_${random}_${String(index + 1).padStart(3, '0')}`;
}

/**
 * Format file size
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Bulk upload videos from CSV file
 * CSV format should have columns:
 * ID, Title, Link/Path, Thumbnail Images, Tag 1, Tag 2
 */
export async function bulkUploadFromCSV(req, res) {
  const results = {
    total: 0,
    successful: 0,
    failed: 0,
    errors: []
  };

  let uploadHistoryId = null;
  const uploadedBy = req.user?.username || req.user?.id || 'unknown';

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'CSV file is required' });
    }

    // Create upload history record (only if table exists)
    try {
      const [historyResult] = await pool.execute(
        `INSERT INTO csv_upload_history 
         (file_name, file_size, status, uploaded_by) 
         VALUES (?, ?, 'processing', ?)`,
        [req.file.originalname, req.file.size, uploadedBy]
      );
      uploadHistoryId = historyResult.insertId;
    } catch (historyError) {
      if (historyError.code === 'ER_NO_SUCH_TABLE') {
        console.warn('csv_upload_history table does not exist. Skipping history tracking.');
        console.warn('Run migration: npm run migrate-csv-history');
      } else {
        console.warn('Failed to create upload history record:', historyError.message);
      }
      // Continue with upload even if history tracking fails
    }

    // Read and parse CSV file
    let csvContent;
    try {
      csvContent = await fs.readFile(req.file.path, 'utf-8');
    } catch (readError) {
      throw new Error(`Failed to read CSV file: ${readError.message}`);
    }
    
    // Parse CSV (using sync parse from csv-parse)
    let records;
    try {
      records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        skip_records_with_error: false
      });
      
      if (!Array.isArray(records) || records.length === 0) {
        throw new Error('CSV file is empty or has no valid rows. Please check the CSV format.');
      }
      
      // Log CSV structure for debugging
      console.log(`CSV parsed successfully. Found ${records.length} rows.`);
      if (records.length > 0) {
        const columns = Object.keys(records[0]);
        console.log('CSV columns found:', columns);
        console.log('CSV column count:', columns.length);
        
        // Check for required columns (new format)
        const requiredColumns = ['ID', 'Title', 'Link/Path'];
        const optionalColumns = ['Thumbnail Images', 'Tag 1', 'Tag 2'];
        const missingColumns = requiredColumns.filter(col => 
          !columns.some(c => c.toLowerCase().trim() === col.toLowerCase().trim())
        );
        
        if (missingColumns.length > 0) {
          console.warn('⚠ Missing required columns:', missingColumns);
          console.warn('Available columns:', columns);
          console.warn('Required columns:', requiredColumns);
          console.warn('Optional columns:', optionalColumns);
        }
        
        // Log first row sample with all data
        console.log('First row sample:', Object.keys(records[0]).reduce((acc, key) => {
          const value = records[0][key];
          acc[key] = value ? String(value).substring(0, 100) : '';
          return acc;
        }, {}));
        
        // Check for new CSV format columns
        const hasId = columns.some(c => c.toLowerCase().trim() === 'id');
        const hasTitle = columns.some(c => c.toLowerCase().trim() === 'title');
        const hasLinkPath = columns.some(c => 
          c.toLowerCase().trim() === 'link/path' || 
          c.toLowerCase().trim() === 'link path' ||
          (c.toLowerCase().includes('link') && c.toLowerCase().includes('path'))
        );
        
        if (hasId && hasTitle && hasLinkPath) {
          console.log(`✓ Found new CSV format columns: ID, Title, Link/Path`);
        } else {
          console.warn('⚠ CSV format check:');
          console.warn(`  ID column: ${hasId ? '✓' : '✗'}`);
          console.warn(`  Title column: ${hasTitle ? '✓' : '✗'}`);
          console.warn(`  Link/Path column: ${hasLinkPath ? '✓' : '✗'}`);
          console.warn('  Available columns:', columns);
        }
      }
    } catch (parseError) {
      console.error('CSV parsing error:', parseError);
      console.error('CSV content preview (first 500 chars):', csvContent.substring(0, 500));
      throw new Error(`Failed to parse CSV file: ${parseError.message}. Please ensure the CSV is properly formatted with headers.`);
    }

    results.total = records.length;

    console.log(`Processing ${results.total} videos from CSV...`);

    // Process each row
    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNumber = i + 2; // +2 because row 1 is header, and arrays are 0-indexed

      // Skip completely empty rows
      const rowKeys = Object.keys(row);
      const hasData = rowKeys.some(key => row[key] && String(row[key]).trim() !== '');
      if (!hasData) {
        console.log(`[Row ${rowNumber}] Skipping empty row`);
        continue;
      }

      // Initialize all variables OUTSIDE try block so they're accessible in catch
      let videoId = '';
      let title = '';
      let videoFilePath = '';
      let thumbnailFilePath = '';
      let tag1 = '';
      let tag2 = '';
      
      try {
        console.log(`[Row ${rowNumber}] Processing row with columns:`, rowKeys);
        // NEW CSV FORMAT: ID, Title, Link/Path, Thumbnail Images, Tag 1, Tag 2
        // Extract data from CSV row
        
        // Get ID (required) - use as videoId - check multiple possible column names
        videoId = row.ID || 
                  row.id || 
                  row['ID'] || 
                  row['Id'] ||
                  row['Video ID'] ||
                  row['video id'] ||
                  row['VideoID'] ||
                  '';
        
        // Get Title (optional - will auto-generate if missing) - check multiple possible column names
        // First try common column name variations
        title = row.Title || 
                row.title || 
                row['Title'] || 
                row['TITLE'] ||
                row['Name'] ||
                row['name'] ||
                row['Video Title'] ||
                row['video title'] ||
                row['VideoName'] ||
                row['videoname'] ||
                row['VIDEO TITLE'] ||
                row['Titile'] || // Common typo
                row['titile'] ||
                '';
        
        // If still not found, try to find any column that contains "title" or "name" (case-insensitive)
        if (!title || title.trim() === '') {
          const titleKey = Object.keys(row).find(key => {
            if (!key) return false;
            const keyLower = key.toLowerCase().trim();
            return (keyLower.includes('title') || keyLower.includes('name')) && 
                   row[key] && 
                   row[key].toString().trim() !== '';
          });
          if (titleKey) {
            title = row[titleKey].toString().trim();
            console.log(`[Row ${rowNumber}] Found title in column "${titleKey}": "${title}"`);
          }
        }
        
        // Get Link/Path (required) - comprehensive column name checking
        videoFilePath = row['Link/Path'] || 
                       row['Link/Path '] || 
                       row['link/path'] || 
                       row['LINK/PATH'] ||
                       row['Link Path'] ||
                       row['link path'] ||
                       row['Link'] || 
                       row['link'] || 
                       row['Path'] || 
                       row['path'] || 
                       row['URL'] || 
                       row['url'] || 
                       row['File'] ||
                       row['file'] ||
                       row['videoFilePath'] ||
                       row['filePath'] ||
                       row['sourcePath'] ||
                       row['Video File'] ||
                       row['video file'] ||
                       row['File Path'] ||
                       row['file path'] ||
                       '';
        
        // Auto-generate unique ID if missing (consistent with CSV generation logic)
        if (!videoId || videoId.trim() === '') {
          // Generate unique ID based on title, filename, or row number
          let idBase = '';
          
          // Priority 1: Use title as base (sanitized) - same as CSV generation
          if (title && title.trim() !== '') {
            idBase = title.trim()
              .replace(/[^a-zA-Z0-9\s]/g, '') // Remove special chars
              .replace(/\s+/g, '_') // Replace spaces with underscores
              .substring(0, 40); // Limit length (longer than before for better uniqueness)
          } 
          // Priority 2: Use filename from path as base
          else if (videoFilePath && videoFilePath.trim() !== '') {
            try {
              // Extract filename from path (handle both / and \ separators)
              const pathParts = videoFilePath.split('/').pop().split('\\').pop();
              idBase = pathParts.replace(/\.[^/.]+$/, '') // Remove extension
                .replace(/[^a-zA-Z0-9_-]/g, '_')
                .substring(0, 40);
            } catch {
              idBase = '';
            }
          }
          
          // Generate unique ID with timestamp, row number, and random component
          const timestamp = Date.now();
          const random = Math.random().toString(36).substring(2, 6).toUpperCase();
          const rowNum = String(rowNumber).padStart(3, '0');
          
          if (idBase && idBase.trim() !== '') {
            // Use base + row + random for uniqueness
            videoId = `${idBase}_${rowNum}_${random}`;
          } else {
            // Fallback: use VID prefix + row + timestamp + random
            videoId = `VID_${rowNum}_${timestamp}_${random}`;
          }
          
          // Ensure ID doesn't exceed 50 characters (database limit)
          if (videoId.length > 50) {
            videoId = videoId.substring(0, 50);
          }
          
          // Final sanitization to ensure valid characters only
          videoId = videoId.replace(/[^a-zA-Z0-9_-]/g, '_');
          
          console.log(`[Row ${rowNumber}] ⚠ ID was missing, auto-generated: ${videoId}`);
        } else {
          // Clean existing ID to ensure it's valid
          videoId = videoId.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
        }
        
        // Get Thumbnail Images (optional) - check multiple possible column names
        thumbnailFilePath = row['Thumbnail Images'] || 
                           row['Thumbnail Images '] || 
                           row['thumbnail images'] || 
                           row['THUMBNAIL IMAGES'] ||
                           row['Thumbnail'] || 
                           row['thumbnail'] || 
                           row['Thumbnail Image'] ||
                           row['thumbnail image'] ||
                           row['Thumb'] ||
                           row['thumb'] ||
                           '';
        
        // Get Tag 1 (optional) - check multiple possible column names
        tag1 = row['Tag 1'] || 
               row['tag 1'] || 
               row['TAG 1'] ||
               row['Tag1'] || 
               row['tag1'] || 
               row['TAG1'] ||
               row['Tag'] ||
               row['tag'] ||
               '';
        
        // Get Tag 2 (optional) - check multiple possible column names
        tag2 = row['Tag 2'] || 
               row['tag 2'] || 
               row['TAG 2'] ||
               row['Tag2'] || 
               row['tag2'] || 
               row['TAG2'] ||
               '';
        
        // Build description with tags
        let description = title || 'Video Resource';
        if (tag1 || tag2) {
          const tags = [tag1, tag2].filter(t => t && t.trim()).join(', ');
          description = `${description} | Tags: ${tags}`;
        }
        
        // Set defaults for optional fields
        const partnerId = null;
        const course = 'General';
        const grade = 'All';
        const lesson = '1';
        const module = '1';
        const activity = '1';
        const topic = tag1 || tag2 || title || 'Video'; // Use first tag or title as topic
        const language = 'en';

        // Clean and validate required fields
        videoId = (videoId || '').trim();
        title = (title || '').trim();
        videoFilePath = (videoFilePath || '').trim();
        
        // ID should already be generated if missing (handled above)
        // But double-check and generate if still missing
        if (!videoId || videoId === '') {
          // Last resort: generate a completely unique ID
          const timestamp = Date.now();
          const random = Math.random().toString(36).substring(2, 10).toUpperCase();
          const rowNum = String(rowNumber).padStart(3, '0');
          videoId = `AUTO_VID_${rowNum}_${timestamp}_${random}`;
          console.log(`[Row ${rowNumber}] ⚠ ID was still missing after generation attempt, created: ${videoId}`);
        }
        
        // Auto-generate title if missing (use filename or videoId as fallback)
        if (!title || title.trim() === '') {
          // Try to extract title from filename
          if (videoFilePath && videoFilePath.trim() !== '') {
            const fileName = path.basename(videoFilePath);
            const nameWithoutExt = fileName.replace(/\.[^/.]+$/, '');
            if (nameWithoutExt && nameWithoutExt.trim() !== '') {
              title = nameWithoutExt
                .replace(/[_-]/g, ' ') // Replace underscores and dashes with spaces
                .replace(/\s+/g, ' ') // Normalize spaces
                .trim();
              // Capitalize first letter of each word
              title = title.split(' ').map(word => 
                word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
              ).join(' ');
              console.log(`[Row ${rowNumber}] ⚠ Title was missing, auto-generated from filename: "${title}"`);
            }
          }
          
          // If still no title, use videoId as fallback
          if (!title || title.trim() === '') {
            if (videoId && videoId.trim() !== '') {
              title = videoId
                .replace(/[_-]/g, ' ') // Replace underscores and dashes with spaces
                .replace(/\s+/g, ' ') // Normalize spaces
                .trim();
              // Capitalize first letter of each word
              title = title.split(' ').map(word => 
                word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
              ).join(' ');
              console.log(`[Row ${rowNumber}] ⚠ Title was missing, auto-generated from videoId: "${title}"`);
            } else {
              // Last resort: use generic title
              title = `Video ${rowNumber}`;
              console.log(`[Row ${rowNumber}] ⚠ Title was missing, using generic title: "${title}"`);
            }
          }
        }
        
        if (!videoFilePath || videoFilePath === '') {
          results.failed++;
          results.errors.push({
            row: rowNumber,
            video: title || videoId || 'Unknown',
            message: 'Link/Path is required. Please provide a Link/Path in the CSV with the video file path or URL.',
            errorType: 'ValidationError',
            errorCode: 'MISSING_LINK_PATH'
          });
          console.error(`[Row ${rowNumber}] ✗ Missing required field: Link/Path`);
          continue; // Skip this row and continue with next
        }
        
        // Clean values
        videoId = videoId.trim();
        title = title.trim();
        videoFilePath = videoFilePath.trim();
        
        // Log extracted data for debugging
        console.log(`[Row ${rowNumber}] Extracted data:`, {
          videoId: videoId || 'N/A',
          title: title || 'N/A',
          videoFilePath: videoFilePath.substring(0, 100) + (videoFilePath.length > 100 ? '...' : ''),
          thumbnailFilePath: thumbnailFilePath || 'N/A',
          tag1: tag1 || 'N/A',
          tag2: tag2 || 'N/A',
          description: description || 'N/A'
        });

        // Clean the video file path
        videoFilePath = videoFilePath.trim();
        
        console.log(`[Row ${rowNumber}] Processing video file: ${videoFilePath.substring(0, 100)}...`);

        // Check if it's a Cloudflare URL or local file path
        const isCloudflareUrl = videoFilePath && (videoFilePath.startsWith('http://') || videoFilePath.startsWith('https://'));
        let fullVideoPath = null;
        let isRemoteFile = false;

        if (isCloudflareUrl) {
          // It's a Cloudflare URL - validate and use it directly
          try {
            // Validate URL format
            const urlObj = new URL(videoFilePath);
            console.log(`[Row ${rowNumber}] Validated URL: ${urlObj.href}`);
            
            // Check if it's a mock/test URL
            const isMockUrl = videoFilePath.includes('your-account.r2.cloudflarestorage.com') ||
                            videoFilePath.includes('r2.cloudflarestorage.com') ||
                            videoFilePath.includes('mock-cloudflare.example.com') ||
                            (videoFilePath.includes('example.com') && !videoFilePath.includes('pub-')) ||
                            videoFilePath.includes('test.cloudflare');
            
            if (isMockUrl) {
              console.warn(`[Row ${rowNumber}] ⚠ WARNING: Detected mock Cloudflare URL: ${videoFilePath}`);
              console.warn(`[Row ${rowNumber}] ⚠ This URL will be treated as a mock URL and may not be accessible.`);
              // Continue with mock URL - system will handle fallback to local files
            } else {
              console.log(`[Row ${rowNumber}] ✓ Valid Cloudflare URL detected: ${videoFilePath.substring(0, 80)}...`);
            }
            
            fullVideoPath = videoFilePath;
            isRemoteFile = true;
            console.log(`[Row ${rowNumber}] Detected Cloudflare URL: ${fullVideoPath}`);
            
            // Optional: Check if URL exists in cloudflare_resources table
            try {
              const [cloudflareResources] = await pool.execute(
                'SELECT * FROM cloudflare_resources WHERE cloudflare_url = ? LIMIT 1',
                [fullVideoPath]
              );
              if (cloudflareResources.length > 0) {
                console.log(`[Row ${rowNumber}] Found Cloudflare resource in database: ${cloudflareResources[0].file_name}`);
              } else {
                console.log(`[Row ${rowNumber}] Cloudflare URL not found in database, but proceeding with import`);
              }
            } catch (dbError) {
              console.warn(`[Row ${rowNumber}] Could not check Cloudflare resources table:`, dbError.message);
              // Continue anyway - URL might be valid even if not in our database
            }
          } catch (urlError) {
            const safeVideoFilePath = typeof videoFilePath !== 'undefined' ? videoFilePath : 'unknown';
            throw new Error(`Invalid URL format: ${safeVideoFilePath}`);
          }
        } else {
          // It's a local file path - check if it exists
          // Handle misc/ paths, my-storage/ paths, and other relative paths
          const backendDir = path.dirname(__dirname);
          const basePath = path.dirname(backendDir);
          let uploadPath = path.isAbsolute(config.upload.uploadPath) 
            ? config.upload.uploadPath 
            : path.resolve(basePath, config.upload.uploadPath);
          
          // Try multiple possible my-storage paths (handle nested video-storage/video-storage structure)
          // Files are actually stored at: uploadPath/my-storage (which resolves to video-storage/video-storage/my-storage)
          const possibleMyStoragePaths = [
            path.join(uploadPath, 'my-storage'), // First: uploadPath/my-storage (where files are actually stored)
            path.join(basePath, 'video-storage', 'my-storage'), // Second: basePath/video-storage/my-storage (nested)
            path.join(basePath, 'my-storage'), // Third: basePath/my-storage (fallback)
            // Also try with double nested structure
            path.join(basePath, 'video-storage', 'video-storage', 'my-storage'), // Double nested
            path.join(uploadPath, 'video-storage', 'my-storage'), // Alternative nested
          ];
          
          // Extract videoId from my-storage path if present (for CSV re-upload)
          if (videoFilePath.startsWith('my-storage/') || videoFilePath.startsWith('my-storage\\')) {
            const fileNameOnly = videoFilePath.replace(/^my-storage[\/\\]/, '');
            // Extract videoId from filename (handle both _master and master_master patterns)
            const myStorageMatch = fileNameOnly.match(/^([^_]+(?:_[^_]+)*?)(?:master|_master|_v\d+_master)?(?:_master)?\./);
            if (myStorageMatch) {
              let extractedVideoId = myStorageMatch[1];
              // Remove any trailing _master that might be in the extracted ID
              extractedVideoId = extractedVideoId.replace(/_master$/, '');
              // Update videoId if it was extracted from path
              if (extractedVideoId && extractedVideoId.trim() !== '') {
                console.log(`[Row ${rowNumber}] Extracted videoId "${extractedVideoId}" from my-storage path`);
                videoId = extractedVideoId;
              }
            }
          }
          
          if (path.isAbsolute(videoFilePath)) {
            fullVideoPath = videoFilePath;
          } else {
            // Handle my-storage/ paths (from CSV generation)
            if (videoFilePath.startsWith('my-storage/') || videoFilePath.startsWith('my-storage\\')) {
              const fileNameOnly = videoFilePath.replace(/^my-storage[\/\\]/, '');
              let tryPath = null;
              let foundMyStoragePath = null;
              
              // First, try to find the file in database to get actual path
              try {
                const [dbResources] = await pool.execute(
                  'SELECT cloudflare_key FROM cloudflare_resources WHERE cloudflare_key LIKE ? OR cloudflare_key LIKE ? LIMIT 1',
                  [`%${fileNameOnly}`, `%${fileNameOnly.replace(/master_master\./, '_master.')}`]
                );
                
                if (dbResources.length > 0) {
                  const dbPath = dbResources[0].cloudflare_key;
                  // Try to resolve the database path
                  const dbStoragePath = dbPath.replace(/^cloudflare\//, 'my-storage/');
                  for (const myStoragePath of possibleMyStoragePaths) {
                    const dbFullPath = path.join(myStoragePath, path.basename(dbStoragePath));
                    if (fsSync.existsSync(dbFullPath)) {
                      tryPath = dbFullPath;
                      foundMyStoragePath = myStoragePath;
                      console.log(`[Row ${rowNumber}] ✓ Found file from database path: ${tryPath}`);
                      break;
                    }
                  }
                }
              } catch (dbError) {
                console.warn(`[Row ${rowNumber}] Could not query database for file path:`, dbError.message);
              }
              
              // If not found via database, try all possible my-storage paths
              if (!tryPath) {
                for (const myStoragePath of possibleMyStoragePaths) {
                  if (!fsSync.existsSync(myStoragePath)) {
                    console.log(`[Row ${rowNumber}] Path does not exist, skipping: ${myStoragePath}`);
                    continue; // Skip if path doesn't exist
                  }
                  
                  let testPath = path.join(myStoragePath, fileNameOnly);
                  
                  // Try exact match first
                  if (fsSync.existsSync(testPath)) {
                    tryPath = testPath;
                    foundMyStoragePath = myStoragePath;
                    console.log(`[Row ${rowNumber}] ✓ Found file at: ${tryPath}`);
                    break;
                  }
                  
                  // Try without double _master (e.g., VID123master_master.mp4 -> VID123_master.mp4)
                  const withoutDoubleMaster = fileNameOnly.replace(/master_master\./, '_master.');
                  if (withoutDoubleMaster !== fileNameOnly) {
                    testPath = path.join(myStoragePath, withoutDoubleMaster);
                    if (fsSync.existsSync(testPath)) {
                      tryPath = testPath;
                      foundMyStoragePath = myStoragePath;
                      console.log(`[Row ${rowNumber}] ✓ Found file with corrected name: ${withoutDoubleMaster}`);
                      break;
                    }
                  }
                  
                  // Try to find any file that matches the videoId pattern
                  if (!tryPath && videoId) {
                    try {
                      const files = await fs.readdir(myStoragePath);
                      const cleanVideoId = videoId.replace(/_/g, '').toLowerCase();
                      const matchingFile = files.find(f => {
                        const fileLower = f.toLowerCase();
                        // Match by videoId numbers (e.g., 1764744958380)
                        const videoIdNumbers = cleanVideoId.match(/\d+/);
                        if (videoIdNumbers && fileLower.includes(videoIdNumbers[0])) {
                          return true;
                        }
                        // Or match by full videoId pattern
                        return fileLower.includes(cleanVideoId) || 
                               fileLower.includes(videoId.toLowerCase().replace(/_/g, ''));
                      });
                      if (matchingFile) {
                        tryPath = path.join(myStoragePath, matchingFile);
                        foundMyStoragePath = myStoragePath;
                        console.log(`[Row ${rowNumber}] ✓ Found matching file by videoId: ${matchingFile}`);
                        // Extract correct videoId from found filename
                        const foundMatch = matchingFile.match(/^([^_]+(?:_[^_]+)*?)(?:master|_master|_v\d+_master)?(?:_master)?\./);
                        if (foundMatch) {
                          let extractedId = foundMatch[1].replace(/_master$/, '').replace(/master$/, '');
                          // Normalize: VID1764744958380 -> VID_1764744958380
                          const vidNumberMatch = extractedId.match(/^VID(\d+)/);
                          if (vidNumberMatch) {
                            extractedId = `VID_${vidNumberMatch[1]}`;
                          }
                          if (extractedId && extractedId.trim() !== '') {
                            videoId = extractedId;
                            console.log(`[Row ${rowNumber}] Updated videoId from found file: ${videoId}`);
                          }
                        }
                        break;
                      }
                    } catch (dirError) {
                      console.warn(`[Row ${rowNumber}] Could not read my-storage directory ${myStoragePath}:`, dirError.message);
                    }
                  }
                }
              }
              
              if (tryPath && foundMyStoragePath) {
                fullVideoPath = tryPath;
                // Update uploadPath to match found location for consistency
                uploadPath = path.dirname(foundMyStoragePath);
                console.log(`[Row ${rowNumber}] ✓ Using file from: ${fullVideoPath}`);
              } else {
                // If not found, use default path for error reporting
                fullVideoPath = path.join(possibleMyStoragePaths[0], fileNameOnly);
                console.log(`[Row ${rowNumber}] ⚠ File not found, will try: ${fullVideoPath}`);
                console.log(`[Row ${rowNumber}] ⚠ Searched in paths:`, possibleMyStoragePaths);
              }
            }
            // Handle misc/ paths
            else if (videoFilePath.startsWith('misc/') || videoFilePath.startsWith('misc\\')) {
              // Try multiple possible paths for misc folder
              const possibleMiscPaths = [
                path.join(basePath, 'video-storage', 'misc'), // First: basePath/video-storage/misc
                path.join(uploadPath, 'misc'), // Second: uploadPath/misc (default)
                path.join(basePath, 'misc'), // Third: basePath/misc (fallback)
              ];
              
              const fileNameOnly = videoFilePath.replace(/^misc[\/\\]/, '');
              let foundPath = null;
              
              for (const miscPath of possibleMiscPaths) {
                const tryPath = path.join(miscPath, fileNameOnly);
                if (fsSync.existsSync(tryPath)) {
                  foundPath = tryPath;
                  console.log(`[Row ${rowNumber}] ✓ Found file at: ${foundPath}`);
                  break;
                }
              }
              
              if (foundPath) {
                fullVideoPath = foundPath;
              } else {
                // Try relative to project root
                fullVideoPath = path.resolve(basePath, videoFilePath);
                if (!fsSync.existsSync(fullVideoPath)) {
                  // Try relative to upload path
                  fullVideoPath = path.resolve(uploadPath, videoFilePath);
                }
              }
            } else {
              // Try relative to project root, then relative to upload path
              const projectRoot = path.join(__dirname, '../..');
              fullVideoPath = path.resolve(projectRoot, videoFilePath);
              
              // If not found, try relative to upload path
              if (!fsSync.existsSync(fullVideoPath)) {
                fullVideoPath = path.resolve(uploadPath, videoFilePath);
              }
            }
          }

          // Final check: if file still not found, try comprehensive search in ALL possible my-storage paths
          if (!fsSync.existsSync(fullVideoPath) && videoFilePath.startsWith('my-storage/')) {
            const fileNameOnly = videoFilePath.replace(/^my-storage[\/\\]/, '');
            console.log(`[Row ${rowNumber}] ⚠ File not found, starting comprehensive search for: ${fileNameOnly}`);
            console.log(`[Row ${rowNumber}]   Searching in ${possibleMyStoragePaths.length} possible paths...`);
            
            // Also add more possible paths by checking parent directories
            const additionalPaths = [];
            // Check if basePath has nested video-storage
            const nestedPath1 = path.join(basePath, 'video-storage', 'video-storage', 'my-storage');
            if (!possibleMyStoragePaths.includes(nestedPath1)) {
              additionalPaths.push(nestedPath1);
            }
            // Check uploadPath parent
            const uploadPathParent = path.dirname(uploadPath);
            const nestedPath2 = path.join(uploadPathParent, 'video-storage', 'my-storage');
            if (!possibleMyStoragePaths.includes(nestedPath2)) {
              additionalPaths.push(nestedPath2);
            }
            
            const allPathsToCheck = [...possibleMyStoragePaths, ...additionalPaths];
            
            for (const myStoragePath of allPathsToCheck) {
              if (!fsSync.existsSync(myStoragePath)) {
                console.log(`[Row ${rowNumber}]   Path does not exist: ${myStoragePath}`);
                continue;
              }
              
              console.log(`[Row ${rowNumber}]   Checking: ${myStoragePath}`);
              
              try {
                const files = await fs.readdir(myStoragePath);
                console.log(`[Row ${rowNumber}]     Found ${files.length} files in directory`);
                
                // First try exact filename match (case-insensitive)
                const exactMatch = files.find(f => f.toLowerCase() === fileNameOnly.toLowerCase());
                if (exactMatch) {
                  fullVideoPath = path.join(myStoragePath, exactMatch);
                  uploadPath = path.dirname(myStoragePath);
                  console.log(`[Row ${rowNumber}] ✓✓✓ FOUND EXACT MATCH: ${fullVideoPath}`);
                  break;
                }
                
                // Try to find file by videoId (handle variations with/without underscores)
                const cleanVideoIdForSearch = videoId ? videoId.replace(/_/g, '').toLowerCase() : '';
                const matchingFile = files.find(f => {
                  const fileLower = f.toLowerCase();
                  // Match by videoId number pattern (e.g., 1764744958380)
                  if (cleanVideoIdForSearch) {
                    const videoIdNumbers = cleanVideoIdForSearch.match(/\d+/);
                    if (videoIdNumbers && fileLower.includes(videoIdNumbers[0])) {
                      return true;
                    }
                    // Or match by full videoId (without underscores)
                    return fileLower.includes(cleanVideoIdForSearch) || 
                           fileLower.includes((videoId || '').toLowerCase().replace(/_/g, ''));
                  }
                  // Fallback: match by filename pattern
                  return fileLower.includes(fileNameOnly.toLowerCase().replace(/master_master\./, ''));
                });
                
                if (matchingFile) {
                  fullVideoPath = path.join(myStoragePath, matchingFile);
                  uploadPath = path.dirname(myStoragePath);
                  console.log(`[Row ${rowNumber}] ✓✓✓ FOUND MATCHING FILE: ${fullVideoPath}`);
                  // Extract correct videoId from found filename
                  const foundMatch = matchingFile.match(/^([^_]+(?:_[^_]+)*?)(?:master|_master|_v\d+_master)?(?:_master)?\./);
                  if (foundMatch) {
                    let extractedId = foundMatch[1].replace(/_master$/, '').replace(/master$/, '');
                    // Normalize: VID1764744958380 -> VID_1764744958380
                    const vidNumberMatch = extractedId.match(/^VID(\d+)/);
                    if (vidNumberMatch) {
                      extractedId = `VID_${vidNumberMatch[1]}`;
                    }
                    if (extractedId && extractedId.trim() !== '') {
                      videoId = extractedId;
                      console.log(`[Row ${rowNumber}] Updated videoId from found file: ${videoId}`);
                    }
                  }
                  break;
                }
              } catch (searchError) {
                console.warn(`[Row ${rowNumber}] Could not search my-storage directory ${myStoragePath}:`, searchError.message);
              }
            }
          }
          
          if (!fsSync.existsSync(fullVideoPath)) {
            // Provide detailed error with all tried paths
            const triedPaths = [];
            
            if (videoFilePath.startsWith('my-storage/')) {
              const fileNameOnly = videoFilePath.replace(/^my-storage[\/\\]/, '');
              for (const myStoragePath of possibleMyStoragePaths) {
                triedPaths.push(path.join(myStoragePath, fileNameOnly));
              }
            } else if (videoFilePath.startsWith('misc/')) {
              triedPaths.push(
                path.join(basePath, 'video-storage', 'misc', videoFilePath.replace('misc/', '')),
                path.join(uploadPath, 'misc', videoFilePath.replace('misc/', '')),
                path.join(basePath, 'misc', videoFilePath.replace('misc/', ''))
              );
            } else {
              triedPaths.push(
                path.isAbsolute(videoFilePath) ? videoFilePath : path.resolve(basePath, videoFilePath),
                path.resolve(uploadPath, videoFilePath)
              );
            }
            
            throw new Error(`Video file not found: ${videoFilePath}. Tried paths: ${triedPaths.join(', ')}`);
          }
        }

        // Check file extension (for both local files and URLs)
        let ext;
        if (isRemoteFile) {
          // For URLs, extract extension from URL
          try {
            const urlPath = new URL(fullVideoPath).pathname;
            ext = path.extname(urlPath).toLowerCase();
          } catch {
            // If URL parsing fails, try to extract from pathname directly
            ext = path.extname(fullVideoPath).toLowerCase();
          }
        } else {
          ext = path.extname(fullVideoPath).toLowerCase();
        }
        
        if (ext && !['.mp4', '.webm', '.mov', '.avi', '.m3u8'].includes(ext)) {
          throw new Error(`Invalid video file type: ${ext}. Only MP4, WebM, MOV, AVI, and M3U8 are allowed.`);
        }

        // Use ID from CSV as videoId (clean it to be safe)
        // IMPORTANT: Remove _master suffix if present (from CSV generation)
        // This prevents double _master in filename (e.g., VID_123_master_master.mp4)
        let cleanVideoId = videoId;
        
        // Remove _master suffix if present
        cleanVideoId = cleanVideoId.replace(/_master$/, '');
        // Remove version suffix if present (e.g., _v02)
        cleanVideoId = cleanVideoId.replace(/_v\d+$/, '');
        // Remove any special characters and ensure it's valid
        cleanVideoId = cleanVideoId.replace(/[^a-zA-Z0-9_-]/g, '_');
        if (cleanVideoId.length > 50) {
          cleanVideoId = cleanVideoId.substring(0, 50);
        }
        videoId = cleanVideoId;
        
        console.log(`[Row ${rowNumber}] Using video ID from CSV: ${videoId} (cleaned from original)`);
        
        // CRITICAL: Check if video already exists in VIDEOS table ONLY
        // CSV uploads should ONLY check videos table (not cloudflare_resources)
        // Manual uploads to My Storage go to cloudflare_resources only
        // CSV uploads create entries in BOTH videos and cloudflare_resources
        // But we only check videos table for duplicates to avoid false positives
        
        // Check videos table by videoId
        const existingVideoInVideos = await videoService.getVideoByVideoId(videoId, true);
        if (existingVideoInVideos) {
          // SKIP duplicate - video already exists in videos table
          const safeVideoId = typeof videoId !== 'undefined' ? videoId : 'N/A';
          const safeTitle = typeof title !== 'undefined' ? title : 'Untitled Video';
          results.failed++;
          results.errors.push({
            row: rowNumber,
            video: safeTitle,
            message: `Video with ID "${videoId}" already exists in Videos section. Skipping duplicate.`,
            errorType: 'DuplicateResource',
            errorCode: 'DUPLICATE_RESOURCE',
            videoId: safeVideoId,
            title: safeTitle,
            videoFilePath: typeof videoFilePath !== 'undefined' ? videoFilePath : 'N/A'
          });
          console.log(`[Row ${rowNumber}] ⏭️ SKIPPED: Video with ID "${videoId}" already exists in videos table. Skipping duplicate.`);
          continue; // Skip to next row - don't process this video
        }
        
        // NOTE: We do NOT check cloudflare_resources table here
        // Manual uploads to My Storage are stored in cloudflare_resources only
        // CSV uploads should create entries in BOTH videos and cloudflare_resources
        // So we only check videos table to determine if it's a duplicate
        
        // Store original videoId
        const originalVideoId = videoId;
        
        // Get latest version (needed for both local and remote files)
        let latestVersion = await videoService.getLatestVersion(videoId).catch(() => 1);
        if (typeof latestVersion !== 'number' || latestVersion < 1) {
          latestVersion = 1;
        }

        let streamingUrl = null;
        let relativePath = null;
        let size = 0;
        let targetFilePath = null;

        if (isRemoteFile) {
          // For remote URLs, also check by file_path in videos table
          // (videoId already checked above, but check file_path too)
          try {
            const [videosByUrl] = await pool.execute(
              'SELECT * FROM videos WHERE file_path = ? AND status = "active" LIMIT 1',
              [fullVideoPath]
            );
            if (videosByUrl.length > 0) {
              // SKIP duplicate - file path already exists in videos table
              const safeVideoId = typeof videoId !== 'undefined' ? videoId : 'N/A';
              const safeTitle = typeof title !== 'undefined' ? title : 'Untitled Video';
              results.failed++;
              results.errors.push({
                row: rowNumber,
                video: safeTitle,
                message: `Video already exists with this URL (ID: ${videosByUrl[0].video_id}). Skipping duplicate.`,
                errorType: 'DuplicateResource',
                errorCode: 'DUPLICATE_RESOURCE',
                videoId: safeVideoId,
                title: safeTitle,
                videoFilePath: typeof videoFilePath !== 'undefined' ? videoFilePath : 'N/A'
              });
              console.log(`[Row ${rowNumber}] ⏭️ SKIPPED: Video with source URL "${fullVideoPath.substring(0, 80)}..." already exists in videos table (ID: ${videosByUrl[0].video_id}). Skipping duplicate.`);
              continue; // Skip to next row
            }
          } catch (checkError) {
            console.warn(`[Row ${rowNumber}] Error checking for existing URL:`, checkError.message);
          }
          
          console.log(`[Row ${rowNumber}] ✓ New source URL detected: ${fullVideoPath.substring(0, 80)}...`);
          console.log(`[Row ${rowNumber}] ✓ This URL will be treated as a NEW resource`);
          
          // For remote URLs, store the source URL in file_path
          // Generate a localhost streaming URL for playback
          const redirectSlug = await redirectService.generateUniqueShortId();
          streamingUrl = `${getBaseUrl(req)}/api/s/${redirectSlug}`;
          
          // Store the actual source URL in relativePath (file_path in database)
          relativePath = fullVideoPath; // This is the actual source URL
          
          // Create a reference path for my-storage (even though file is remote)
          // Extract filename from URL for My Storage path
          let urlFileName;
          try {
            const urlObj = new URL(fullVideoPath);
            urlFileName = path.basename(urlObj.pathname) || `${videoId}_master.mp4`;
          } catch {
            // If URL parsing fails, use videoId
            urlFileName = `${videoId}_master.mp4`;
          }
          
          // Try to get file size from cloudflare_resources table if available
          try {
            const [resources] = await pool.execute(
              'SELECT file_size FROM cloudflare_resources WHERE cloudflare_url = ? OR cloudflare_key LIKE ? LIMIT 1',
              [fullVideoPath, `%${urlFileName}%`]
            );
            if (resources.length > 0 && resources[0].file_size) {
              size = resources[0].file_size;
              console.log(`[Row ${rowNumber}] Found file size from Cloudflare resource: ${size} bytes`);
            } else {
              size = 0;
              console.log(`[Row ${rowNumber}] File size not available, using 0`);
            }
          } catch (dbError) {
            console.warn(`[Row ${rowNumber}] Could not get file size from database:`, dbError.message);
            size = 0;
          }
          
          console.log(`[Row ${rowNumber}] ✓ Source URL: ${fullVideoPath.substring(0, 80)}...`);
          console.log(`[Row ${rowNumber}] ✓ Streaming URL: ${streamingUrl}`);
          console.log(`[Row ${rowNumber}] ✓ File path (stored): ${relativePath.substring(0, 80)}...`);
        } else {
          // For local files, check if file_path already exists in videos table
          // (videoId already checked above, but check file_path too)
          try {
            const [videosByPath] = await pool.execute(
              'SELECT * FROM videos WHERE file_path = ? AND status = "active" LIMIT 1',
              [fullVideoPath]
            );
            if (videosByPath.length > 0) {
              // SKIP duplicate - file path already exists in videos table
              const safeVideoId = typeof videoId !== 'undefined' ? videoId : 'N/A';
              const safeTitle = typeof title !== 'undefined' ? title : 'Untitled Video';
              results.failed++;
              results.errors.push({
                row: rowNumber,
                video: safeTitle,
                message: `Video already exists with this file path (ID: ${videosByPath[0].video_id}). Skipping duplicate.`,
                errorType: 'DuplicateResource',
                errorCode: 'DUPLICATE_RESOURCE',
                videoId: safeVideoId,
                title: safeTitle,
                videoFilePath: typeof videoFilePath !== 'undefined' ? videoFilePath : 'N/A'
              });
              console.log(`[Row ${rowNumber}] ⏭️ SKIPPED: Video with source file "${fullVideoPath}" already exists in videos table (ID: ${videosByPath[0].video_id}). Skipping duplicate.`);
              continue; // Skip to next row
            }
          } catch (err) {
            console.warn(`[Row ${rowNumber}] Error checking for existing file:`, err.message);
          }
          
          // For local files, copy to backend/upload folder (same as regular upload)
          const backendDir = path.dirname(__dirname);
          const basePath = path.dirname(backendDir);
          
          // Create upload directory (backend/upload)
          const uploadDir = path.join(backendDir, 'upload');
          await ensureDirectoryExists(uploadDir);
          
          // Generate unique filename using videoId (same format as regular upload)
          const originalFileName = path.basename(fullVideoPath);
          const fileExtension = path.extname(originalFileName) || '.mp4';
          const fileName = `${videoId}${fileExtension}`;
          targetFilePath = path.join(uploadDir, fileName);
          
          // Relative path from backend folder (for database)
          relativePath = `upload/${fileName}`;
          
          console.log(`[Row ${rowNumber}] Saving to upload folder: ${targetFilePath}`);
          console.log(`[Row ${rowNumber}] Relative path: ${relativePath}`);
          
          // Check if relativePath (file_path) is already used in videos table
          // Also check cloudflare_resources by the actual file path that will be stored
          // This catches duplicates from manual uploads to My Storage
          if (relativePath) {
            // Check by file_path in videos table
            const [videosByPath] = await pool.execute(
              'SELECT * FROM videos WHERE file_path = ? AND status = "active" LIMIT 1',
              [relativePath]
            );
            if (videosByPath.length > 0) {
              // SKIP duplicate - file path already exists in videos table
              const safeVideoId = typeof videoId !== 'undefined' ? videoId : 'N/A';
              const safeTitle = typeof title !== 'undefined' ? title : 'Untitled Video';
              results.failed++;
              results.errors.push({
                row: rowNumber,
                video: safeTitle,
                message: `Video file path already exists in videos table (ID: ${videosByPath[0].video_id}). Skipping duplicate.`,
                errorType: 'DuplicateResource',
                errorCode: 'DUPLICATE_RESOURCE',
                videoId: safeVideoId,
                title: safeTitle,
                videoFilePath: typeof videoFilePath !== 'undefined' ? videoFilePath : 'N/A'
              });
              console.log(`[Row ${rowNumber}] ⏭️ SKIPPED: File path already exists in videos table. Skipping duplicate.`);
              continue; // Skip to next row
            }
            
            // NOTE: We do NOT check cloudflare_resources table here
            // CSV uploads should only check videos table for duplicates
            // Manual uploads to My Storage are separate and don't prevent CSV uploads
          }

          // Copy video file to backend/upload/ folder (only if target doesn't exist or is different)
          // If file is already in upload/ at the target location, use it directly
          if (fullVideoPath === targetFilePath) {
            // File is already at target location, use it directly
            console.log(`[Row ${rowNumber}] ✓ File already at target location: ${targetFilePath}`);
          } else if (!fsSync.existsSync(targetFilePath)) {
            // File needs to be copied to backend/upload/
            await fs.copyFile(fullVideoPath, targetFilePath);
            console.log(`[Row ${rowNumber}] ✓ Copied video file to backend/upload/: ${targetFilePath}`);
          } else {
            // Target file already exists in upload/, use it
            console.log(`[Row ${rowNumber}] ✓ Target file already exists in backend/upload/: ${targetFilePath}`);
            // Update fullVideoPath to use the existing target file
            fullVideoPath = targetFilePath;
          }

          // Get file size
          size = await getFileSize(targetFilePath);
        }

        // Generate unique redirect slug (short URL) - same as regular upload
        const { generateUniqueShortId } = await import('../utils/shortUrlGenerator.js');
        let redirectSlug;
        try {
          redirectSlug = await generateUniqueShortId();
          console.log(`[Row ${rowNumber}] ✓ Generated unique redirect slug: ${redirectSlug}`);
        } catch (slugError) {
          console.warn(`[Row ${rowNumber}] Failed to generate unique slug, using videoId:`, slugError.message);
          redirectSlug = videoId; // Fallback to videoId
        }
        
        // Build streaming URL using redirect slug
        streamingUrl = `${getBaseUrl(req)}/api/s/${redirectSlug}`;
        const redirectUrl = `${config.urls.frontend}/stream/${videoId}`;

        // Create redirect entry
        let redirectResult;
        let shortUrl = redirectUrl;
        let shortSlug = redirectSlug;
        try {
          redirectResult = await redirectService.createRedirect(redirectSlug, redirectUrl, false);
          shortUrl = redirectResult.shortUrl || redirectUrl;
          shortSlug = redirectResult.shortSlug || redirectSlug;
          console.log(`[Row ${rowNumber}] ✓ Created redirect with slug: ${shortSlug}`);
        } catch (redirectError) {
          console.warn(`[Row ${rowNumber}] Failed to create redirect, using generated slug:`, redirectError.message);
          shortSlug = redirectSlug;
          shortUrl = redirectUrl;
        }
        
        // Ensure shortSlug is never null or empty (required field)
        if (!shortSlug || shortSlug.trim() === '') {
          console.error(`[Row ${rowNumber}] CRITICAL: redirect_slug is empty! Using videoId as fallback.`);
          shortSlug = videoId;
        }

        // Generate QR code with short URL
        let qrUrl = null;
        try {
          qrUrl = await qrCodeService.generateQRCode(videoId, shortUrl);
        } catch (qrError) {
          console.warn(`[Row ${rowNumber}] Failed to generate QR code:`, qrError.message);
          // Continue without QR code
        }

        // Handle thumbnail from CSV - supports URLs, local paths, and files in thumbnails folder
        // IMPORTANT: Always save thumbnails with videoId as filename for consistency
        let thumbnailUrl = null;
        try {
          if (thumbnailFilePath && thumbnailFilePath.trim() !== '') {
            console.log(`[Row ${rowNumber}] Processing thumbnail: ${thumbnailFilePath}`);
            // Check if it's a URL
            if (thumbnailFilePath.startsWith('http://') || thumbnailFilePath.startsWith('https://')) {
              // It's a URL - use it directly (no file to save)
              thumbnailUrl = thumbnailFilePath;
              console.log(`[Row ${rowNumber}] ✓ Using thumbnail URL: ${thumbnailUrl}`);
            } else {
              // It's a local file path - we need to find and copy it with videoId as filename
              let resolvedThumbnailPath = null;
              const thumbnailsDir = path.join(__dirname, '../../video-storage/thumbnails');
              
              // Strategy 1: Check if it's an absolute path
              if (path.isAbsolute(thumbnailFilePath)) {
                if (fsSync.existsSync(thumbnailFilePath)) {
                  resolvedThumbnailPath = thumbnailFilePath;
                  console.log(`[Row ${rowNumber}] ✓ Found thumbnail at absolute path: ${resolvedThumbnailPath}`);
                }
              } else {
                // Strategy 2: Handle paths starting with /thumbnails/ or thumbnails/
                if (thumbnailFilePath.startsWith('/thumbnails/') || thumbnailFilePath.toLowerCase().startsWith('thumbnails/')) {
                  const thumbnailName = path.basename(thumbnailFilePath);
                  const possiblePath = path.join(thumbnailsDir, thumbnailName);
                  if (fsSync.existsSync(possiblePath)) {
                    resolvedThumbnailPath = possiblePath;
                    console.log(`[Row ${rowNumber}] ✓ Found thumbnail in thumbnails folder: ${resolvedThumbnailPath}`);
                  }
                }
                
                // Strategy 3: Try relative to project root
                if (!resolvedThumbnailPath) {
                  const projectRoot = path.join(__dirname, '../../');
                  const relativePath = path.resolve(projectRoot, thumbnailFilePath);
                  if (fsSync.existsSync(relativePath)) {
                    resolvedThumbnailPath = relativePath;
                    console.log(`[Row ${rowNumber}] ✓ Found thumbnail relative to project root: ${resolvedThumbnailPath}`);
                  }
                }
                
                // Strategy 4: Try in thumbnails folder with just filename
                if (!resolvedThumbnailPath) {
                  const thumbnailName = path.basename(thumbnailFilePath);
                  const thumbnailsPath = path.join(thumbnailsDir, thumbnailName);
                  if (fsSync.existsSync(thumbnailsPath)) {
                    resolvedThumbnailPath = thumbnailsPath;
                    console.log(`[Row ${rowNumber}] ✓ Found thumbnail by filename in thumbnails folder: ${resolvedThumbnailPath}`);
                  }
                }
                
                // Strategy 5: Try with full path in thumbnails folder
                if (!resolvedThumbnailPath) {
                  const possiblePath2 = path.join(thumbnailsDir, thumbnailFilePath);
                  if (fsSync.existsSync(possiblePath2)) {
                    resolvedThumbnailPath = possiblePath2;
                    console.log(`[Row ${rowNumber}] ✓ Found thumbnail with full path in thumbnails folder: ${resolvedThumbnailPath}`);
                  }
                }
              }
              
              // If we found a local file, save it using the thumbnail service with videoId as filename
              if (resolvedThumbnailPath) {
                const thumbnailExt = path.extname(resolvedThumbnailPath).toLowerCase();
                if (['.jpg', '.jpeg', '.png', '.webp'].includes(thumbnailExt)) {
                  try {
                    // Read the file and save it with videoId as filename
                    const thumbnailBuffer = await fs.readFile(resolvedThumbnailPath);
                    const thumbnailFile = {
                      buffer: thumbnailBuffer,
                      originalname: `${videoId}${thumbnailExt}`, // Use videoId as filename
                      mimetype: thumbnailExt === '.png' ? 'image/png' : 
                               thumbnailExt === '.webp' ? 'image/webp' : 'image/jpeg'
                    };
                    thumbnailUrl = await thumbnailService.saveUploadedThumbnail(thumbnailFile, videoId);
                    console.log(`[Row ${rowNumber}] ✓ Thumbnail saved from CSV: ${resolvedThumbnailPath} -> ${thumbnailUrl}`);
                    console.log(`[Row ${rowNumber}] ✓ Thumbnail saved with videoId: ${videoId}, URL: ${thumbnailUrl}`);
                  } catch (saveError) {
                    console.warn(`[Row ${rowNumber}] ⚠ Failed to save thumbnail from ${resolvedThumbnailPath}:`, saveError.message);
                    // Fallback: try direct copy
                    try {
                      const finalExt = thumbnailExt || '.jpg';
                      const targetThumbnailPath = path.join(thumbnailsDir, `${videoId}${finalExt}`);
                      await fs.copyFile(resolvedThumbnailPath, targetThumbnailPath);
                      thumbnailUrl = `/thumbnails/${videoId}${finalExt}`;
                      console.log(`[Row ${rowNumber}] ✓ Thumbnail copied directly: ${thumbnailUrl}`);
                    } catch (copyError) {
                      console.warn(`[Row ${rowNumber}] ⚠ Failed to copy thumbnail directly:`, copyError.message);
                    }
                  }
                } else {
                  console.warn(`[Row ${rowNumber}] ⚠ Invalid thumbnail extension: ${thumbnailExt}`);
                }
              } else {
                console.warn(`[Row ${rowNumber}] ⚠ Thumbnail file not found: ${thumbnailFilePath}`);
                console.warn(`[Row ${rowNumber}]   Searched in thumbnails folder and project root`);
              }
            }
          }
          
          // If no thumbnail yet and we have a local video file, generate from video
          if (!thumbnailUrl && targetFilePath && fsSync.existsSync(targetFilePath)) {
            try {
              thumbnailUrl = await thumbnailService.generateThumbnail(targetFilePath, videoId);
              console.log(`[Row ${rowNumber}] ✓ Thumbnail generated from video: ${thumbnailUrl}`);
            } catch (genError) {
              console.warn(`[Row ${rowNumber}] ⚠ Failed to generate thumbnail from video:`, genError.message);
            }
          }
          
          // ALWAYS set a default thumbnail if none was found/assigned
          // This ensures videos always have a thumbnail URL, even if it's just the default
          if (!thumbnailUrl) {
            thumbnailUrl = '/thumbnails/default.png';
            console.log(`[Row ${rowNumber}] ✓ Using default thumbnail: ${thumbnailUrl}`);
          } else {
            console.log(`[Row ${rowNumber}] ✓ Final thumbnail URL: ${thumbnailUrl}`);
          }
        } catch (thumbnailError) {
          console.warn(`[Row ${rowNumber}] ⚠ Thumbnail processing failed:`, thumbnailError.message);
          console.warn(`[Row ${rowNumber}] ⚠ Thumbnail error stack:`, thumbnailError.stack);
          // Always set default thumbnail even on error
          thumbnailUrl = '/thumbnails/default.png';
          console.log(`[Row ${rowNumber}] ✓ Using default thumbnail after error: ${thumbnailUrl}`);
        }
        
        // Ensure thumbnailUrl is properly formatted (should already be correct if saved via service)
        // Only normalize if it's a URL or if it doesn't match expected format
        if (thumbnailUrl && !thumbnailUrl.startsWith('http://') && !thumbnailUrl.startsWith('https://')) {
          // Ensure it starts with /thumbnails/ and uses videoId as filename
          if (!thumbnailUrl.startsWith('/thumbnails/')) {
            // If it doesn't start with /thumbnails/, normalize it
            if (!thumbnailUrl.startsWith('/')) {
              thumbnailUrl = `/${thumbnailUrl}`;
            }
            // If it's not already in thumbnails folder, assume it should be there with videoId
            if (!thumbnailUrl.startsWith('/thumbnails/')) {
              const ext = path.extname(thumbnailUrl) || '.jpg';
              thumbnailUrl = `/thumbnails/${videoId}${ext}`;
              console.log(`[Row ${rowNumber}] ✓ Normalized thumbnail URL to: ${thumbnailUrl}`);
            }
          } else if (!thumbnailUrl.includes(videoId)) {
            // If it's in /thumbnails/ but doesn't use videoId, update the URL
            // (Note: This should rarely happen now since we always save with videoId)
            const ext = path.extname(thumbnailUrl) || '.jpg';
            thumbnailUrl = `/thumbnails/${videoId}${ext}`;
            console.log(`[Row ${rowNumber}] ✓ Updated thumbnail URL to use videoId: ${thumbnailUrl}`);
          }
        }

        // Final verification: Log thumbnail URL before saving to database
        console.log(`[Row ${rowNumber}] 📸 Thumbnail URL to be saved in database: ${thumbnailUrl || 'NULL'}`);
        
        // Get video duration (placeholder - in production, use ffprobe)
        const duration = 0;

        // CRITICAL: Ensure all required fields are set (NOT NULL fields in database)
        // file_path and streaming_url are REQUIRED in database schema
        if (!relativePath || relativePath.trim() === '') {
          console.error(`[Row ${rowNumber}] CRITICAL: file_path is empty! Using streamingUrl as fallback.`);
          relativePath = streamingUrl || fullVideoPath || 'unknown';
        }
        
        if (!streamingUrl || streamingUrl.trim() === '') {
          console.error(`[Row ${rowNumber}] CRITICAL: streaming_url is empty! Using file_path as fallback.`);
          streamingUrl = relativePath || fullVideoPath || 'unknown';
        }
        
        // Ensure redirectSlug is never null (required and unique)
        if (!shortSlug || shortSlug.trim() === '') {
          console.error(`[Row ${rowNumber}] CRITICAL: redirect_slug is empty! Using videoId as fallback.`);
          shortSlug = videoId;
        }
        
        // Get original filename for fallback
        let originalFileName;
        if (isRemoteFile) {
          try {
            originalFileName = path.basename(new URL(videoFilePath).pathname);
          } catch {
            originalFileName = 'video';
          }
        } else {
          originalFileName = path.basename(fullVideoPath);
        }
        
        const dbVideoData = {
          videoId,
          partnerId: null,
          title: title || originalFileName || 'Untitled Video',
          course: course || null,
          grade: grade || null,
          lesson: lesson || null,
          module: module || null,
          activity: activity || null,
          topic: topic || null, // Contains tags
          description: description || '', // Contains tags in format: "Title | Tags: tag1, tag2"
          language: language || 'en',
          filePath: relativePath, // REQUIRED - ensure it's never null
          streamingUrl: streamingUrl, // REQUIRED - ensure it's never null
          qrUrl: qrUrl || null,
          thumbnailUrl: thumbnailUrl || null, // Thumbnail URL saved to database
          redirectSlug: shortSlug, // REQUIRED and UNIQUE - ensure it's never null
          duration: 0, // Placeholder
          size: size || 0,
          version: latestVersion || 1,
          status: 'active'
        };

        let videoDbId = null;
        try {
          // FINAL CHECK: Verify video doesn't already exist before inserting
          // Double-check to prevent any race conditions or missed duplicates
          const finalCheckVideo = await videoService.getVideoByVideoId(videoId, true);
          if (finalCheckVideo) {
            // SKIP duplicate - video already exists
            const safeVideoId = typeof videoId !== 'undefined' ? videoId : 'N/A';
            const safeTitle = typeof title !== 'undefined' ? title : 'Untitled Video';
            results.failed++;
            results.errors.push({
              row: rowNumber,
              video: safeTitle,
              message: `Video with ID "${videoId}" already exists in Videos section. Skipping duplicate.`,
              errorType: 'DuplicateResource',
              errorCode: 'DUPLICATE_RESOURCE',
              videoId: safeVideoId,
              title: safeTitle,
              videoFilePath: typeof videoFilePath !== 'undefined' ? videoFilePath : 'N/A'
            });
            console.log(`[Row ${rowNumber}] ⏭️ SKIPPED: Video with ID "${videoId}" already exists (final check). Skipping duplicate.`);
            continue; // Skip to next row
          }
          
          // Also check by file_path one more time
          if (relativePath) {
            const [finalCheckByPath] = await pool.execute(
              'SELECT * FROM videos WHERE file_path = ? AND status = "active" LIMIT 1',
              [relativePath]
            );
            if (finalCheckByPath.length > 0) {
              // SKIP duplicate - file path already exists
              const safeVideoId = typeof videoId !== 'undefined' ? videoId : 'N/A';
              const safeTitle = typeof title !== 'undefined' ? title : 'Untitled Video';
              results.failed++;
              results.errors.push({
                row: rowNumber,
                video: safeTitle,
                message: `Video file path already exists in videos table (ID: ${finalCheckByPath[0].video_id}). Skipping duplicate.`,
                errorType: 'DuplicateResource',
                errorCode: 'DUPLICATE_RESOURCE',
                videoId: safeVideoId,
                title: safeTitle,
                videoFilePath: typeof videoFilePath !== 'undefined' ? videoFilePath : 'N/A'
              });
              console.log(`[Row ${rowNumber}] ⏭️ SKIPPED: File path already exists (final check). Skipping duplicate.`);
              continue; // Skip to next row
            }
          }
          
          // Note: Duplicates are now skipped earlier, so we only process new videos here
          
          // Log data being inserted for debugging
          console.log(`[Row ${rowNumber}] Attempting to create video with data:`, {
            videoId,
            title: title || 'Untitled',
            course: course || 'N/A',
            grade: grade || 'N/A',
            streamingUrl: streamingUrl?.substring(0, 80) || 'N/A',
            thumbnailUrl: thumbnailUrl || 'N/A',
            redirectSlug: dbVideoData.redirectSlug || 'N/A',
            filePath: relativePath?.substring(0, 80) || 'N/A',
            version: latestVersion
          });
          
          videoDbId = await videoService.createVideo(dbVideoData);
          console.log(`[Row ${rowNumber}] ✓ Video created in database with ID: ${videoDbId}`);
        } catch (createError) {
          // Check if it's a duplicate video error (video_id or redirect_slug)
          if (createError.code === 'ER_DUP_ENTRY' || 
              createError.message.includes('Duplicate entry') ||
              createError.message.includes('UNIQUE constraint')) {
            const isVideoIdDuplicate = createError.message.includes('video_id') || 
                                      createError.message.includes('PRIMARY');
            const isSlugDuplicate = createError.message.includes('redirect_slug') ||
                                   createError.message.includes('slug');
            
            if (isSlugDuplicate) {
              // Try to generate a new unique slug
              console.warn(`[Row ${rowNumber}] Redirect slug ${shortSlug} already exists, generating new one...`);
              try {
                const newSlug = `${videoId}_${Date.now()}`;
                dbVideoData.redirectSlug = newSlug;
                shortSlug = newSlug;
                videoDbId = await videoService.createVideo(dbVideoData);
                console.log(`[Row ${rowNumber}] ✓ Video created with new slug: ${newSlug}`);
              } catch (retryError) {
                console.error(`[Row ${rowNumber}] ✗ Failed to create video even with new slug:`, retryError.message);
                results.failed++;
                results.errors.push({
                  row: rowNumber,
                  video: title || videoFilePath || 'Unknown',
                  message: `Failed to create video: ${retryError.message}`
                });
                continue;
              }
            } else if (isVideoIdDuplicate) {
              // SKIP duplicate - video ID already exists
              const safeVideoId = typeof videoId !== 'undefined' ? videoId : 'N/A';
              const safeTitle = typeof title !== 'undefined' ? title : 'Untitled Video';
              results.failed++;
              results.errors.push({
                row: rowNumber,
                video: safeTitle,
                message: `Video with ID "${videoId}" already exists. Skipping duplicate.`,
                errorType: 'DuplicateResource',
                errorCode: 'DUPLICATE_RESOURCE',
                videoId: safeVideoId,
                title: safeTitle,
                videoFilePath: typeof videoFilePath !== 'undefined' ? videoFilePath : 'N/A'
              });
              console.log(`[Row ${rowNumber}] ⏭️ SKIPPED: Video with ID "${videoId}" already exists. Skipping duplicate.`);
              continue; // Skip to next row
            } else {
              // Generic duplicate error - also skip
              const safeVideoId = typeof videoId !== 'undefined' ? videoId : 'N/A';
              const safeTitle = typeof title !== 'undefined' ? title : 'Untitled Video';
              results.failed++;
              results.errors.push({
                row: rowNumber,
                video: safeTitle,
                message: `Duplicate entry: ${createError.message}. Skipping duplicate.`,
                errorType: 'DuplicateResource',
                errorCode: 'DUPLICATE_RESOURCE',
                videoId: safeVideoId,
                title: safeTitle,
                videoFilePath: typeof videoFilePath !== 'undefined' ? videoFilePath : 'N/A'
              });
              console.log(`[Row ${rowNumber}] ⏭️ SKIPPED: Duplicate entry detected. Skipping.`);
              continue; // Skip to next row
            }
          } else {
            // Log detailed error information
            console.error(`[Row ${rowNumber}] ✗ Database error creating video:`, createError.message);
            console.error(`[Row ${rowNumber}] ✗ Error code:`, createError.code);
            console.error(`[Row ${rowNumber}] ✗ Error SQL state:`, createError.sqlState);
            console.error(`[Row ${rowNumber}] ✗ Error SQL message:`, createError.sqlMessage);
            console.error(`[Row ${rowNumber}] ✗ Full error:`, createError);
            
            results.failed++;
            results.errors.push({
              row: rowNumber,
              video: title || videoFilePath || 'Unknown',
              message: `Database error: ${createError.message}`
            });
            continue; // Continue with next row instead of throwing
          }
        }
        
        // Create video version only for local files (not Cloudflare URLs)
        try {
          if (!isRemoteFile && targetFilePath) {
            await videoService.createVideoVersion(videoId, latestVersion, relativePath, size);
          } else if (isRemoteFile) {
            // For Cloudflare URLs, create a version entry with the URL
            await videoService.createVideoVersion(videoId, latestVersion, relativePath, size || 0);
          }
        } catch (versionError) {
          console.warn(`[Row ${rowNumber}] Failed to create video version:`, versionError.message);
          // Continue - version creation is not critical
        }

        // Schedule co-located VTT generation for local video files
        if (!isRemoteFile && targetFilePath && fsSync.existsSync(targetFilePath) && videoDbId) {
          try {
            const { scheduleVttGeneration } = await import('../utils/vttLifecycle.js');
            const createdVideo = await videoService.getVideoById(videoDbId);
            if (createdVideo) {
              scheduleVttGeneration(createdVideo, targetFilePath);
              console.log(`[Row ${rowNumber}] 🎤 VTT generation scheduled for ${videoId}`);
            }
          } catch (vttErr) {
            console.warn(`[Row ${rowNumber}] VTT scheduling failed (non-critical):`, vttErr.message);
          }
        }

        // Create cloudflare_resources entry so video appears in My Storage section
        // This MUST be created for CSV uploads to show in My Storage
        // Only create if video was successfully created (videoDbId exists)
        if (videoDbId) {
          try {
            const localhostUrl = streamingUrl || `${config.urls.base}/s/${shortSlug || videoId}`;
            
            // Get filename from relativePath if available, otherwise from videoFilePath
            let fileName;
            if (relativePath) {
              fileName = path.basename(relativePath);
            } else if (videoFilePath) {
              fileName = path.basename(videoFilePath);
            } else {
              fileName = `${videoId}_master.mp4`;
            }
            
            // Ensure relativePath is set correctly for my-storage
            let storagePath = relativePath;
            if (!storagePath || !storagePath.startsWith('my-storage/')) {
              // If relativePath is not in my-storage format, construct it
              if (targetFilePath) {
                const backendDir = path.dirname(__dirname);
                const basePath = path.dirname(backendDir);
                let uploadPath = path.isAbsolute(config.upload.uploadPath) 
                  ? config.upload.uploadPath 
                  : path.resolve(basePath, config.upload.uploadPath);
                const myStoragePath = path.join(uploadPath, 'my-storage');
                
                // Check if targetFilePath is in my-storage
                if (targetFilePath.includes('my-storage')) {
                  storagePath = path.relative(path.join(uploadPath), targetFilePath).replace(/\\/g, '/');
                } else {
                  // Construct my-storage path
                  storagePath = `my-storage/${fileName}`;
                }
              } else {
                storagePath = `my-storage/${fileName}`;
              }
            }
            
            // Ensure storagePath starts with my-storage/
            if (!storagePath.startsWith('my-storage/')) {
              storagePath = `my-storage/${path.basename(storagePath)}`;
            }
            
            // Create cloudflare_resources entry for CSV uploads
            // NOTE: We do NOT check for duplicates in cloudflare_resources
            // CSV uploads create entries in BOTH videos and cloudflare_resources
            // Manual uploads to My Storage are separate and don't prevent CSV uploads
            // We only check videos table for duplicates (done earlier)
            console.log(`[Row ${rowNumber}] Creating cloudflare_resources entry:`, {
              fileName,
              storagePath,
              streamingUrl: localhostUrl?.substring(0, 80),
              size: size || 0,
              videoDbId: videoDbId,
              videoId: videoId
            });
            
            // Validate required fields before insert
            if (!fileName || !localhostUrl || !storagePath) {
              throw new Error(`Missing required fields: fileName=${!!fileName}, localhostUrl=${!!localhostUrl}, storagePath=${!!storagePath}`);
            }
            
            const insertResult = await pool.execute(
              `INSERT INTO cloudflare_resources 
               (file_name, original_file_name, file_size, file_type, cloudflare_url, cloudflare_key, storage_type, source_type, source_path, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                fileName,
                fileName,
                size || 0,
                'video/mp4',
                localhostUrl,
                storagePath, // my-storage path
                'r2', // Use 'r2' as storage_type (enum only allows 'r2' or 'stream')
                'upload', // Use 'upload' as source_type (enum only allows 'local', 'misc', 'upload')
                videoFilePath || null,
                'completed'
              ]
            );
            console.log(`[Row ${rowNumber}] ✓ Created cloudflare_resources entry for My Storage:`, {
              insertId: insertResult[0].insertId,
              path: storagePath,
              fileName: fileName
            });
          } catch (resourceError) {
            console.error(`[Row ${rowNumber}] ✗ CRITICAL: Failed to create cloudflare_resources entry:`, resourceError.message);
            console.error(`[Row ${rowNumber}] ✗ Resource error code:`, resourceError.code);
            console.error(`[Row ${rowNumber}] ✗ Resource error SQL:`, resourceError.sqlMessage);
            console.error(`[Row ${rowNumber}] ✗ Resource error stack:`, resourceError.stack);
            // Don't fail the whole upload, but log it as a warning
            console.warn(`[Row ${rowNumber}] ⚠ Video will not appear in My Storage section due to resource entry failure`);
          }
        } else {
          console.warn(`[Row ${rowNumber}] ⚠ Skipping cloudflare_resources creation - video was not created (videoDbId is null)`);
        }

        // Only mark as successful if video was created
        if (videoDbId) {
          results.successful++;
          // Use safe typeof checks for logging
          const safeVideoId = typeof videoId !== 'undefined' ? videoId : 'Unknown';
          const safeTitle = typeof title !== 'undefined' ? title : 'Untitled';
          const safeTag1 = typeof tag1 !== 'undefined' ? tag1 : 'N/A';
          const safeTag2 = typeof tag2 !== 'undefined' ? tag2 : 'N/A';
          const safeStreamingUrl = typeof streamingUrl !== 'undefined' ? streamingUrl : '';
          console.log(`✓ Row ${rowNumber}: Video uploaded successfully - ${safeVideoId}`);
          console.log(`  - Title: ${safeTitle}`);
          console.log(`  - Tags: ${safeTag1}, ${safeTag2}`);
          if (safeStreamingUrl) {
            console.log(`  - Streaming URL: ${safeStreamingUrl.substring(0, 80)}${safeStreamingUrl.length > 80 ? '...' : ''}`);
          }
          console.log(`  - Database ID: ${videoDbId}`);
        } else {
          // Video creation failed but we continued - mark as failed
          results.failed++;
          // Use safe typeof checks
          const safeTitle = typeof title !== 'undefined' ? title : '';
          const safeVideoFilePath = typeof videoFilePath !== 'undefined' ? videoFilePath : '';
          const safeVideoId = typeof videoId !== 'undefined' ? videoId : '';
          results.errors.push({
            row: rowNumber,
            video: safeTitle || safeVideoFilePath || safeVideoId || 'Unknown',
            message: 'Video creation failed - check logs for details'
          });
          console.error(`✗ Row ${rowNumber}: Video creation failed for ${safeVideoId}`);
        }

      } catch (error) {
        results.failed++;
        
        // Build comprehensive error message
        let errorMessage = error.message || 'Unknown error occurred';
        
        // Add SQL error details if available
        if (error.sqlMessage) {
          errorMessage += ` (SQL: ${error.sqlMessage})`;
        }
        
        // Add file path information if available - use safe typeof check
        const safeVideoFilePath = typeof videoFilePath !== 'undefined' ? videoFilePath : '';
        if (safeVideoFilePath && !errorMessage.includes(safeVideoFilePath)) {
          errorMessage += ` | File: ${safeVideoFilePath}`;
        }
        
        // Add tried paths if available in error details
        if (error.details && error.details.triedPaths) {
          errorMessage += ` | Tried paths: ${error.details.triedPaths.join(', ')}`;
        }
        
        // Use safe typeof checks for all variables
        const safeVideoId = typeof videoId !== 'undefined' ? videoId : '';
        const safeTitle = typeof title !== 'undefined' ? title : '';
        const safeTag1 = typeof tag1 !== 'undefined' ? tag1 : '';
        const safeTag2 = typeof tag2 !== 'undefined' ? tag2 : '';
        
        const errorMsg = {
          row: rowNumber,
          video: safeTitle || safeVideoFilePath || safeVideoId || 'Unknown',
          message: errorMessage,
          errorType: error.name || 'Error',
          errorCode: error.code || null,
          details: {
            videoId: safeVideoId || null,
            title: safeTitle || null,
            videoFilePath: safeVideoFilePath || null,
            tag1: safeTag1 || null,
            tag2: safeTag2 || null,
            ...(error.details || {})
          }
        };
        
        // Add SQL error details if available
        if (error.sqlState) {
          errorMsg.details.sqlState = error.sqlState;
        }
        if (error.sqlMessage) {
          errorMsg.details.sqlMessage = error.sqlMessage;
        }
        
        results.errors.push(errorMsg);
        console.error(`✗ Row ${rowNumber}: ${error.message}`);
        console.error(`✗ Error type: ${error.name || 'Unknown'}`);
        console.error(`✗ Error code: ${error.code || 'N/A'}`);
        console.error(`✗ Error details:`, error);
        if (error.stack) {
          console.error(`✗ Error stack:`, error.stack);
        }
        
        // Log row data for debugging - use safe typeof checks
        console.error(`✗ Row data:`, {
          videoId: typeof videoId !== 'undefined' ? videoId : 'N/A',
          title: typeof title !== 'undefined' ? title : 'N/A',
          videoFilePath: typeof videoFilePath !== 'undefined' ? videoFilePath : 'N/A',
          tag1: typeof tag1 !== 'undefined' ? tag1 : 'N/A',
          tag2: typeof tag2 !== 'undefined' ? tag2 : 'N/A'
        });
        
        // Continue processing other rows even if one fails
      }
    }

    // Update upload history with final status (only if history record exists)
    if (uploadHistoryId) {
      try {
        const finalStatus = results.failed === 0 ? 'completed' : (results.successful > 0 ? 'completed' : 'failed');
        const errorMessage = results.errors.length > 0 ? results.errors.map(e => `${e.row}: ${e.message}`).join('; ').substring(0, 1000) : null;
        
        await pool.execute(
          `UPDATE csv_upload_history 
           SET status = ?, 
               total_videos = ?, 
               successful_videos = ?, 
               failed_videos = ?,
               error_message = ?
           WHERE id = ?`,
          [finalStatus, results.total, results.successful, results.failed, errorMessage, uploadHistoryId]
        );
      } catch (updateError) {
        console.warn('Failed to update upload history:', updateError.message);
        // Don't fail the upload if history update fails
      }
    }

    // Clean up uploaded CSV file
    try {
      await fs.unlink(req.file.path);
    } catch (cleanupError) {
      console.warn('Failed to cleanup CSV file:', cleanupError.message);
    }

    res.json({
      message: 'Bulk upload completed',
      results,
      uploadHistoryId
    });

  } catch (error) {
    console.error('=== BULK UPLOAD ERROR ===');
    console.error('Error message:', error.message);
    console.error('Error name:', error.name);
    console.error('Error code:', error.code);
    console.error('Error stack:', error.stack);
    
    // Ensure results object exists
    if (!results) {
      results = {
        total: 0,
        successful: 0,
        failed: 0,
        errors: []
      };
    }
    
    // Update upload history with error status (only if history record exists)
    if (uploadHistoryId) {
      try {
        await pool.execute(
          `UPDATE csv_upload_history 
           SET status = 'failed', 
               error_message = ?
           WHERE id = ?`,
          [error.message ? error.message.substring(0, 1000) : 'Unknown error', uploadHistoryId]
        );
      } catch (updateError) {
        // Don't log as error if table doesn't exist
        if (updateError.code !== 'ER_NO_SUCH_TABLE') {
          console.error('Failed to update upload history:', updateError.message);
        }
      }
    }
    
    // Clean up uploaded CSV file
    if (req && req.file && req.file.path) {
      try {
        await fs.unlink(req.file.path);
      } catch (cleanupError) {
        // Ignore cleanup errors
        console.warn('Failed to cleanup CSV file:', cleanupError.message);
      }
    }

    // Return detailed error information
    const errorResponse = {
      error: 'Bulk upload failed',
      message: error.message || 'Unknown error occurred',
      results: results || {
        total: 0,
        successful: 0,
        failed: 0,
        errors: []
      },
      details: {
        totalProcessed: results?.total || 0,
        successful: results?.successful || 0,
        failed: results?.failed || 0,
        errorCount: results?.errors?.length || 0
      }
    };
    
    // Add development details if in development mode
    if (process.env.NODE_ENV === 'development') {
      errorResponse.stack = error.stack;
      errorResponse.name = error.name;
      errorResponse.code = error.code;
      errorResponse.firstErrors = (results?.errors || []).slice(0, 5);
    }

    console.error('=== BULK UPLOAD FAILED ===');
    console.error('Error:', error.message);
    console.error('Results:', results);
    console.error('First errors:', (results?.errors || []).slice(0, 3));

    res.status(500).json(errorResponse);
  }
}

/**
 * Get CSV upload history
 */
export async function getUploadHistory(req, res) {
  try {
    // Check if table exists, if not return empty array
    try {
      await pool.execute('SELECT 1 FROM csv_upload_history LIMIT 1');
    } catch (tableError) {
      if (tableError.code === 'ER_NO_SUCH_TABLE') {
        console.warn('csv_upload_history table does not exist. Returning empty history.');
        return res.json({
          history: [],
          total: 0,
          limit: 50,
          offset: 0,
          message: 'Upload history table not found. Run migration: npm run migrate-csv-history'
        });
      }
      throw tableError;
    }

    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    // MySQL doesn't accept LIMIT/OFFSET as parameters in prepared statements, so embed them in the query
    const limitValue = Math.max(1, Math.min(limit, 100)); // Clamp between 1 and 100
    const offsetValue = Math.max(0, offset); // Ensure non-negative

    const [history] = await pool.execute(
      `SELECT 
        id, file_name, file_size, total_videos, successful_videos, failed_videos,
        status, error_message, uploaded_by, created_at, updated_at
       FROM csv_upload_history
       ORDER BY created_at DESC
       LIMIT ${limitValue} OFFSET ${offsetValue}`
    );

    const [countResult] = await pool.execute(
      'SELECT COUNT(*) as total FROM csv_upload_history'
    );
    const total = countResult[0]?.total || 0;

    res.json({
      history,
      total,
      limit,
      offset
    });
  } catch (error) {
    console.error('Error fetching upload history:', error);
    res.status(500).json({ 
      error: 'Failed to fetch upload history', 
      message: error.message,
      code: error.code 
    });
  }
}

/**
 * Delete a single upload history record
 */
export async function deleteUploadHistory(req, res) {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ error: 'Upload history ID is required' });
    }

    // Check if table exists
    try {
      await pool.execute('SELECT 1 FROM csv_upload_history LIMIT 1');
    } catch (tableError) {
      if (tableError.code === 'ER_NO_SUCH_TABLE') {
        return res.status(404).json({ error: 'Upload history table not found' });
      }
      throw tableError;
    }

    // Check if record exists
    const [records] = await pool.execute(
      'SELECT id FROM csv_upload_history WHERE id = ?',
      [id]
    );

    if (records.length === 0) {
      return res.status(404).json({ error: 'Upload history record not found' });
    }

    // Delete the record
    await pool.execute(
      'DELETE FROM csv_upload_history WHERE id = ?',
      [id]
    );

    res.json({ 
      success: true, 
      message: 'Upload history record deleted successfully',
      deletedId: id
    });
  } catch (error) {
    console.error('Error deleting upload history:', error);
    res.status(500).json({ 
      error: 'Failed to delete upload history', 
      message: error.message 
    });
  }
}

/**
 * Bulk delete upload history records
 */
export async function bulkDeleteUploadHistory(req, res) {
  try {
    const { ids } = req.body;
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Array of IDs is required' });
    }

    // Check if table exists
    try {
      await pool.execute('SELECT 1 FROM csv_upload_history LIMIT 1');
    } catch (tableError) {
      if (tableError.code === 'ER_NO_SUCH_TABLE') {
        return res.status(404).json({ error: 'Upload history table not found' });
      }
      throw tableError;
    }

    // Validate all IDs are numbers
    const validIds = ids.filter(id => Number.isInteger(Number(id)) && Number(id) > 0);
    
    if (validIds.length === 0) {
      return res.status(400).json({ error: 'No valid IDs provided' });
    }

    // Create placeholders for the IN clause
    const placeholders = validIds.map(() => '?').join(',');
    
    // Delete the records
    const [result] = await pool.execute(
      `DELETE FROM csv_upload_history WHERE id IN (${placeholders})`,
      validIds
    );

    res.json({ 
      success: true, 
      message: `${result.affectedRows} upload history record(s) deleted successfully`,
      deletedCount: result.affectedRows,
      requestedCount: validIds.length
    });
  } catch (error) {
    console.error('Error bulk deleting upload history:', error);
    res.status(500).json({ 
      error: 'Failed to bulk delete upload history', 
      message: error.message 
    });
  }
}
