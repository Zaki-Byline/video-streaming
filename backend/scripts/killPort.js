#!/usr/bin/env node

/**
 * Kill process using a specific port
 * 
 * Usage: node scripts/killPort.js [port]
 * Default port: 5000
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const port = process.argv[2] || '5000';

async function killProcessOnPort(port) {
  try {
    const isWindows = process.platform === 'win32';
    
    if (isWindows) {
      // Find process using the port
      const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
      const lines = stdout.trim().split('\n');
      
      const pids = new Set();
      for (const line of lines) {
        const match = line.match(/\s+(\d+)\s*$/);
        if (match && match[1] !== '0') {
          pids.add(match[1]);
        }
      }
      
      if (pids.size === 0) {
        console.log(`✅ No process found using port ${port}`);
        return;
      }
      
      // Kill all processes
      for (const pid of pids) {
        try {
          await execAsync(`taskkill /PID ${pid} /F`);
          console.log(`✅ Killed process ${pid} using port ${port}`);
        } catch (error) {
          console.warn(`⚠️  Could not kill process ${pid}: ${error.message}`);
        }
      }
    } else {
      // Linux/Mac
      const { stdout } = await execAsync(`lsof -ti:${port}`);
      const pids = stdout.trim().split('\n').filter(Boolean);
      
      if (pids.length === 0) {
        console.log(`✅ No process found using port ${port}`);
        return;
      }
      
      for (const pid of pids) {
        try {
          await execAsync(`kill -9 ${pid}`);
          console.log(`✅ Killed process ${pid} using port ${port}`);
        } catch (error) {
          console.warn(`⚠️  Could not kill process ${pid}: ${error.message}`);
        }
      }
    }
  } catch (error) {
    if (error.message.includes('findstr') || error.message.includes('lsof')) {
      console.log(`✅ No process found using port ${port}`);
    } else {
      console.error(`❌ Error: ${error.message}`);
    }
  }
}

killProcessOnPort(port);



