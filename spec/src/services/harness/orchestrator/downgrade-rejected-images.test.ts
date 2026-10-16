import { describe, expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import {
  countImageFileParts,
  downgradeImageFileParts,
  isProviderImageRejection,
  providerImageRejectionNote,
} from '@/services/harness/orchestrator/downgrade-rejected-images'

describe('isProviderImageRejection', () => {
  it('matches provider image rejection phrases case-insensitively', () => {
    expect(isProviderImageRejection('Agent run failed, invalid png image')).toBe(
      true,
    )
    expect(isProviderImageRejection('Invalid JPEG')).toBe(true)
    expect(isProviderImageRejection('Could not process image')).toBe(true)
    expect(isProviderImageRejection('unsupported image type')).toBe(true)
    expect(isProviderImageRejection('image input not allowed')).toBe(true)
    expect(isProviderImageRejection('invalid image_url')).toBe(true)
    expect(isProviderImageRejection('provider exploded')).toBe(false)
  })
})

describe('downgradeImageFileParts', () => {
  const messages: ModelMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'see' },
        {
          type: 'file',
          data: 'data:image/png;base64,abc',
          mediaType: 'image/png',
          filename: 'shot.png',
        },
        {
          type: 'image',
          image: 'data:image/jpeg;base64,/9j/',
          mediaType: 'image/jpeg',
        },
        {
          type: 'file',
          data: 'data:application/pdf;base64,abc',
          mediaType: 'application/pdf',
          filename: 'doc.pdf',
        },
      ],
    },
    { role: 'assistant', content: 'ok' },
  ]

  it('counts image file and image parts', () => {
    expect(countImageFileParts(messages)).toBe(2)
  })

  it('replaces image parts with attachment placeholders', () => {
    expect(downgradeImageFileParts(messages)).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'see' },
          { type: 'text', text: '[Attachment: shot.png (image/png)]' },
          { type: 'text', text: '[Attachment: file (image/jpeg)]' },
          {
            type: 'file',
            data: 'data:application/pdf;base64,abc',
            mediaType: 'application/pdf',
            filename: 'doc.pdf',
          },
        ],
      },
      { role: 'assistant', content: 'ok' },
    ])
  })

  it('uses the tool source path as the placeholder name', () => {
    const staged: ModelMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'file',
            data: 'data:image/png;base64,abc',
            mediaType: 'image/png',
            filename: 'src/icon.png',
          },
        ],
      },
    ]
    expect(downgradeImageFileParts(staged)).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: '[Attachment: src/icon.png (image/png)]' },
        ],
      },
    ])
  })
})

describe('providerImageRejectionNote', () => {
  it('names the rejected image count', () => {
    expect(providerImageRejectionNote(1)).toBe(
      'The provider rejected 1 image(s) and the run continued without them.',
    )
  })
})
