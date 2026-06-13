/**
 * Frontmatter validation for SuzuBlog posts.
 *
 * Validates every Markdown file under posts/ against the frontmatter
 * schema documented at https://suzu.zla.app/guide/posts/.
 *
 * Run via: node scripts/validate-frontmatter.mjs
 * Options:
 *   --ref <git-ref>              Validate posts as they exist at a git ref.
 *   --range <base..head>         Validate every commit in a git revision range.
 *   --commits-file <path>        Validate every commit listed in a file.
 *
 * Exits with code 1 if any file has invalid frontmatter.
 */

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import matter from 'gray-matter'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const postsDir = path.resolve(__dirname, '..', 'posts')

// --- Schema definition ------------------------------------------------------

/**
 * @typedef {'string'|'array'|'boolean'} FieldType
 */

/** @type {Record<string, FieldType>} */
const FIELD_TYPES = {
  title: 'string',
  date: 'string',
  author: 'string',
  thumbnail: 'string',
  redirect: 'string',
  tags: 'array',
  categories: 'array',
  showComments: 'boolean',
  showLicense: 'boolean',
  showThumbnail: 'boolean',
  autoSlug: 'boolean',
  status: 'string',
}

const ALLOWED_FIELDS = Object.keys(FIELD_TYPES)

const VALID_STATUSES = new Set(['published', 'unlisted', 'draft', 'hidden'])

// Matches the string formats preserved by src/services/content/getPostFromFile.ts.
// Dates should be quoted in YAML so gray-matter does not coerce them to Date objects.
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2})?$/
const ZERO_SHA = /^0+$/

// --- Git helpers -------------------------------------------------------------

/**
 * Run git with arguments and return stdout.
 * @param {string[]} args
 * @returns {string} Trimmed stdout from git.
 */
function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

/**
 * Parse CLI options.
 * @returns {{ ref?: string, range?: string, commitsFile?: string }} Parsed validation target options.
 */
function parseArgs() {
  /** @type {{ ref?: string, range?: string, commitsFile?: string }} */
  const options = {}
  const args = process.argv.slice(2)

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--') {
      continue
    }
    if (arg === '--ref') {
      options.ref = args[++i]
    }
    else if (arg.startsWith('--ref=')) {
      options.ref = arg.slice('--ref='.length)
    }
    else if (arg === '--range') {
      options.range = args[++i]
    }
    else if (arg.startsWith('--range=')) {
      options.range = arg.slice('--range='.length)
    }
    else if (arg === '--commits-file') {
      options.commitsFile = args[++i]
    }
    else if (arg.startsWith('--commits-file=')) {
      options.commitsFile = arg.slice('--commits-file='.length)
    }
    else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (options.ref != null && options.ref.trim() === '') {
    throw new Error('--ref requires a git ref')
  }
  if (options.range != null && options.range.trim() === '') {
    throw new Error('--range requires a git revision range')
  }
  if (options.commitsFile != null && options.commitsFile.trim() === '') {
    throw new Error('--commits-file requires a file path')
  }
  if ([options.ref, options.range, options.commitsFile].filter(Boolean).length > 1) {
    throw new Error('Use only one of --ref, --range, or --commits-file')
  }

  return options
}

/**
 * List commit refs in a revision range.
 * @param {string} range
 * @returns {string[]} Commit SHAs in oldest-to-newest order.
 */
function listCommits(range) {
  if (ZERO_SHA.test(range.split('..')[0] ?? '')) {
    return [range.split('..')[1]].filter(Boolean)
  }

  return git(['rev-list', '--reverse', range])
    .split('\n')
    .map(commit => commit.trim())
    .filter(Boolean)
}

// --- File discovery ---------------------------------------------------------

/**
 * Recursively collect all .md file paths under a directory.
 * @param {string} dir
 * @returns {string[]} Array of absolute file paths.
 */
function collectMarkdownFiles(dir) {
  const results = []
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry)
    const stats = statSync(fullPath)
    if (stats.isDirectory()) {
      results.push(...collectMarkdownFiles(fullPath))
    }
    else if (entry.endsWith('.md')) {
      results.push(fullPath)
    }
  }
  return results
}

/**
 * Collect all posts/*.md paths at a git ref.
 * @param {string} ref
 * @returns {string[]} Paths relative to repo root using POSIX separators.
 */
function collectMarkdownFilesAtRef(ref) {
  return git(['ls-tree', '-r', '--name-only', ref, '--', 'posts'])
    .split('\n')
    .map(file => file.trim())
    .filter(file => file.endsWith('.md'))
}

// --- Validation logic -------------------------------------------------------

/**
 * @param {unknown} value
 * @returns {value is Date} True when value is a valid Date object.
 */
function isValidDateObject(value) {
  return value instanceof Date && !Number.isNaN(value.getTime())
}

/**
 * Validate the frontmatter of a single Markdown file.
 *
 * @param {string} displayPath - Path to show in errors.
 * @param {string} rawContent - Raw Markdown content.
 * @param {boolean} isPage - True if the file is under posts/_pages/.
 * @returns {string[]} - Array of error messages (empty if valid).
 */
function validateContent(displayPath, rawContent, isPage) {
  const errors = []

  let parsed
  try {
    parsed = matter(rawContent)
  }
  catch (err) {
    errors.push(`Failed to parse frontmatter: ${err instanceof Error ? err.message : String(err)}`)
    return errors
  }

  const data = parsed.data

  // Check that frontmatter block exists
  if (typeof data !== 'object' || data === null || Object.keys(data).length === 0) {
    errors.push('Missing or empty frontmatter block (--- ... ---)')
    return errors
  }

  // --- Required fields ---
  // Regular posts must have title (non-empty) and date (valid format).
  // _pages have relaxed rules: title may be empty, date is optional.
  if (!isPage) {
    if (data.title == null || String(data.title).trim() === '') {
      errors.push('Missing required field "title" (must be a non-empty string)')
    }
    if (data.date == null) {
      errors.push('Missing required field "date"')
    }
  }

  // --- Validate each present field ---
  for (const [key, value] of Object.entries(data)) {
    // Check for unknown fields
    if (!ALLOWED_FIELDS.includes(key)) {
      errors.push(`Unknown field "${key}" — allowed fields: ${ALLOWED_FIELDS.join(', ')}`)
      continue
    }

    const expectedType = FIELD_TYPES[key]

    // null values (e.g. `title:` with nothing) skip type checks except required ones
    if (value == null) {
      continue
    }

    if (key === 'date') {
      if (typeof value !== 'string') {
        const type = isValidDateObject(value) ? 'YAML date object' : typeof value
        errors.push(`Field "date" must be a quoted string matching YYYY-MM-DD or YYYY-MM-DD HH:mm:ss, got ${type}`)
      }
      else if (value.trim() !== '' && !DATE_REGEX.test(value)) {
        errors.push(`Field "date" must match YYYY-MM-DD or YYYY-MM-DD HH:mm:ss, got "${value}"`)
      }
      continue
    }

    if (expectedType === 'string' && typeof value !== 'string') {
      errors.push(`Field "${key}" must be a string, got ${typeof value}`)
      continue
    }

    if (expectedType === 'boolean' && typeof value !== 'boolean') {
      errors.push(`Field "${key}" must be a boolean (true/false), got ${typeof value} (${JSON.stringify(value)})`)
      continue
    }

    if (expectedType === 'array') {
      if (!Array.isArray(value)) {
        errors.push(`Field "${key}" must be an array, got ${typeof value} (${JSON.stringify(value)})`)
        continue
      }
      // All elements must be strings
      for (const [i, item] of value.entries()) {
        if (typeof item !== 'string') {
          errors.push(`Field "${key}[${i}]" must be a string, got ${typeof item}`)
        }
      }
    }

    // Specific value validations
    if (key === 'status' && typeof value === 'string' && !VALID_STATUSES.has(value)) {
      errors.push(`Field "status" must be one of: ${[...VALID_STATUSES].join(', ')}, got "${value}"`)
    }
  }

  return errors
}

/**
 * Validate the frontmatter of a single working-tree Markdown file.
 *
 * @param {string} filePath - Absolute path to the .md file.
 * @param {boolean} isPage - True if the file is under posts/_pages/.
 * @returns {string[]} - Array of error messages (empty if valid).
 */
function validateFile(filePath, isPage) {
  try {
    const rawContent = readFileSync(filePath, 'utf8')
    return validateContent(path.relative(process.cwd(), filePath), rawContent, isPage)
  }
  catch (err) {
    return [`Failed to read file: ${err instanceof Error ? err.message : String(err)}`]
  }
}

/**
 * Validate all post frontmatter in the working tree or at a git ref.
 * @param {string | undefined} ref
 * @returns {{ checked: number, failures: { file: string, errors: string[] }[] }} Validation count and failures.
 */
function validatePosts(ref) {
  /** @type {{ file: string, errors: string[] }[]} */
  const failures = []
  let checked = 0

  if (ref != null) {
    const files = collectMarkdownFilesAtRef(ref)
    for (const filePath of files) {
      const rawContent = execFileSync('git', ['show', `${ref}:${filePath}`], { encoding: 'utf8' })
      const isPage = filePath.includes('/_pages/')
      const errors = validateContent(filePath, rawContent, isPage)
      checked++

      if (errors.length > 0) {
        failures.push({ file: `${filePath} (${ref})`, errors })
      }
    }

    return { checked, failures }
  }

  if (!statSync(postsDir).isDirectory()) {
    throw new Error(`Posts directory not found: ${postsDir}`)
  }

  const files = collectMarkdownFiles(postsDir)
  for (const filePath of files) {
    const isPage = filePath.includes(`${path.sep}_pages${path.sep}`)
    const errors = validateFile(filePath, isPage)
    checked++

    if (errors.length > 0) {
      failures.push({ file: path.relative(process.cwd(), filePath), errors })
    }
  }

  return { checked, failures }
}

// --- Main -------------------------------------------------------------------

function main() {
  const options = parseArgs()
  const isWorkingTree = options.ref == null && options.range == null && options.commitsFile == null
  const refs = options.commitsFile != null
    ? readFileSync(options.commitsFile, 'utf8').split('\n').map(ref => ref.trim()).filter(Boolean)
    : options.range != null ? listCommits(options.range) : [options.ref]

  /** @type {{ file: string, errors: string[] }[]} */
  const failures = []
  let checked = 0

  for (const ref of refs) {
    const result = validatePosts(ref)
    checked += result.checked
    failures.push(...result.failures)
  }

  if (checked === 0) {
    if (isWorkingTree) {
      console.error('No Markdown files found in posts/')
      process.exit(1)
    }
    console.log('\n📋 No Markdown files found in posts/ at the requested ref(s); nothing to validate.\n')
    process.exit(0)
  }

  const target = options.range != null || options.commitsFile != null
    ? ` across ${refs.length} commit(s)`
    : options.ref != null ? ` at ${options.ref}` : ''

  console.log(`\n📋 Validated frontmatter for ${checked} Markdown file(s) in posts/${target}\n`)

  if (failures.length === 0) {
    console.log('✅ All frontmatter is valid!\n')
    process.exit(0)
  }

  console.error(`❌ ${failures.length} file(s) have invalid frontmatter:\n`)

  for (const { file, errors } of failures) {
    console.error(`  📄 ${file}`)
    for (const err of errors) {
      console.error(`     • ${err}`)
    }
    console.error()
  }

  console.error('Fix the issues above before committing.')
  console.error('Guide: https://suzu.zla.app/guide/posts/\n')
  process.exit(1)
}

try {
  main()
}
catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
