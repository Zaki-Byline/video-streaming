import pool from '../config/database.js';
import { generateVideoId, generateVideoPath } from '../utils/videoIdGenerator.js';
import { getVideoFilePath, ensureDirectoryExists, getFileSize } from '../utils/fileUtils.js';
import { generateQRCode } from './qrCodeService.js';
import config from '../config/config.js';
import { getBaseUrl } from '../utils/urlHelper.js';

/**
 * Create video entry in database
 */
export async function createVideo(videoData) {
  const {
    videoId,
    partnerId,
    title,
    subject,
    grade,
    unit,
    lesson,
    module,
    activity,
    topic,
    description,
    language,
    filePath,
    streamingUrl,
    qrUrl,
    thumbnailUrl,
    redirectSlug,
    duration,
    size,
    version = 1,
    status = 'active',
    createdBy = null // User ID who uploaded the video
  } = videoData;
  
  // Ensure ALL required columns exist before inserting - create them if they don't exist
  // This ensures subject, grade, unit, lesson, module, status, description columns are always available
  // NOTE: 'activity' and 'course' fields are REMOVED from the new schema
  const requiredColumns = [
    { name: 'subject', after: 'id', index: true, type: 'VARCHAR(255)' },
    { name: 'grade', after: 'subject', index: false, type: 'VARCHAR(255)' },
    { name: 'unit', after: 'grade', index: false, type: 'VARCHAR(255)' },
    { name: 'lesson', after: 'unit', index: false, type: 'VARCHAR(255)' },
    { name: 'module', after: 'lesson', index: false, type: 'VARCHAR(255)' },
    { name: 'topic', after: 'module', index: false, type: 'VARCHAR(255)' },
    { name: 'status', after: 'version', index: false, type: 'VARCHAR(50)' },
    { name: 'description', after: 'topic', index: false, type: 'TEXT' },
    { name: 'created_by', after: 'status', index: true, type: 'INT' }
  ];

  console.log('[createVideo] Ensuring all required columns exist...');
  for (const col of requiredColumns) {
    const exists = await columnExists(col.name);
    if (!exists) {
      try {
        // Try to add column after the specified column
        try {
          await pool.execute(`ALTER TABLE videos ADD COLUMN ${col.name} ${col.type} NULL AFTER ${col.after}`);
        } catch (afterError) {
          // If AFTER clause fails, try adding at the end
          console.warn(`[createVideo] Could not add ${col.name} after ${col.after}, trying at end...`);
          await pool.execute(`ALTER TABLE videos ADD COLUMN ${col.name} ${col.type} NULL`);
        }
        
        if (col.index) {
          try {
            await pool.execute(`ALTER TABLE videos ADD INDEX idx_${col.name} (${col.name})`);
          } catch (indexError) {
            // Index might already exist or fail, that's okay
            console.warn(`[createVideo] Could not add index for ${col.name}:`, indexError.message);
          }
        }
        console.log(`[createVideo] ✓ Added missing ${col.name} column to videos table`);
      } catch (addColError) {
        // Column might already exist or there's a syntax issue, check error code
        if (addColError.code !== 'ER_DUP_FIELDNAME' && addColError.code !== 'ER_DUP_KEYNAME') {
          console.warn(`[createVideo] Could not add ${col.name} column:`, addColError.message);
        }
      }
    }
  }

  // Re-check which columns exist after ensuring they're created
  const hasSubjectColumn = await columnExists('subject');
  const hasCourseColumn = await columnExists('course');
  const hasModuleColumn = await columnExists('module');
  const hasUnitColumn = await columnExists('unit');
  const hasGradeColumn = await columnExists('grade');
  const hasLessonColumn = await columnExists('lesson');
  const hasStatusColumn = await columnExists('status');
  const hasDescriptionColumn = await columnExists('description');
  const hasCreatedByColumn = await columnExists('created_by');
  
  console.log('[createVideo] Column existence check:', {
    subject: hasSubjectColumn,
    grade: hasGradeColumn,
    unit: hasUnitColumn,
    lesson: hasLessonColumn,
    module: hasModuleColumn,
    status: hasStatusColumn,
    description: hasDescriptionColumn,
    created_by: hasCreatedByColumn
  });
  
  // Determine which field to use for subject/course - use subject value, map to course if needed
  // Preserve actual values - don't convert empty strings to null if they're valid inputs
  // Only convert to null if truly undefined/null
  const subjectValue = (subject !== undefined && subject !== null && String(subject).trim() !== '') 
    ? String(subject).trim() 
    : null;
  const moduleValue = (module !== undefined && module !== null && String(module).trim() !== '') 
    ? String(module).trim() 
    : null;
  const unitValue = (unit !== undefined && unit !== null && String(unit).trim() !== '') 
    ? String(unit).trim() 
    : null;
  const gradeValue = (grade !== undefined && grade !== null && String(grade).trim() !== '') 
    ? String(grade).trim() 
    : null;
  const lessonValue = (lesson !== undefined && lesson !== null && String(lesson).trim() !== '') 
    ? String(lesson).trim() 
    : null;
  const statusValue = (status !== undefined && status !== null && String(status).trim() !== '') 
    ? String(status).trim() 
    : 'active'; // Default to 'active' if not provided
  const descriptionValue = (description !== undefined && description !== null) 
    ? String(description).trim() 
    : '';
  
  // Use subject column only (course column removed)
  const dbSubjectColumn = hasSubjectColumn ? 'subject' : null;
  
  console.log('[createVideo] Processed values before insert:', {
    subject: subjectValue,
    grade: gradeValue,
    unit: unitValue,
    lesson: lessonValue,
    module: moduleValue,
    status: statusValue,
    description: descriptionValue
  });
  
  // Try with all new columns first, fallback to old schema if columns don't exist
  let query, params;
  
  try {
    // Try with new schema (partner_id, subject/course, unit, module, activity, thumbnail_url)
    // Build query dynamically based on which columns exist
    try {
      const columns = ['video_id', 'partner_id', 'title'];
      const placeholders = ['?', '?', '?'];
      const values = [videoId, partnerId || null, title || 'Untitled Video'];
      
      // Add subject/course - CRITICAL: Always include if column exists, even if value is null
      if (dbSubjectColumn) {
        columns.push(dbSubjectColumn);
        placeholders.push('?');
        values.push(subjectValue); // This can be null, which is fine - it explicitly sets NULL
        console.log(`[createVideo] Adding ${dbSubjectColumn} to INSERT with value:`, subjectValue);
      } else {
        console.warn('[createVideo] ⚠️ Neither subject nor course column exists - cannot save subject value!');
      }
      
      // Add grade if column exists
      if (hasGradeColumn) {
        columns.push('grade');
        placeholders.push('?');
        values.push(gradeValue);
      }
      
      // Add unit if column exists
      if (hasUnitColumn) {
        columns.push('unit');
        placeholders.push('?');
        values.push(unitValue);
      }
      
      // Add lesson if column exists
      if (hasLessonColumn) {
        columns.push('lesson');
        placeholders.push('?');
        values.push(lessonValue);
      }
      
      // Add module if column exists - CRITICAL: Always include if column exists, even if value is null
      if (hasModuleColumn) {
        columns.push('module');
        placeholders.push('?');
        values.push(moduleValue); // This can be null, which is fine - it explicitly sets NULL
        console.log('[createVideo] Adding module to INSERT with value:', moduleValue);
      } else {
        console.warn('[createVideo] ⚠️ Module column does not exist - cannot save module value!');
      }
      
      // Add topic column (activity is removed from schema)
      columns.push('topic');
      placeholders.push('?');
      values.push(
        (topic !== undefined && topic !== null && String(topic).trim() !== '') ? String(topic).trim() : null
      );
      
      // Add description if column exists
      if (hasDescriptionColumn) {
        columns.push('description');
        placeholders.push('?');
        values.push(descriptionValue);
      }
      
      // Add language, file paths, etc.
      columns.push('language', 'file_path', 'streaming_url', 'qr_url', 'thumbnail_url', 'redirect_slug', 'duration', 'size', 'version');
      placeholders.push('?', '?', '?', '?', '?', '?', '?', '?', '?');
      
      // Preserve version exactly as provided (e.g., "1.00" stays "1.00")
      // Convert to number for database storage, but preserve decimal precision
      let versionValue = null;
      if (version !== undefined && version !== null && version !== '') {
        const versionStr = String(version).trim();
        if (versionStr !== '') {
          // Parse to number to store in DECIMAL column, but preserve original string format
          const versionNum = parseFloat(versionStr);
          versionValue = isNaN(versionNum) ? null : versionNum; // Store as number for DECIMAL column
        }
      }
      // Only default to 1 if version was not provided at all
      if (versionValue === null && (version === undefined || version === null || version === '')) {
        versionValue = 1; // Default only when version is not provided
      }
      
      values.push(
        language || 'en',
        filePath || null, 
        streamingUrl || null, 
        qrUrl || null, 
        thumbnailUrl || null, 
        redirectSlug || null, 
        duration || 0, 
        size || 0, 
        versionValue
      );
      
      // Add status if column exists
      if (hasStatusColumn) {
        columns.push('status');
        placeholders.push('?');
        values.push(statusValue);
      }
      
      // Add created_by if column exists
      if (hasCreatedByColumn) {
        columns.push('created_by');
        placeholders.push('?');
        values.push(createdBy);
      }
      
      query = `INSERT INTO videos (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`;
      params = values;
      
      console.log('[createVideo] Insert query columns:', columns);
      console.log('[createVideo] Insert values being saved:', {
        subject: subjectValue,
        grade: gradeValue,
        unit: unitValue,
        lesson: lessonValue,
        module: moduleValue,
        status: statusValue,
        description: descriptionValue,
        allValues: values.map((val, idx) => ({ column: columns[idx], value: val }))
      });
      
      const [result] = await pool.execute(query, params);
      const insertId = result.insertId;
      
      // Verify the values were saved correctly by fetching the record
      if (insertId) {
        try {
          // Use SELECT * to get all columns, then check what we actually saved
          const [savedRows] = await pool.execute('SELECT * FROM videos WHERE id = ?', [insertId]);
          if (savedRows.length > 0) {
            const saved = savedRows[0];
            console.log('[createVideo] ✓ Values verified in database after insert:', {
              id: saved.id,
              video_id: saved.video_id,
              subject: saved.subject,
              course: saved.course,
              grade: saved.grade,
              unit: saved.unit,
              lesson: saved.lesson,
              module: saved.module,
              status: saved.status,
              description: saved.description ? (saved.description.length > 50 ? saved.description.substring(0, 50) + '...' : saved.description) : saved.description,
              allColumns: Object.keys(saved).filter(k => ['subject', 'course', 'grade', 'unit', 'lesson', 'module', 'status', 'description'].includes(k))
            });
            
            // Warn if values we expected to save are NULL
            if (subjectValue !== null && saved.subject === null && saved.course === null) {
              console.warn('[createVideo] ⚠️ WARNING: Subject value was not saved! Expected:', subjectValue, 'Got:', saved.subject);
            }
            if (moduleValue !== null && saved.module === null) {
              console.warn('[createVideo] ⚠️ WARNING: Module value was not saved! Expected:', moduleValue, 'Got:', saved.module);
            }
            if (gradeValue !== null && saved.grade === null) {
              console.warn('[createVideo] ⚠️ WARNING: Grade value was not saved! Expected:', gradeValue, 'Got:', saved.grade);
            }
          }
        } catch (verifyError) {
          console.warn('[createVideo] Could not verify saved values:', verifyError.message);
          console.warn('[createVideo] Verify error details:', verifyError);
        }
      }
      
      return insertId;
    } catch (unitError) {
      // If unit column doesn't exist, try to add it first, then retry
      if (unitError.code === 'ER_BAD_FIELD_ERROR') {
        console.log('[createVideo] Unit column not found, attempting to add it...');
        try {
          // Try to add unit column if it doesn't exist
          await pool.execute('ALTER TABLE videos ADD COLUMN unit VARCHAR(255) NULL AFTER grade');
          console.log('[createVideo] Unit column added successfully, retrying insert...');
          // Retry the original insert
          const [result] = await pool.execute(query, params);
          return result.insertId;
        } catch (alterError) {
          console.error('[createVideo] Failed to add unit column:', alterError.message);
          // If we can't add the column, fall back to storing without unit
          console.log('[createVideo] Falling back to insert without unit column');
          query = `
            INSERT INTO videos (
              video_id, partner_id, title, subject, grade, lesson, module, activity, topic, description, language,
              file_path, streaming_url, qr_url, thumbnail_url, redirect_slug, duration, size, version, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;
          params = [
            videoId, 
            partnerId || null, 
            title || 'Untitled Video', 
            subject || null, // Keep subject separate, don't mix with unit
            grade || null, 
            lesson || null, 
            module || null, 
            activity || null, 
            topic || null, 
            description || '', 
            language || 'en',
            filePath || null, 
            streamingUrl || null, 
            qrUrl || null, 
            thumbnailUrl || null, 
            redirectSlug || null, 
            duration || 0, 
            size || 0, 
            (version !== undefined && version !== null && version !== '') 
              ? (() => {
                  const versionStr = String(version).trim();
                  if (versionStr === '') return 1;
                  const versionNum = parseFloat(versionStr);
                  return isNaN(versionNum) ? 1 : versionNum;
                })()
              : 1, 
            status || 'active'
          ];
          
          const [result] = await pool.execute(query, params);
          return result.insertId;
        }
      }
      throw unitError;
    }
  } catch (error) {
    // If new columns don't exist, try with old schema
    if (error.code === 'ER_BAD_FIELD_ERROR') {
      console.warn('New columns not found, using old schema. Please run database migrations.');
      
      // Fallback to old schema (without subject, module, activity, thumbnail_url)
      // Map subject/grade/lesson to old grade/unit/lesson structure
      query = `
        INSERT INTO videos (
          video_id, title, grade, unit, lesson, topic, description, language,
          file_path, streaming_url, qr_url, redirect_slug, duration, size, version, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      // Try to extract numeric values from text fields
      const gradeNum = grade ? parseInt(grade.toString().replace(/\D/g, '')) || null : null;
      const unitNum = subject ? parseInt(subject.toString().replace(/\D/g, '')) || null : null;
      const lessonNum = lesson ? parseInt(lesson.toString().replace(/\D/g, '')) || null : null;
      
      params = [
        videoId, title || 'Untitled Video', gradeNum || 0, unitNum || 0, lessonNum || 0, topic || '', 
        description || '', language || 'en',
        filePath, streamingUrl, qrUrl, redirectSlug, duration || 0, size || 0, version, status
      ];
      
      const [result] = await pool.execute(query, params);
      return result.insertId;
    }
    throw error;
  }
}

/**
 * Get video by ID
 * @param {string} videoId - The video_id to search for
 * @param {boolean} includeInactive - If true, also return inactive videos
 */
export async function getVideoByVideoId(videoId, includeInactive = false) {
  let query = 'SELECT * FROM videos WHERE video_id = ?';
  if (!includeInactive) {
    query += ' AND status = "active"';
  }
  query += ' ORDER BY version DESC LIMIT 1';
  const [rows] = await pool.execute(query, [videoId]);
  return rows[0] || null;
}

/**
 * Get video by database ID
 */
export async function getVideoById(id) {
  // Check which columns exist before querying
  const columnsToCheck = [
    'id', 'video_id', 'partner_id', 'title', 'description', 'language',
    'file_path', 'streaming_url', 'qr_url', 'thumbnail_url', 'redirect_slug',
    'duration', 'size', 'version', 'status', 'created_at', 'updated_at',
    'grade', 'lesson', 'activity', 'topic', 'subject', 'course', 'module', 'unit'
  ];
  
  // Check existence of all columns
  const columnChecks = {};
  for (const col of columnsToCheck) {
    columnChecks[col] = await columnExists(col);
  }
  
  // Build SELECT query with only existing columns
  const selectColumns = ['id', 'video_id', 'title']; // Required columns
  
  // Add optional columns only if they exist
  const optionalColumns = [
    'partner_id', 'description', 'language', 'file_path', 'streaming_url',
    'qr_url', 'thumbnail_url', 'redirect_slug', 'duration', 'size', 'version',
    'views', 'status', 'created_at', 'updated_at', 'grade', 'lesson', 'topic'
  ];
  
  for (const col of optionalColumns) {
    if (columnChecks[col]) {
      selectColumns.push(col);
    }
  }
  
  // Add subject/course/module/unit if they exist
  if (columnChecks['subject']) {
    selectColumns.push('subject');
  }
  if (columnChecks['course']) {
    selectColumns.push('course');
  }
  if (columnChecks['module']) {
    selectColumns.push('module');
  }
  if (columnChecks['unit']) {
    selectColumns.push('unit');
  }
  
  // Store column existence for mapping
  const hasSubjectColumn = columnChecks['subject'];
  const hasCourseColumn = columnChecks['course'];
  
  const query = `SELECT ${selectColumns.join(', ')} FROM videos WHERE id = ?`;
  const [rows] = await pool.execute(query, [id]);
  const video = rows[0] || null;
  
  if (!video) {
    return null;
  }
  
  // Determine subject value - check both subject and course columns for backward compatibility
  const subjectValue = (video.subject !== undefined && video.subject !== null && video.subject !== '') 
    ? video.subject 
    : ((video.course !== undefined && video.course !== null && video.course !== '') 
        ? video.course 
        : null);
  
  // Log to verify subject information is being retrieved
  console.log('[getVideoById] Retrieved video subject info:', {
    id: video.id,
    video_id: video.video_id,
    subject: video.subject,
    course: video.course,
    subjectValue: subjectValue,
    grade: video.grade,
    unit: video.unit,
    lesson: video.lesson,
    module: video.module,
    description: video.description
  });
  
  // Helper to preserve values including "0" and empty strings that might be valid
  const preserveValue = (val) => {
    if (val === undefined || val === null) return null;
    const str = String(val).trim();
    return str !== '' ? str : null;
  };
  
  const result = {
    ...video,
    subject: subjectValue,
    course: subjectValue, // Backward compatibility
    grade: preserveValue(video.grade),
    unit: preserveValue(video.unit),
    lesson: preserveValue(video.lesson),
    module: preserveValue(video.module),
    // Explicitly preserve size and duration fields (file size in bytes, duration in seconds)
    size: video.size !== null && video.size !== undefined ? Number(video.size) : (video.size || 0),
    duration: video.duration !== null && video.duration !== undefined ? Number(video.duration) : (video.duration || 0),
    description: video.description !== undefined ? video.description : null
  };
  
  console.log('[getVideoById] Returning video with mapped values:', {
    id: result.id,
    video_id: result.video_id,
    subject: result.subject,
    module: result.module,
    unit: result.unit,
    grade: result.grade,
    lesson: result.lesson,
    size: result.size,
    sizeMB: result.size ? (result.size / 1024 / 1024).toFixed(2) + ' MB' : 'N/A',
    sizeType: typeof result.size,
    rawSubject: video.subject,
    rawModule: video.module,
    rawCourse: video.course
  });
  
  return result;
}

/**
 * Check if a video with the same file path or streaming URL already exists
 * This prevents duplicate uploads of the same video resource
 */
export async function findVideoByFileOrUrl(filePath, streamingUrl) {
  try {
    // Check by streaming_url first (most reliable for Cloudflare URLs)
    if (streamingUrl && streamingUrl.trim() !== '') {
      const [urlRows] = await pool.execute(
        'SELECT * FROM videos WHERE streaming_url = ? AND status = "active" ORDER BY created_at DESC LIMIT 1',
        [streamingUrl]
      );
      if (urlRows.length > 0) {
        return urlRows[0];
      }
    }
    
    // Check by file_path (for local files)
    if (filePath && filePath.trim() !== '') {
      const [pathRows] = await pool.execute(
        'SELECT * FROM videos WHERE file_path = ? AND status = "active" ORDER BY created_at DESC LIMIT 1',
        [filePath]
      );
      if (pathRows.length > 0) {
        return pathRows[0];
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error checking for duplicate video:', error);
    return null;
  }
}

/**
 * Check if a video with the same title already exists
 * @param {string} title - The title to check
 * @param {boolean} includeInactive - If true, also check inactive videos
 */
export async function getVideoByTitle(title, includeInactive = false) {
  if (!title || title.trim() === '') {
    return null;
  }
  
  let query = 'SELECT * FROM videos WHERE title = ?';
  if (!includeInactive) {
    query += ' AND status = "active"';
  }
  query += ' ORDER BY created_at DESC LIMIT 1';
  
  try {
    const [rows] = await pool.execute(query, [title.trim()]);
    return rows[0] || null;
  } catch (error) {
    console.error('Error checking for duplicate title:', error);
    return null;
  }
}

/**
 * Get video by redirect slug (short URL)
 */
export async function getVideoByRedirectSlug(redirectSlug, includeInactive = false) {
  let query = 'SELECT * FROM videos WHERE redirect_slug = ?';
  if (!includeInactive) {
    query += ' AND status = "active"';
  }
  query += ' ORDER BY version DESC LIMIT 1';
  const [rows] = await pool.execute(query, [redirectSlug]);
  return rows[0] || null;
}

/**
 * Get all videos with filters
 */
export async function getAllVideos(filters = {}) {
  // Check which columns exist before querying - check all possible columns
  // NOTE: 'course' and 'activity' are removed from schema
  const columnsToCheck = [
    'id', 'video_id', 'partner_id', 'title', 'description', 'language',
    'file_path', 'streaming_url', 'qr_url', 'thumbnail_url', 'redirect_slug',
    'duration', 'size', 'version', 'views', 'status', 'created_at', 'updated_at',
    'grade', 'lesson', 'topic', 'subject', 'module', 'unit'
  ];
  
  // Check existence of all columns
  const columnChecks = {};
  for (const col of columnsToCheck) {
    columnChecks[col] = await columnExists(col);
  }
  
  // Build SELECT query with only existing columns (start with required ones)
  const selectColumns = ['id', 'video_id', 'title']; // Required columns that should always exist
  
  // Add optional columns only if they exist
  const optionalColumns = [
    'partner_id', 'description', 'language', 'file_path', 'streaming_url',
    'qr_url', 'thumbnail_url', 'redirect_slug', 'duration', 'size',
    'views', 'status', 'created_at', 'updated_at', 'grade', 'lesson', 'topic'
  ];
  
  for (const col of optionalColumns) {
    if (columnChecks[col]) {
      selectColumns.push(col);
    }
  }
  
  // Add version with explicit CAST to preserve decimal values (e.g., 1.1, 1.2)
  // This ensures MySQL returns the version with decimal precision
  if (columnChecks['version']) {
    selectColumns.push('CAST(version AS DECIMAL(10,2)) as version');
    console.log('[getAllVideos] ✓ Adding version column with DECIMAL cast to preserve decimal values');
  }
  
  // CRITICAL: Add subject/course/module/unit if they exist - these are essential for display
  // Ensure these are ALWAYS included when they exist
  if (columnChecks['subject']) {
    selectColumns.push('subject');
    console.log('[getAllVideos] ✓ Adding subject column to SELECT query');
  } else {
    console.warn('[getAllVideos] ⚠️ Subject column does not exist!');
  }
  // Course column removed from schema - no longer selecting it
  if (columnChecks['module']) {
    selectColumns.push('module');
    console.log('[getAllVideos] ✓ Adding module column to SELECT query');
  } else {
    console.warn('[getAllVideos] ⚠️ Module column does not exist!');
  }
  if (columnChecks['unit']) {
    selectColumns.push('unit');
  }
  
  // Store column existence for use in filters
  const hasSubjectColumn = columnChecks['subject'];
  const hasCourseColumn = columnChecks['course'];
  const hasModuleColumn = columnChecks['module'];
  const hasUnitColumn = columnChecks['unit'];
  
  // Log the final SELECT columns to verify subject and module are included
  console.log('[getAllVideos] Final SELECT columns:', selectColumns);
  console.log('[getAllVideos] Column existence check:', {
    subject: hasSubjectColumn,
    course: hasCourseColumn,
    module: hasModuleColumn,
    unit: hasUnitColumn
  });
  
  let query = `SELECT ${selectColumns.join(', ')} FROM videos WHERE 1=1`;
  const params = [];
  
  // Search filter - searches in title, description, video_id, subject, grade, lesson, module, activity, topic
  if (filters.search) {
    const searchConditions = ['title LIKE ?', 'description LIKE ?', 'video_id LIKE ?'];
    const searchTerm = `%${filters.search}%`;
    const searchParams = [searchTerm, searchTerm, searchTerm];
    
    // Add column-based searches only if columns exist
    if (hasSubjectColumn) {
      searchConditions.push('subject LIKE ?');
      searchParams.push(searchTerm);
    }
    if (hasModuleColumn) {
      searchConditions.push('module LIKE ?');
      searchParams.push(searchTerm);
    }
    if (hasUnitColumn) {
      searchConditions.push('unit LIKE ?');
      searchParams.push(searchTerm);
    }
    searchConditions.push('grade LIKE ?', 'lesson LIKE ?', 'topic LIKE ?');
    searchParams.push(searchTerm, searchTerm, searchTerm);
    
    query += ` AND (${searchConditions.join(' OR ')})`;
    params.push(...searchParams);
  }
  
  // Filter by subject (check both subject and course columns)
  // Use case-insensitive comparison for better matching
  if (filters.subject && filters.subject.trim()) {
    const subjectValue = filters.subject.trim();
    if (hasSubjectColumn) {
      // Use LOWER() for case-insensitive comparison
      query += ' AND LOWER(TRIM(subject)) = LOWER(TRIM(?))';
      params.push(subjectValue);
      console.log('[getAllVideos] ✓ Filtering by subject:', subjectValue, '(hasSubjectColumn:', hasSubjectColumn, ')');
    } else if (hasCourseColumn) {
      query += ' AND LOWER(TRIM(course)) = LOWER(TRIM(?))';
      params.push(subjectValue);
      console.log('[getAllVideos] ✓ Filtering by course (legacy):', subjectValue);
    } else {
      console.warn('[getAllVideos] ⚠️ Subject filter provided but neither subject nor course column exists!');
    }
  }
  
  // Support legacy 'course' filter for backward compatibility
  if (filters.course && filters.course.trim()) {
    const courseValue = filters.course.trim();
    if (hasSubjectColumn) {
      query += ' AND LOWER(TRIM(subject)) = LOWER(TRIM(?))';
      params.push(courseValue);
      console.log('[getAllVideos] ✓ Filtering by course (mapped to subject):', courseValue);
    } else if (hasCourseColumn) {
      query += ' AND LOWER(TRIM(course)) = LOWER(TRIM(?))';
      params.push(courseValue);
      console.log('[getAllVideos] ✓ Filtering by course (legacy):', courseValue);
    }
  }
  
  if (filters.grade) {
    query += ' AND grade = ?';
    params.push(filters.grade);
  }
  
  if (filters.lesson) {
    query += ' AND lesson = ?';
    params.push(filters.lesson);
  }
  
  // Filter by module only if column exists
  if (filters.module && hasModuleColumn) {
    query += ' AND module = ?';
    params.push(filters.module);
  }
  
  // Filter by module number (extract numeric part from module field)
  if (filters.moduleNumber && hasModuleColumn) {
    // Extract number from module field and match
    // This handles cases like "Module 1", "1", "M1", "Module1", etc.
    const moduleNum = parseInt(filters.moduleNumber);
    if (!isNaN(moduleNum)) {
      // Match if module contains the number (handles "Module 1", "1", "M1", etc.)
      query += ' AND (module LIKE ? OR module LIKE ? OR module LIKE ? OR module = ?)';
      params.push(`%${moduleNum}%`, `%Module ${moduleNum}%`, `%M${moduleNum}%`, filters.moduleNumber);
    } else {
      // If not a number, just do a text search
      query += ' AND module LIKE ?';
      params.push(`%${filters.moduleNumber}%`);
    }
  }
  
  if (filters.activity) {
    query += ' AND activity = ?';
    params.push(filters.activity);
  }
  
  // Filter by unit only if column exists
  if (filters.unit && hasUnitColumn) {
    query += ' AND unit = ?';
    params.push(filters.unit);
  }
  
  if (filters.status && filters.status.trim()) {
    query += ' AND status = ?';
    params.push(filters.status.trim());
  }
  
  // Filter by version (supports both numeric and string versions, including floating point)
  if (filters.version !== undefined && filters.version !== null && filters.version !== '') {
    const versionStr = String(filters.version).trim();
    const versionNum = parseFloat(versionStr);
    if (!isNaN(versionNum) && isFinite(versionNum)) {
      // If it's a valid number, compare as number (handles floating point like 1.5, 2.3)
      query += ' AND CAST(version AS DECIMAL(10,2)) = ?';
      params.push(versionNum);
    } else {
      // If it's not a number, compare as string
      query += ' AND version = ?';
      params.push(versionStr);
    }
  }
  
  // Don't filter by file_path - include all videos regardless of storage location
  // This ensures videos in upload/, my-storage/, and other locations are all shown
  
  // Get total count for pagination info (before adding LIMIT/OFFSET)
  const countQuery = query.replace(/SELECT .* FROM/i, 'SELECT COUNT(*) as total FROM');
  const countQueryClean = countQuery.replace(/ORDER BY .*/i, ''); // Remove ORDER BY from count query
  const [countRows] = await pool.execute(countQueryClean, params);
  const total = countRows[0]?.total || 0;
  
  // Add pagination - default to 50 videos per page to improve performance
  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 50; // Default 50, max 200
  const safeLimit = Math.min(limit, 200); // Cap at 200 to prevent abuse
  const offset = (page - 1) * safeLimit;
  
  // Add ORDER BY and LIMIT/OFFSET using direct values (not placeholders) to avoid MySQL parameter binding issues
  query += ' ORDER BY created_at DESC';
  query += ` LIMIT ${safeLimit} OFFSET ${offset}`;
  
  // Log the final query for debugging
  console.log('[getAllVideos] Final query:', query);
  console.log('[getAllVideos] Query params:', params);
  console.log('[getAllVideos] Pagination: page=', page, 'limit=', safeLimit, 'offset=', offset);
  
  const [rows] = await pool.execute(query, params);
  
  console.log(`[getAllVideos] Found ${rows.length} videos (page ${page} of ${Math.ceil(total / safeLimit)}, total: ${total})`);
  
  console.log(`[getAllVideos] Found ${rows.length} videos`);
  console.log(`[getAllVideos] Query executed: ${query}`);
  console.log(`[getAllVideos] Selected columns count: ${selectColumns.length}`);
  
  // CRITICAL: Verify what we actually got from database
  // Also do a direct SELECT * query for the first video to compare
  if (rows.length > 0) {
    const sampleVideo = rows[0];
    
    // Do a direct SELECT * query to see ALL columns for comparison
    try {
      const [directRows] = await pool.execute('SELECT * FROM videos WHERE id = ?', [sampleVideo.id]);
      if (directRows.length > 0) {
        const directVideo = directRows[0];
        console.log('[getAllVideos] ===== DIRECT DATABASE CHECK =====');
        console.log('[getAllVideos] Direct SELECT * result for first video:', {
          id: directVideo.id,
          video_id: directVideo.video_id,
          subject: directVideo.subject,
          module: directVideo.module,
          grade: directVideo.grade,
          unit: directVideo.unit,
          lesson: directVideo.lesson,
          hasSubjectColumn: 'subject' in directVideo,
          hasModuleColumn: 'module' in directVideo,
          allColumns: Object.keys(directVideo).filter(k => ['subject', 'module', 'grade', 'unit', 'lesson'].includes(k))
        });
        console.log('[getAllVideos] =================================');
      }
    } catch (directError) {
      console.warn('[getAllVideos] Could not perform direct database check:', directError.message);
    }
    
    // Log subject information to verify it's being returned - show all fields including nulls
    console.log('[getAllVideos] Sample video from dynamic SELECT query:', {
      id: sampleVideo.id,
      video_id: sampleVideo.video_id,
      title: sampleVideo.title,
      subject: sampleVideo.subject,
      grade: sampleVideo.grade,
      unit: sampleVideo.unit,
      lesson: sampleVideo.lesson,
      module: sampleVideo.module,
      description: sampleVideo.description,
      status: sampleVideo.status,
      // Show raw database values
      subjectType: typeof sampleVideo.subject,
      gradeType: typeof sampleVideo.grade,
      unitType: typeof sampleVideo.unit,
      lessonType: typeof sampleVideo.lesson,
      moduleType: typeof sampleVideo.module,
      // Show which columns are actually present in result
      hasSubject: 'subject' in sampleVideo,
      hasModule: 'module' in sampleVideo,
      hasCourse: 'course' in sampleVideo
    });
    
    // Log all column names to verify all fields are being selected
    console.log('[getAllVideos] Available columns in result:', Object.keys(sampleVideo));
  }
    
    // Helper to preserve values including "0"
    const preserveValue = (val) => {
      if (val === undefined || val === null) return null;
      const str = String(val).trim();
      return str !== '' ? str : null;
    };
  
  // Map videos with proper field mapping
  const mappedVideos = rows.map((video, index) => {
    // Determine subject value (course column removed, only use subject)
    // Preserve actual values including "0" and empty strings that might be valid
    const subjectValue = (video.subject !== undefined && video.subject !== null && String(video.subject).trim() !== '') 
      ? String(video.subject).trim() 
      : null;
    
    // CRITICAL: Explicitly map module value - ensure it's always included in result
    const moduleValue = preserveValue(video.module);
    
    const result = {
      ...video,
      // Explicitly include all subject information fields, preserving actual values
      subject: subjectValue,
      course: subjectValue, // Backward compatibility - map to subject (course column removed)
      grade: preserveValue(video.grade),
      unit: preserveValue(video.unit),
      lesson: preserveValue(video.lesson),
      module: moduleValue, // CRITICAL: Explicitly set module value
      // Explicitly preserve size field (file size in bytes)
      size: video.size !== null && video.size !== undefined ? Number(video.size) : (video.size || 0),
      // Explicitly preserve duration field (duration in seconds)
      duration: video.duration !== null && video.duration !== undefined ? Number(video.duration) : (video.duration || 0),
      // Format version to show decimals without trailing zeros (e.g., 1.1, 1.2, 1.3)
      version: video.version !== null && video.version !== undefined 
        ? (() => {
            if (typeof video.version === 'number') {
              if (Number.isInteger(video.version)) {
                return String(video.version);
              }
              return video.version.toFixed(2).replace(/\.?0+$/, '');
            }
            const str = String(video.version).trim();
            if (str === '') return null;
            const num = parseFloat(str);
            if (!isNaN(num)) {
              if (Number.isInteger(num)) {
                return String(num);
              }
              return num.toFixed(2).replace(/\.?0+$/, '');
            }
            return str;
          })()
        : (video.version || null),
      description: video.description !== undefined ? video.description : null
    };
    
    return result;
  });
  
  // Return videos with pagination metadata
  return {
    videos: mappedVideos,
    pagination: {
      page,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit),
      hasMore: offset + rows.length < total
    }
  };
}

/**
 * Get unique filter values for dropdowns
 */
export async function getFilterValues(subjectFilter = null) {
  try {
    // Build base WHERE clause - if subject filter exists, include it with AND for additional conditions
    // If no subject filter, just use WHERE for additional conditions
    let baseWhere = '';
    const queryParams = [];
    if (subjectFilter && subjectFilter.trim()) {
      baseWhere = 'WHERE LOWER(TRIM(subject)) = LOWER(TRIM(?)) AND';
      queryParams.push(subjectFilter.trim());
    } else {
      baseWhere = 'WHERE';
    }
    
    // Try to get unit column, fallback if it doesn't exist
    let unitsQuery = `SELECT DISTINCT unit FROM videos ${baseWhere} unit IS NOT NULL AND unit != "" ORDER BY unit ASC`;
    let units = [];
    try {
      const [unitsRows] = await pool.execute(unitsQuery, queryParams);
      units = unitsRows.map(row => row.unit).filter(Boolean);
    } catch (unitError) {
      console.log('[getFilterValues] Unit column not found, skipping');
    }

    const queries = {
      subjects: 'SELECT DISTINCT subject FROM videos WHERE subject IS NOT NULL AND subject != "" ORDER BY subject ASC',
      grades: `SELECT DISTINCT grade FROM videos ${baseWhere} grade IS NOT NULL AND grade != "" ORDER BY grade ASC`,
      lessons: `SELECT DISTINCT lesson FROM videos ${baseWhere} lesson IS NOT NULL AND lesson != "" ORDER BY lesson ASC`,
      modules: `SELECT DISTINCT module FROM videos ${baseWhere} module IS NOT NULL AND module != "" ORDER BY module ASC`,
      versions: `SELECT DISTINCT version FROM videos ${baseWhere} version IS NOT NULL ORDER BY CAST(version AS DECIMAL(10,2)) ASC`
    };

    const [subjects] = await pool.execute(queries.subjects);
    const [grades] = await pool.execute(queries.grades, queryParams);
    const [lessons] = await pool.execute(queries.lessons, queryParams);
    const [modules] = await pool.execute(queries.modules, queryParams);
    
    // Get versions - handle both numeric and string versions
    let versions = [];
    try {
      const [versionsRows] = await pool.execute(queries.versions, queryParams);
      versions = versionsRows.map(row => String(row.version)).filter(Boolean);
      // Sort versions numerically (handles floating point)
      versions.sort((a, b) => {
        const numA = parseFloat(a);
        const numB = parseFloat(b);
        if (!isNaN(numA) && !isNaN(numB)) {
          return numA - numB;
        }
        return a.localeCompare(b);
      });
    } catch (versionError) {
      console.log('[getFilterValues] Version column not found or error, skipping');
    }

    return {
      subjects: subjects.map(row => row.subject).filter(Boolean),
      courses: subjects.map(row => row.subject).filter(Boolean), // Keep 'courses' for backward compatibility
      grades: grades.map(row => row.grade).filter(Boolean),
      units: units,
      lessons: lessons.map(row => row.lesson).filter(Boolean),
      modules: modules.map(row => row.module).filter(Boolean),
      versions: versions
    };
  } catch (error) {
    console.error('Error fetching filter values:', error);
    // Return empty arrays if there's an error (e.g., column doesn't exist)
    return {
      courses: [],
      grades: [],
      units: [],
      lessons: [],
      modules: []
    };
  }
}

/**
 * Increment view count for a video
 */
export async function incrementVideoViews(videoId) {
  try {
    // Check if views column exists, if not add it
    const viewsColumnExists = await columnExists('views');
    if (!viewsColumnExists) {
      try {
        await pool.execute('ALTER TABLE videos ADD COLUMN views INT DEFAULT 0 COMMENT "Number of times video has been viewed"');
        console.log('[incrementVideoViews] Added views column to videos table');
      } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
          console.warn('[incrementVideoViews] Could not add views column:', err.message);
        }
      }
    }
    
    // Increment views count
    // Try by database ID first, then by video_id
    let result;
    try {
      // Try incrementing by database ID (if videoId is numeric)
      if (!isNaN(videoId)) {
        const [updateResult] = await pool.execute(
          'UPDATE videos SET views = COALESCE(views, 0) + 1, updated_at = NOW() WHERE id = ?',
          [parseInt(videoId)]
        );
        if (updateResult.affectedRows > 0) {
          result = updateResult;
        }
      }
      
      // If not updated by ID, try by video_id
      if (!result || result.affectedRows === 0) {
        const [updateResult] = await pool.execute(
          'UPDATE videos SET views = COALESCE(views, 0) + 1, updated_at = NOW() WHERE video_id = ?',
          [videoId]
        );
        result = updateResult;
      }
      
      // If still not updated, try by redirect_slug
      if (!result || result.affectedRows === 0) {
        const [updateResult] = await pool.execute(
          'UPDATE videos SET views = COALESCE(views, 0) + 1, updated_at = NOW() WHERE redirect_slug = ?',
          [videoId]
        );
        result = updateResult;
      }
      
      if (result && result.affectedRows > 0) {
        // Fetch updated view count
        const [rows] = await pool.execute(
          'SELECT views FROM videos WHERE id = ? OR video_id = ? OR redirect_slug = ? LIMIT 1',
          [videoId, videoId, videoId]
        );
        const newViews = rows[0]?.views || 0;
        console.log(`[incrementVideoViews] ✓ Incremented views for video: ${videoId}, new count: ${newViews}`);
        return newViews;
      } else {
        console.warn(`[incrementVideoViews] ⚠️ No video found to increment views for: ${videoId}`);
        return null;
      }
    } catch (updateError) {
      console.error('[incrementVideoViews] Error incrementing views:', updateError.message);
      throw updateError;
    }
  } catch (error) {
    console.error('[incrementVideoViews] Error:', error.message);
    throw error;
  }
}

/**
 * Check if a column exists in the videos table
 */
async function columnExists(columnName) {
  try {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) as count 
       FROM information_schema.columns 
       WHERE table_schema = DATABASE() 
       AND table_name = 'videos' 
       AND LOWER(column_name) = LOWER(?)`,
      [columnName]
    );
    // Handle both lowercase and uppercase count fields
    const count = rows[0]?.count || rows[0]?.COUNT || 0;
    return count > 0;
  } catch (error) {
    console.error(`Error checking column ${columnName}:`, error.message);
    return false;
  }
}

/**
 * Ensure core video metadata columns exist (subject/course/grade/unit/lesson/module/activity/topic)
 */
async function ensureVideoColumns() {
  const columns = [
    { name: 'subject', definition: "ALTER TABLE videos ADD COLUMN subject VARCHAR(255) NULL AFTER id" },
    { name: 'course', definition: "ALTER TABLE videos ADD COLUMN course VARCHAR(255) NULL AFTER subject" },
    { name: 'grade', definition: "ALTER TABLE videos ADD COLUMN grade VARCHAR(255) NULL" },
    { name: 'unit', definition: "ALTER TABLE videos ADD COLUMN unit VARCHAR(255) NULL" },
    { name: 'lesson', definition: "ALTER TABLE videos ADD COLUMN lesson VARCHAR(255) NULL" },
    { name: 'module', definition: "ALTER TABLE videos ADD COLUMN module VARCHAR(255) NULL" },
    { name: 'activity', definition: "ALTER TABLE videos ADD COLUMN activity VARCHAR(255) NULL" },
    { name: 'topic', definition: "ALTER TABLE videos ADD COLUMN topic VARCHAR(255) NULL" }
  ];

  for (const col of columns) {
    const exists = await columnExists(col.name);
    if (!exists) {
      try {
        await pool.execute(col.definition);
        console.log(`[ensureVideoColumns] Added missing column: ${col.name}`);
      } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
          console.warn(`[ensureVideoColumns] Could not add column ${col.name}:`, err.message);
        }
      }
    }
  }
}

/**
 * Update video metadata
 */
export async function updateVideo(id, updates) {
  // Ensure columns exist before updating
  await ensureVideoColumns();
  
  const allowedFields = [
    'title', 'description', 'language', 'status',
    'subject', 'course', 'grade', 'unit', 'lesson', 'module', 'version',
    'streaming_url', 'file_path', 'thumbnail_url', 'size', 'duration'
  ];
  
  // Check which columns exist
  const hasSubjectColumn = await columnExists('subject');
  const hasCourseColumn = await columnExists('course');
  const hasModuleColumn = await columnExists('module');
  const hasUnitColumn = await columnExists('unit');
  const hasVersionColumn = await columnExists('version');
  
  // Helper function to safely convert values to strings, preserving non-empty values
  const safeStringValue = (val) => {
    if (val === undefined || val === null) return null;
    const str = String(val).trim();
    return str !== '' ? str : null;
  };
  
  const fields = [];
  const values = [];
  
  console.log('[updateVideo] Updating video ID:', id);
  console.log('[updateVideo] Updates received:', updates);
  console.log('[updateVideo] Column existence:', {
    subject: hasSubjectColumn,
    module: hasModuleColumn,
    unit: hasUnitColumn,
    version: hasVersionColumn
  });
  
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value !== undefined) {
      // Map column name (course field removed, only subject exists)
      let dbColumn = key;
      if (key === 'subject' && !hasSubjectColumn) {
        // Skip if subject column doesn't exist (shouldn't happen after ensureVideoColumns)
        console.warn('[updateVideo] Subject column does not exist, skipping subject update');
        continue;
      } else if (key === 'course') {
        // Map course to subject for backward compatibility (but course column is removed)
        dbColumn = 'subject';
        console.log('[updateVideo] Mapping course to subject (course column removed)');
      }
      
      // Skip updating columns that don't exist (except subject/course which are handled above)
      if ((key === 'module' && !hasModuleColumn) || (key === 'unit' && !hasUnitColumn) || (key === 'version' && !hasVersionColumn)) {
        console.warn(`[updateVideo] Column ${key} does not exist, skipping update`);
        continue;
      }
      
      // Convert value to string and preserve non-empty values
      // Special handling: preserve actual values including "0", "1", etc.
      // CRITICAL: Empty strings should be explicitly set to NULL in database
      // Special handling for version, size, and duration: support numbers
      let processedValue;
      if (value === null || value === undefined || value === '') {
        processedValue = null;
      } else if (key === 'version') {
        // For version field, support both integers and floating point numbers
        const numValue = typeof value === 'number' ? value : parseFloat(value);
        if (!isNaN(numValue) && isFinite(numValue)) {
          processedValue = numValue; // Keep as number for database
        } else {
          // If not a valid number, convert to string
          const str = String(value).trim();
          processedValue = str !== '' ? str : null;
        }
      } else if (key === 'size' || key === 'duration') {
        // For size and duration, always treat as numbers (bytes and seconds)
        const numValue = typeof value === 'number' ? value : parseInt(value, 10);
        if (!isNaN(numValue) && isFinite(numValue)) {
          processedValue = numValue; // Keep as number for database
        } else {
          processedValue = null; // Invalid number, set to NULL
        }
      } else {
        const str = String(value).trim();
        // Preserve the value if it's not empty, including "0" and "1"
        processedValue = str !== '' ? str : null;
      }
      
      // CRITICAL: Always use parameterized queries, even for NULL values
      // This ensures the value is explicitly set in the database
      fields.push(`${dbColumn} = ?`);
      values.push(processedValue);
      
      console.log(`[updateVideo] Adding field: ${dbColumn} = ${processedValue === null ? 'NULL' : (typeof processedValue === 'number' ? processedValue : `"${processedValue}"`)} (original: ${JSON.stringify(value)}, type: ${typeof value})`);
    }
  }
  
  if (fields.length === 0) {
    console.warn('[updateVideo] No fields to update');
    return null;
  }
  
  values.push(id);
  const query = `UPDATE videos SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`;
  
  console.log('[updateVideo] Executing query:', query);
  console.log('[updateVideo] With values:', values);
  
  try {
    const [result] = await pool.execute(query, values);
    
    // Verify the update was successful
    if (result.affectedRows > 0) {
      // Immediately fetch the updated record to verify values were saved
      try {
        // Build SELECT query dynamically based on which columns exist
        const verifyColumns = [];
        if (hasSubjectColumn) verifyColumns.push('subject');
        if (hasModuleColumn) verifyColumns.push('module');
        if (hasUnitColumn) verifyColumns.push('unit');
        verifyColumns.push('grade', 'lesson'); // These should always exist
        
        const verifyQuery = `SELECT ${verifyColumns.join(', ')} FROM videos WHERE id = ?`;
        const [verifyRows] = await pool.execute(verifyQuery, [id]);
        if (verifyRows.length > 0) {
          const verified = verifyRows[0];
          console.log('[updateVideo] ✓ Values verified after update:', {
            id: id,
            subject: verified.subject,
            module: verified.module,
            grade: verified.grade,
            unit: verified.unit,
            lesson: verified.lesson
          });
          
          // Warn if expected values are still NULL
          if (updates.subject !== undefined && updates.subject !== null) {
            if (verified.subject === null) {
              console.warn('[updateVideo] ⚠️ WARNING: Subject value was not saved! Expected:', updates.subject, 'Got:', verified.subject);
            }
          }
          if (updates.module !== undefined && updates.module !== null && verified.module === null) {
            console.warn('[updateVideo] ⚠️ WARNING: Module value was not saved! Expected:', updates.module, 'Got:', verified.module);
          }
        }
      } catch (verifyError) {
        console.warn('[updateVideo] Could not verify saved values:', verifyError.message);
        console.warn('[updateVideo] Verify error details:', verifyError);
      }
    }
    
    return result.affectedRows > 0;
  } catch (error) {
    console.error('[updateVideo] Database update error:', error.message);
    console.error('[updateVideo] Query:', query);
    console.error('[updateVideo] Values:', values);
    throw error;
  }
}

/**
 * Delete video (hard delete: remove video, versions, and redirect)
 */
export async function deleteVideo(id) {
  // Fetch video first to verify it exists
  const video = await getVideoById(id);
  if (!video) {
    return false;
  }

  // Soft delete: Set status to 'deleted' instead of hard deleting
  // This allows videos to be restored from trash
  // Keep redirects and video_versions for restoration
  const query = 'UPDATE videos SET status = "deleted", updated_at = NOW() WHERE id = ?';
  const [result] = await pool.execute(query, [id]);
  
  console.log(`[deleteVideo] Soft deleted video ID ${id} (video_id: ${video.video_id})`);
  return result.affectedRows > 0;
}

/**
 * Get all deleted videos
 */
export async function getDeletedVideos() {
  const query = 'SELECT * FROM videos WHERE status = "deleted" ORDER BY updated_at DESC';
  const [rows] = await pool.execute(query);
  return rows;
}

/**
 * Restore deleted video (set status back to active)
 */
export async function restoreVideo(id) {
  const query = 'UPDATE videos SET status = "active", updated_at = NOW() WHERE id = ?';
  const [result] = await pool.execute(query, [id]);
  return result.affectedRows > 0;
}

/**
 * Permanently delete video (hard delete: remove from database)
 * This removes the video record, redirects, captions, and related data permanently
 */
export async function permanentDeleteVideo(id) {
  // Fetch video first to verify it exists and is deleted
  const video = await getVideoById(id);
  if (!video) {
    return false;
  }

  // Hard delete: Remove video record permanently
  // Also delete related redirects and captions
  try {
    const { deleteAllMediaForVideo } = await import('../utils/vttLifecycle.js');
    const mediaResult = await deleteAllMediaForVideo(video);
    console.log(
      `[permanentDeleteVideo] Deleted media for ${video.video_id}: ` +
      `${mediaResult.filesDeleted} VTT file(s), video=${mediaResult.videoDeleted}`
    );
    
    // Delete redirects associated with this video
    if (video.redirect_slug) {
      await pool.execute('DELETE FROM redirects WHERE slug = ?', [video.redirect_slug]);
    }
    if (video.video_id) {
      await pool.execute('DELETE FROM redirects WHERE slug = ?', [video.video_id]);
    }

    // Delete video record permanently
    const query = 'DELETE FROM videos WHERE id = ?';
    const [result] = await pool.execute(query, [id]);
    
    console.log(`[permanentDeleteVideo] Permanently deleted video ID ${id} (video_id: ${video.video_id})`);
    return result.affectedRows > 0;
  } catch (error) {
    console.error(`[permanentDeleteVideo] Error permanently deleting video ID ${id}:`, error);
    throw error;
  }
}

/**
 * Permanently delete multiple videos at once
 */
export async function permanentDeleteVideos(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { success: false, deleted: 0, errors: [] };
  }

  const results = {
    success: true,
    deleted: 0,
    errors: []
  };

  for (const id of ids) {
    try {
      const deleted = await permanentDeleteVideo(id);
      if (deleted) {
        results.deleted++;
      } else {
        results.errors.push({ id, error: 'Video not found or already deleted' });
      }
    } catch (error) {
      results.success = false;
      results.errors.push({ id, error: error.message });
    }
  }

  return results;
}

/**
 * Get latest version number for a video ID
 */
export async function getLatestVersion(videoId) {
  const query = 'SELECT MAX(version) as maxVersion FROM videos WHERE video_id = ?';
  const [rows] = await pool.execute(query, [videoId]);
  return (rows[0]?.maxVersion || 0) + 1;
}

/**
 * Create video version entry
 */
export async function createVideoVersion(videoId, version, filePath, size) {
  const query = `
    INSERT INTO video_versions (video_id, version, file_path, size, created_at)
    VALUES (?, ?, ?, ?, NOW())
  `;
  
  const [result] = await pool.execute(query, [videoId, version, filePath, size]);
  return result.insertId;
}

/**
 * Get all versions for a video ID
 */
export async function getVideoVersions(videoId) {
  const query = 'SELECT * FROM video_versions WHERE video_id = ? ORDER BY version DESC';
  const [rows] = await pool.execute(query, [videoId]);
  return rows;
}

/**
 * Build streaming URL - Always use localhost for local streaming
 * This ensures videos are streamed from localhost instead of Cloudflare URLs
 * @param {string} relativePath - Relative path to the video file
 * @param {string|null} videoId - Video ID
 * @param {string|null} redirectSlug - Redirect slug for short URLs
 * @param {Object|null} req - Express request object (optional, for detecting protocol)
 */
export function buildStreamingUrl(relativePath, videoId = null, redirectSlug = null, req = null) {
  const baseUrl = getBaseUrl(req);
  
  // Always use localhost streaming endpoint for proper range request support
  // Use redirect_slug if available (for short URLs like /api/s/:slug), otherwise use videoId
  if (redirectSlug) {
    return `${baseUrl}/api/s/${redirectSlug}`;
  }
  if (videoId) {
    return `${baseUrl}/api/videos/${videoId}/stream`;
  }
  // Fallback to static file serving if no videoId provided
  return `${config.cdn.localBaseUrl}${relativePath}`;
}

