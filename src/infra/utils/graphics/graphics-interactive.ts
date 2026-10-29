/**
 * Helpers for the optional `interactive` flag on axis/geometry specs.
 *
 * The specs treat an absent flag as interactive (graphs saved before the flag
 * existed stay as they were), but new graphs default to a static picture, so
 * `false` is written explicitly on graphs entering the system. An explicit
 * value set by an author is never overwritten.
 */

type Spec = Record<string, unknown>
type Block = Record<string, unknown>

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function withDefault(spec: unknown, interactive: boolean): unknown {
  if (!isObject(spec) || 'interactive' in spec) return spec
  return { ...(spec as Spec), interactive }
}

/** Fill a missing `interactive` on a block's own graph and on its graph attachment. */
export function withGraphicsInteractiveDefault(block: unknown, interactive: boolean): unknown {
  if (!isObject(block)) return block
  let next: Block = block
  if (block.type === 'question_axis' && isObject(block.axis)) {
    next = { ...next, axis: withDefault(block.axis, interactive) }
  }
  if (block.type === 'question_geometry' && isObject(block.geometry)) {
    next = { ...next, geometry: withDefault(block.geometry, interactive) }
  }
  const attachment = block.attachment
  if (isObject(attachment)) {
    if (attachment.kind === 'axis' && isObject(attachment.axis)) {
      next = {
        ...next,
        attachment: { ...attachment, axis: withDefault(attachment.axis, interactive) },
      }
    }
    if (attachment.kind === 'geometry' && isObject(attachment.geometry)) {
      next = {
        ...next,
        attachment: { ...attachment, geometry: withDefault(attachment.geometry, interactive) },
      }
    }
  }
  return next
}

/**
 * Default graphs on newly added blocks to static. Blocks whose id already
 * exists on the stored doc are left untouched.
 */
export function defaultNewGraphicsToStatic(
  blocks: unknown[],
  existingIds: ReadonlySet<string>,
): unknown[] {
  return blocks.map((block) =>
    isObject(block) && typeof block.id === 'string' && existingIds.has(block.id)
      ? block
      : withGraphicsInteractiveDefault(block, false),
  )
}
