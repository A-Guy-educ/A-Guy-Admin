#!/usr/bin/env tsx
/**
 * Post-processing script for payload-types.ts
 * Replaces string literal union with Role enum import
 */

import fs from 'fs'
import path from 'path'

const PAYLOAD_TYPES_PATH = path.join(process.cwd(), 'src', 'payload-types.ts')

function fixPayloadTypes() {
  // Read the generated file
  let content = fs.readFileSync(PAYLOAD_TYPES_PATH, 'utf-8')

  // Check if already fixed
  if (content.includes("import { Role } from '@/collections/Users/roles'")) {
    console.log('✅ payload-types.ts already uses Role enum')
    return
  }

  // Add import at the top (after existing imports)
  const importStatement = `import { Role } from '@/collections/Users/roles'\n`

  // Find the last import statement
  const lastImportIndex = content.lastIndexOf('import ')
  if (lastImportIndex !== -1) {
    const nextLineAfterImport = content.indexOf('\n', lastImportIndex)
    content =
      content.slice(0, nextLineAfterImport + 1) +
      importStatement +
      content.slice(nextLineAfterImport + 1)
  } else {
    // No imports found, add at the beginning
    content = importStatement + content
  }

  // Replace role: 'admin' | 'student' with role: Role
  content = content.replace(/role:\s*'admin'\s*\|\s*'student'/g, 'role: Role')

  // Write back to file
  fs.writeFileSync(PAYLOAD_TYPES_PATH, content, 'utf-8')

  console.log('✅ Fixed payload-types.ts to use Role enum')
}

try {
  fixPayloadTypes()
} catch (error) {
  console.error('❌ Error fixing payload-types:', error)
  process.exit(1)
}
