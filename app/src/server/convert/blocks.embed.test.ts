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

function embed(blockType: 'bookmark' | 'embed' | 'link_preview', url: string, caption = '') {
  const payload = { url, caption: caption ? rich(caption) : [] };
  return { type: blockType, [blockType]: payload, has_children: false, children: [] };
}

describe('embed/bookmark/link_preview blocks', () => {
  it('bookmark falls back to display URL', () => {
    expect(blocksToMd([embed('bookmark', 'https://example.com')])).toBe(
      '[example.com](https://example.com)\n',
    );
  });

  it('bookmark with caption uses caption text', () => {
    expect(blocksToMd([embed('bookmark', 'https://example.com', 'Cool site')])).toBe(
      '[Cool site](https://example.com)\n',
    );
  });

  it('YouTube embed renders as native ![]() (Obsidian embed)', () => {
    expect(blocksToMd([embed('embed', 'https://www.youtube.com/watch?v=abc')])).toBe(
      '![](https://www.youtube.com/watch?v=abc)\n',
    );
  });

  it('link_preview as fallback link', () => {
    expect(blocksToMd([embed('link_preview', 'https://example.com/page')])).toBe(
      '[example.com/page](https://example.com/page)\n',
    );
  });

  it('Twitter/X embed renders as native', () => {
    expect(blocksToMd([embed('embed', 'https://twitter.com/x/status/123')])).toBe(
      '![](https://twitter.com/x/status/123)\n',
    );
  });
});
