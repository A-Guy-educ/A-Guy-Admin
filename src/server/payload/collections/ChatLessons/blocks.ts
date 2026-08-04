/**
 * @fileType payload-blocks
 * @domain chat-lessons
 * @ai-summary Step-block definitions for the `chat-lessons` collection. Each
 *             block variant maps 1:1 to a runner step type on the Web repo
 *             (see `src/lib/chat-lessons/payload-chat-script.ts` there — keep
 *             the two in lockstep).
 */

import type { Block, Field } from 'payload'

const stepIdField: Field = {
  name: 'stepId',
  type: 'text',
  required: true,
  admin: {
    description:
      'Author-supplied unique identifier for this step (referenced by `nextStepId`). Use a short slug like `intro_ex1`.',
  },
}

const textField: Field = {
  name: 'text',
  type: 'textarea',
  required: true,
  admin: {
    description: 'Teacher line rendered as the chat bubble. Supports inline `$...$` math.',
  },
}

const nextStepIdField: Field = {
  name: 'nextStepId',
  type: 'text',
  admin: {
    description: 'stepId of the next step. Leave empty on terminal steps.',
  },
}

export const TeacherIntroBlock: Block = {
  slug: 'teacherIntro',
  interfaceName: 'ChatLessonTeacherIntroBlock',
  labels: { plural: 'Teacher Intros', singular: 'Teacher Intro' },
  fields: [
    stepIdField,
    textField,
    {
      name: 'contentHtml',
      type: 'textarea',
      admin: {
        description:
          'Optional HTML rendered under the teacher line via dangerouslySetInnerHTML. Author must ensure it is valid, safe HTML.',
      },
    },
    nextStepIdField,
  ],
}

export const MultipleChoiceBlock: Block = {
  slug: 'multipleChoice',
  interfaceName: 'ChatLessonMultipleChoiceBlock',
  labels: { plural: 'Multiple Choice Steps', singular: 'Multiple Choice Step' },
  fields: [
    stepIdField,
    textField,
    {
      name: 'options',
      type: 'array',
      required: true,
      minRows: 2,
      admin: {
        description:
          'Answer options. Mark at least one with `isCorrect` for graded questions; leave all unmarked for opinion / branching prompts.',
      },
      fields: [
        {
          name: 'text',
          type: 'text',
          required: true,
          admin: { description: 'Button label. Supports inline `$...$` math.' },
        },
        {
          name: 'feedback',
          type: 'textarea',
          admin: { description: 'Short reply the teacher gives after this option is picked.' },
        },
        {
          name: 'isCorrect',
          type: 'checkbox',
          admin: {
            description:
              'Marks this option as the correct answer. Leave every option unchecked for opinion questions.',
          },
        },
        {
          name: 'nextStepId',
          type: 'text',
          admin: {
            description: "Per-option branch. Falls back to the step's own `nextStepId`.",
          },
        },
      ],
    },
    {
      name: 'correctionText',
      type: 'textarea',
      admin: {
        description: 'Long-form explanation shown when the student picks a wrong option.',
      },
    },
  ],
}

export const TextAnswerBlock: Block = {
  slug: 'textAnswer',
  interfaceName: 'ChatLessonTextAnswerBlock',
  labels: { plural: 'Text Answer Steps', singular: 'Text Answer Step' },
  fields: [
    stepIdField,
    textField,
    {
      name: 'expected',
      type: 'text',
      required: true,
      admin: {
        description:
          'Expected answer. Graded via trim + lowercase + whitespace-strip equality on the Web runtime.',
      },
    },
    {
      name: 'correctFeedback',
      type: 'textarea',
      admin: { description: 'Teacher reply when the student answers correctly.' },
    },
    {
      name: 'correctionText',
      type: 'textarea',
      admin: { description: 'Explanation shown after a wrong answer.' },
    },
    nextStepIdField,
  ],
}

export const FinishBlock: Block = {
  slug: 'finish',
  interfaceName: 'ChatLessonFinishBlock',
  labels: { plural: 'Finish Steps', singular: 'Finish Step' },
  fields: [
    stepIdField,
    textField,
    {
      name: 'contentHtml',
      type: 'textarea',
      admin: {
        description:
          'Optional HTML rendered under the closing teacher line via dangerouslySetInnerHTML.',
      },
    },
  ],
}

export const chatLessonStepBlocks: Block[] = [
  TeacherIntroBlock,
  MultipleChoiceBlock,
  TextAnswerBlock,
  FinishBlock,
]
