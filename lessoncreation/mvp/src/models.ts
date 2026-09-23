/**
 * Central model config for the pipeline. Change here to swap models across
 * all stages at once.
 *
 * Options in this repo:
 *   - `gemini-2.5-flash` — fast, cheap; used by structured-extraction and
 *     interactive-lesson-generation services in the main repo.
 *   - `gemini-3.1-pro-preview` — smart, slower; used by the lesson-
 *     duplication-variation-service for complex reasoning.
 *
 * The pipeline runs 6 stages, each with different cognitive load. We chose
 * to keep them all on the same tier for now (consistency, easier tuning),
 * but if cost becomes a concern we can drop the cheap stages (planner,
 * critic, materializer) back to flash while keeping writer + reader-critic
 * on pro.
 */
export const MODEL_PLANNER = 'gemini-3.1-pro-preview'
export const MODEL_CRITIC = 'gemini-3.1-pro-preview'
export const MODEL_REVISER = 'gemini-3.1-pro-preview'
export const MODEL_WRITER = 'gemini-3.1-pro-preview'
export const MODEL_MATERIALIZER = 'gemini-3.1-pro-preview'
export const MODEL_READER_CRITIC = 'gemini-3.1-pro-preview'
