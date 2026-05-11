import { describe, expect, it } from 'vitest';
import { blocksToMd } from './blocks.js';

function rich(content: string) {
  return [
    {
      type: 'text',
      text: { content, link: null },
      plain_text: content,
      href: null,
      annotations: {
        bold: false,
        italic: false,
        strikethrough: false,
        underline: false,
        code: false,
        color: 'default',
      },
    },
  ];
}

type MediaKind = 'file' | 'external';

function mediaBlock(
  blockType: 'image' | 'pdf' | 'file' | 'video' | 'audio',
  url: string,
  opts: { caption?: string; kind?: MediaKind } = {},
) {
  const kind = opts.kind ?? 'file';
  const inner = kind === 'file' ? { url, expiry_time: '2026-12-31T00:00:00.000Z' } : { url };
  const payload = {
    type: kind,
    [kind]: inner,
    caption: opts.caption ? rich(opts.caption) : [],
  };
  return { type: blockType, [blockType]: payload, has_children: false, children: [] };
}

describe('media blocks', () => {
  it('image (file) emits asset placeholder with caption', () => {
    const block = mediaBlock('image', 'https://prod-files.s3.amazonaws.com/x.png', {
      caption: 'screenshot',
    });
    expect(blocksToMd([block])).toBe(
      '![screenshot]({{notion-asset:https://prod-files.s3.amazonaws.com/x.png}})\n',
    );
  });

  it('image (external) keeps URL untouched', () => {
    const block = mediaBlock('image', 'https://example.com/x.png', { kind: 'external' });
    expect(blocksToMd([block])).toBe('![](https://example.com/x.png)\n');
  });

  it('pdf gets caption when provided', () => {
    const block = mediaBlock('pdf', 'https://prod-files.s3.amazonaws.com/doc.pdf', {
      caption: 'paper',
    });
    expect(blocksToMd([block])).toBe(
      '[paper]({{notion-asset:https://prod-files.s3.amazonaws.com/doc.pdf}})\n',
    );
  });

  it('file with no caption falls back to basename', () => {
    const block = mediaBlock('file', 'https://prod-files.s3.amazonaws.com/folder/report.docx');
    expect(blocksToMd([block])).toBe(
      '[report.docx]({{notion-asset:https://prod-files.s3.amazonaws.com/folder/report.docx}})\n',
    );
  });

  it('video (file)', () => {
    const block = mediaBlock('video', 'https://prod-files.s3.amazonaws.com/v.mp4', {
      caption: 'clip',
    });
    expect(blocksToMd([block])).toBe(
      '[clip]({{notion-asset:https://prod-files.s3.amazonaws.com/v.mp4}})\n',
    );
  });
});
