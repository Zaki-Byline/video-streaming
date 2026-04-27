#!/usr/bin/env node

/**
 * Check Video IDs in Database
 * 
 * Lists all video IDs in the database to help identify which videos exist
 * 
 * Usage:
 *   node scripts/checkVideoIds.js [searchTerm]
 */

import pool from '../config/database.js';

const searchTerm = process.argv[2] || null;

async function main() {
  try {
    let query = 'SELECT video_id, title, status FROM videos';
    let params = [];
    
    if (searchTerm) {
      query += ' WHERE video_id LIKE ? OR title LIKE ?';
      const searchPattern = `%${searchTerm}%`;
      params = [searchPattern, searchPattern];
    }
    
    query += ' ORDER BY video_id LIMIT 50';
    
    const [rows] = await pool.execute(query, params);
    
    if (rows.length === 0) {
      console.log('No videos found in database');
      if (searchTerm) {
        console.log(`(Searching for: ${searchTerm})`);
      }
      await pool.end();
      return;
    }
    
    console.log(`\n📹 Found ${rows.length} video(s) in database:\n`);
    rows.forEach((video, index) => {
      console.log(`${index + 1}. ${video.video_id}`);
      console.log(`   Title: ${video.title || '(no title)'}`);
      console.log(`   Status: ${video.status}`);
      console.log('');
    });
    
    if (rows.length === 50) {
      console.log('... (showing first 50 results)');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

main();


