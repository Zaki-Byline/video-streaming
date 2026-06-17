import pool from '../config/database.js';

const columnCache = new Map();

async function columnExists(columnName) {
  if (columnCache.has(columnName)) return columnCache.get(columnName);
  try {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) as cnt FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'videos' AND COLUMN_NAME = ?`,
      [columnName]
    );
    const exists = rows[0]?.cnt > 0;
    columnCache.set(columnName, exists);
    return exists;
  } catch {
    return false;
  }
}

export function parseVideoMetadataFilters(query = {}) {
  return {
    search: (query.search || '').trim(),
    subject: (query.subject || '').trim(),
    course: (query.course || '').trim(),
    grade: query.grade ? String(query.grade).trim() : '',
    unit: query.unit ? String(query.unit).trim() : '',
    lesson: query.lesson ? String(query.lesson).trim() : '',
    module: query.module ? String(query.module).trim() : '',
    moduleNumber: query.moduleNumber ? String(query.moduleNumber).trim() : '',
    version: query.version !== undefined && query.version !== '' ? String(query.version).trim() : '',
    descriptionStatus: query.descriptionStatus || 'all'
  };
}

export async function appendVideoMetadataFilters(query, params, filters = {}) {
  const hasSubjectColumn = await columnExists('subject');
  const hasCourseColumn = await columnExists('course');
  const hasModuleColumn = await columnExists('module');
  const hasUnitColumn = await columnExists('unit');

  if (filters.search) {
    const searchConditions = ['title LIKE ?', 'description LIKE ?', 'video_id LIKE ?'];
    const searchTerm = `%${filters.search}%`;
    const searchParams = [searchTerm, searchTerm, searchTerm];

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
    searchConditions.push('grade LIKE ?', 'lesson LIKE ?');
    searchParams.push(searchTerm, searchTerm);

    query += ` AND (${searchConditions.join(' OR ')})`;
    params.push(...searchParams);
  }

  if (filters.subject) {
    if (hasSubjectColumn) {
      query += ' AND LOWER(TRIM(subject)) = LOWER(TRIM(?))';
      params.push(filters.subject);
    } else if (hasCourseColumn) {
      query += ' AND LOWER(TRIM(course)) = LOWER(TRIM(?))';
      params.push(filters.subject);
    }
  }

  if (filters.course && filters.course !== filters.subject) {
    if (hasSubjectColumn) {
      query += ' AND LOWER(TRIM(subject)) = LOWER(TRIM(?))';
      params.push(filters.course);
    } else if (hasCourseColumn) {
      query += ' AND LOWER(TRIM(course)) = LOWER(TRIM(?))';
      params.push(filters.course);
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

  if (filters.module && hasModuleColumn) {
    query += ' AND module = ?';
    params.push(filters.module);
  }

  if (filters.moduleNumber && hasModuleColumn) {
    const moduleNum = parseInt(filters.moduleNumber, 10);
    if (!Number.isNaN(moduleNum)) {
      query += ' AND (module LIKE ? OR module LIKE ? OR module LIKE ? OR module = ?)';
      params.push(`%${moduleNum}%`, `%Module ${moduleNum}%`, `%M${moduleNum}%`, filters.moduleNumber);
    } else {
      query += ' AND module LIKE ?';
      params.push(`%${filters.moduleNumber}%`);
    }
  }

  if (filters.unit && hasUnitColumn) {
    query += ' AND unit = ?';
    params.push(filters.unit);
  }

  if (filters.version !== undefined && filters.version !== '') {
    const versionStr = String(filters.version).trim();
    const versionNum = parseFloat(versionStr);
    if (!Number.isNaN(versionNum) && Number.isFinite(versionNum)) {
      query += ' AND CAST(version AS DECIMAL(10,2)) = ?';
      params.push(versionNum);
    } else {
      query += ' AND version = ?';
      params.push(versionStr);
    }
  }

  if (filters.descriptionStatus === 'missing') {
    query += ` AND (
      description_source IS NULL
      OR description_source NOT IN ('openai', 'gemini')
      OR description IS NULL
      OR TRIM(description) = ''
    )`;
  } else if (filters.descriptionStatus === 'has') {
    query += ` AND description_source IN ('openai', 'gemini')
      AND description IS NOT NULL AND TRIM(description) != ''`;
  }

  return { query, params };
}
