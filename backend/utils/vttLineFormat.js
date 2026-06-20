/**
 * Normalize WebVTT to line-by-line (sentence) cues.
 * Merges legacy word-by-word VTT files into full lines for playback.
 */

function parseTimestamp(value) {
  const parts = value.trim().replace(',', '.').split(':');
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return Number(h) * 3600 + Number(m) * 60 + Number(s);
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return Number(m) * 60 + Number(s);
  }
  return Number(value);
}

function formatTimestamp(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const whole = Math.floor(s);
  const ms = Math.round((s - whole) * 1000);

  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function stripTags(text) {
  return text.replace(/<[^>]+>/g, '').trim();
}

function parseVttCues(vttContent) {
  const lines = vttContent.replace(/\r/g, '').split('\n');
  const cues = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    const timingMatch = line.match(
      /^(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3})\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3})/
    );

    if (timingMatch) {
      const start = parseTimestamp(timingMatch[1]);
      const end = parseTimestamp(timingMatch[2]);
      i += 1;

      const textLines = [];
      while (i < lines.length && lines[i].trim() !== '') {
        textLines.push(stripTags(lines[i]));
        i += 1;
      }

      const text = textLines.join(' ').trim();
      if (text) {
        cues.push({ start, end, text });
      }
    }

    i += 1;
  }

  return cues;
}

function isWordByWordVtt(cues) {
  if (cues.length < 4) return false;

  const singleWordCues = cues.filter((cue) => !/\s/.test(cue.text.trim())).length;
  const singleWordRatio = singleWordCues / cues.length;

  if (singleWordRatio >= 0.65) return true;

  const avgDuration = cues.reduce((sum, cue) => sum + (cue.end - cue.start), 0) / cues.length;
  const avgWords = cues.reduce((sum, cue) => sum + cue.text.split(/\s+/).filter(Boolean).length, 0) / cues.length;

  return avgWords <= 1.2 && avgDuration <= 1.5 && cues.length >= 8;
}

function endsSentence(text) {
  return /[.!?]["']?$/.test(text.trim());
}

function mergeCuesToLines(cues, options = {}) {
  const {
    maxWords = 14,
    maxDuration = 8,
    pauseGap = 0.75
  } = options;

  const lines = [];
  let group = [];

  const flush = () => {
    if (!group.length) return;
    lines.push({
      start: group[0].start,
      end: group[group.length - 1].end,
      text: group.map((cue) => cue.text).join(' ').replace(/\s+/g, ' ').trim()
    });
    group = [];
  };

  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    const prev = group[group.length - 1];

    if (prev) {
      const gap = cue.start - prev.end;
      const groupDuration = cue.end - group[0].start;
      const groupWords = group.reduce((sum, item) => sum + item.text.split(/\s+/).filter(Boolean).length, 0);

      if (gap > pauseGap || groupDuration > maxDuration || groupWords >= maxWords) {
        flush();
      }
    }

    group.push(cue);

    const lineText = group.map((item) => item.text).join(' ');
    if (endsSentence(lineText) || group.length >= maxWords) {
      flush();
    }
  }

  flush();
  return lines;
}

function buildVttFromCues(cues) {
  const parts = ['WEBVTT', ''];

  for (const cue of cues) {
    parts.push(`${formatTimestamp(cue.start)} --> ${formatTimestamp(cue.end)}`);
    parts.push(cue.text);
    parts.push('');
  }

  return `${parts.join('\n').trim()}\n`;
}

/**
 * Convert word-by-word VTT to line-by-line. Returns original content if already line-based.
 */
export function normalizeVttToLines(vttContent) {
  if (!vttContent || !vttContent.includes('WEBVTT')) {
    return vttContent;
  }

  const cues = parseVttCues(vttContent);
  if (!cues.length) return vttContent;

  if (!isWordByWordVtt(cues)) {
    return vttContent;
  }

  const lines = mergeCuesToLines(cues);
  return buildVttFromCues(lines);
}
