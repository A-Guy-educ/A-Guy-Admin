/**
 * Composes final system instructions for AI chat
 *
 * @fileType ai-utility
 * @domain chat
 * @pattern server-only
 */
import { buildLessonContextPrompt } from './lesson-context'

export const SYSTEM_PROMPT_SEPARATOR = '\n\n---\n\n'

/**
 * Mandatory math formatting instructions injected into every chat prompt.
 * Ensures the LLM always uses LaTeX delimiters so the frontend can render math properly.
 */
const MATH_FORMATTING_INSTRUCTIONS = `## Math Formatting (CRITICAL)

Always use LaTeX delimiters for mathematical expressions:
- Inline math (within sentences): \\(...\\)
- Block/display math (standalone equations): \\[...\\]

IMPORTANT: Never use dollar signs ($) for math delimiters. Always use \\(...\\) for inline math and \\[...\\] for block math.

Never write math as plain text. Use proper LaTeX notation for fractions (\\frac{}{}), multiplication (\\cdot), square roots (\\sqrt{}), trigonometric functions (\\sin, \\cos, \\tan), Greek letters (\\alpha, \\pi), etc.

When referencing exercise content, always wrap mathematical expressions in \\(...\\) or \\[...\\] delimiters, even for simple variables like \\(x\\), coordinates like \\((2,0)\\), or function names like \\(f(x)\\).`

/**
 * Mandatory image handling instructions injected into every chat prompt.
 * Ensures the LLM provides clear, actionable feedback when it cannot process an uploaded image.
 */
const IMAGE_HANDLING_INSTRUCTIONS = `## Image Handling (CRITICAL)

When a student uploads an image, you MUST first determine whether it contains a valid math or science exercise before responding to it. Follow these rules strictly:

1. **No educational content detected**: If the image does not contain a math or science exercise, equation, graph, diagram, or anything academically relevant (e.g., it is a blank image, a dark/black photo, a selfie, a screenshot of something unrelated, etc.), you MUST:
   - Explain what is wrong with the image (e.g., "The image is completely dark", "This appears to be a selfie, not an exercise", "This is a screenshot of a chat conversation").
   - Tell the student what a good image looks like (e.g., "Please upload a clear, well-lit photo of your math or science exercise, making sure the text and numbers are readable").
   Example: "התמונה שהעלית כהה לחלוטין ולא ניתן לראות בה תוכן. אנא העלה תמונה ברורה ומוארת של התרגיל שאתה צריך עזרה בו, וודא שהטקסט והמספרים קריאים."

2. **Unreadable / low quality**: If the image seems to contain an exercise but is blurry, too dark, too bright, or the text/numbers are not legible, tell the student exactly what is wrong and ask them to retake the photo with better focus and lighting.

3. **Too small to read**: If the content is too tiny to make out, ask the student to upload a larger or higher-resolution version.

4. **Partially readable**: If you can read some parts but not others, describe what you can see and ask the student to clarify or re-upload the unclear parts.

5. **Supported formats**: Only JPEG, PNG, WebP images and PDF files are accepted. Maximum file size is 20 MB. Images must be at least 100×100 pixels. If the student mentions an issue with uploading, remind them of these limits.

6. **Multiple issues**: If there are several problems, list all of them so the student can fix everything in one attempt.

IMPORTANT: Always explain what is wrong with the image AND how to take a better one. Never just say "this isn't an exercise" without explaining why and what to do next.`

/**
 * Composes final system instructions for AI chat.
 *
 * Order (deterministic):
 * 1. All published system prompts (joined with separator)
 * 2. Teacher profile block (injected into system role, NOT stored in conversation)
 * 3. Lesson-specific resolved prompt
 * 4. Mandatory math formatting instructions
 * 5. Mandatory image handling instructions
 * 6. Lesson context text injection (via buildLessonContextPrompt)
 *
 * @param systemPrompts - Array of system prompt templates (can be empty)
 * @param lessonPromptTemplate - Resolved lesson prompt template
 * @param lessonContextText - Optional lesson context to inject
 * @param teacherProfileBlock - Optional teacher profile block to inject
 * @returns Final composed system instructions string
 */
export function composeSystemInstructions(
  systemPrompts: string[],
  lessonPromptTemplate: string,
  lessonContextText?: string,
  teacherProfileBlock?: string,
): string {
  // Step 1: Join system prompts (if any)
  const systemPart =
    systemPrompts.length > 0
      ? systemPrompts.join(SYSTEM_PROMPT_SEPARATOR) + SYSTEM_PROMPT_SEPARATOR
      : ''

  // Step 2: Append teacher profile block (if provided)
  const withTeacherProfile = teacherProfileBlock
    ? systemPart + teacherProfileBlock + '\n\n'
    : systemPart

  // Step 3: Append lesson prompt
  const withLessonPrompt = withTeacherProfile + lessonPromptTemplate

  // Step 4: Append mandatory math formatting instructions
  const withMathFormatting = withLessonPrompt + '\n\n' + MATH_FORMATTING_INSTRUCTIONS

  // Step 5: Append mandatory image handling instructions
  const withImageHandling = withMathFormatting + '\n\n' + IMAGE_HANDLING_INSTRUCTIONS

  // Step 6: Inject lesson context (reuse existing function)
  return buildLessonContextPrompt(withImageHandling, lessonContextText)
}
