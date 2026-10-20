import { describe, expect, it } from 'vitest';
import { pageKind, toPlayableUrl, videoId } from './youtube';

describe('toPlayableUrl', () => {
  it.each([
    ['https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=30', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'],
    ['https://youtu.be/aqz-KE-bpKQ?si=x', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'],
    ['youtu.be/aqz-KE-bpKQ', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'],
    ['https://www.youtube.com/embed/aqz-KE-bpKQ', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'],
    ['https://www.youtube.com/shorts/aqz-KE-bpKQ', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'],
  ])('normalizes YouTube link %s', (input, expected) => {
    expect(toPlayableUrl(input)).toBe(expected);
  });

  it('keeps other URLs and adds a scheme to bare hosts', () => {
    expect(toPlayableUrl('https://vimeo.com/123')).toBe('https://vimeo.com/123');
    expect(toPlayableUrl('example.com/video')).toBe('https://example.com/video');
  });

  it('turns free text into a YouTube search', () => {
    expect(toPlayableUrl('  lofi hip hop  ')).toBe(
      'https://www.youtube.com/results?search_query=lofi%20hip%20hop',
    );
    expect(toPlayableUrl('ボカロ')).toBe(
      'https://www.youtube.com/results?search_query=%E3%83%9C%E3%82%AB%E3%83%AD',
    );
  });

  it('ignores empty input', () => {
    expect(toPlayableUrl('   ')).toBeNull();
  });

  it('does not treat a v= parameter on another site as YouTube', () => {
    expect(toPlayableUrl('https://example.com/?v=aqz-KE-bpKQ')).toBe(
      'https://example.com/?v=aqz-KE-bpKQ',
    );
  });
});

describe('pageKind', () => {
  it.each([
    ['https://www.youtube.com/watch?v=aqz-KE-bpKQ', 'watch'],
    ['https://www.youtube.com/shorts/aqz-KE-bpKQ', 'watch'],
    ['https://m.youtube.com/watch?v=aqz-KE-bpKQ', 'watch'],
    ['https://www.youtube.com/', 'browse'],
    ['https://www.youtube.com/results?search_query=x', 'browse'],
    ['https://www.youtube.com/@channel', 'browse'],
    ['https://vimeo.com/123', 'other'],
    ['https://notyoutube.com/watch?v=aqz-KE-bpKQ', 'other'],
    ['not a url', 'other'],
  ])('%s is %s', (url, kind) => {
    expect(pageKind(url)).toBe(kind);
  });
});

describe('videoId', () => {
  it('extracts the id or returns null', () => {
    expect(videoId('https://www.youtube.com/watch?list=x&v=aqz-KE-bpKQ')).toBe('aqz-KE-bpKQ');
    expect(videoId('https://www.youtube.com/')).toBeNull();
  });
});
