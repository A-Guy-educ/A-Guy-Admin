/**
 * Localized strings for the ExerciseContentEditor geometry and axis editors.
 *
 * Admin panel supports English + Hebrew. Selection happens at runtime via
 * `useTranslation().i18n.language` from @payloadcms/ui.
 */

interface EditorStrings {
  labelSize: string
  labelSizeDefault: string
  labelSizeSmall: string
}

const EN: EditorStrings = {
  labelSize: 'Label Size',
  labelSizeDefault: 'Default',
  labelSizeSmall: 'Small',
}

const HE: EditorStrings = {
  labelSize: 'גודל תווית',
  labelSizeDefault: 'ברירת מחדל',
  labelSizeSmall: 'קטן',
}

export function getEditorStrings(lang: string): EditorStrings {
  return lang.toLowerCase().startsWith('he') ? HE : EN
}
