(function initTextProofDiff(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TextProofDiff = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createTextProofDiff() {
  'use strict';

  const IGNORED_CHARACTER_RE = /[\s\p{P}\p{Z}\u200b\u2060]/u;
  const MAX_ALIGNMENT_CHARS = 3600;

  function splitCharacters(text) {
    return Array.from(String(text || ''));
  }

  function buildCodeUnitOffsets(characters) {
    const offsets = [];
    let cursor = 0;
    characters.forEach(character => {
      offsets.push(cursor);
      cursor += character.length;
    });
    offsets.push(cursor);
    return offsets;
  }

  function normalizeForComparison(sourceText, canonicalText = sourceText) {
    const source = String(sourceText || '');
    const canonical = String(canonicalText || '');
    const sourceCharacters = splitCharacters(source);
    const canonicalCharacters = splitCharacters(canonical);
    const sourceOffsets = buildCodeUnitOffsets(sourceCharacters);
    const sameLength = sourceCharacters.length === canonicalCharacters.length;
    const characters = [];
    const sourceCharacterIndexes = [];

    canonicalCharacters.forEach((character, canonicalIndex) => {
      if (IGNORED_CHARACTER_RE.test(character)) return;
      const sourceIndex = sameLength
        ? canonicalIndex
        : Math.min(
          Math.max(sourceCharacters.length - 1, 0),
          Math.floor(canonicalIndex * sourceCharacters.length / Math.max(canonicalCharacters.length, 1)),
        );
      characters.push(character);
      sourceCharacterIndexes.push(sourceIndex);
    });

    return {
      source,
      canonical,
      sourceCharacters,
      sourceOffsets,
      characters,
      sourceCharacterIndexes,
      mappingReliable: sameLength,
    };
  }

  function sourceCodeUnitPosition(normalized, normalizedIndex) {
    if (!normalized.sourceCharacters.length) return 0;
    if (normalizedIndex <= 0) return 0;
    if (normalizedIndex >= normalized.characters.length) return normalized.source.length;
    const sourceCharacterIndex = normalized.sourceCharacterIndexes[normalizedIndex];
    return normalized.sourceOffsets[sourceCharacterIndex] ?? normalized.source.length;
  }

  function normalizedIndexForSourcePosition(normalized, sourcePosition) {
    const safePosition = Math.max(0, Math.min(Number(sourcePosition) || 0, normalized.source.length));
    for (let index = 0; index < normalized.sourceCharacterIndexes.length; index += 1) {
      const sourceCharacterIndex = normalized.sourceCharacterIndexes[index];
      if ((normalized.sourceOffsets[sourceCharacterIndex] ?? normalized.source.length) >= safePosition) {
        return index;
      }
    }
    return normalized.characters.length;
  }

  function sourceCodeUnitRange(normalized, start, end) {
    const safeStart = Math.max(0, Math.min(Number(start) || 0, normalized.characters.length));
    const safeEnd = Math.max(safeStart, Math.min(Number(end) || 0, normalized.characters.length));
    if (safeStart === safeEnd) {
      const position = sourceCodeUnitPosition(normalized, safeStart);
      return { start: position, end: position };
    }
    const sourceStartIndex = normalized.sourceCharacterIndexes[safeStart];
    const sourceEndIndex = normalized.sourceCharacterIndexes[safeEnd - 1];
    return {
      start: normalized.sourceOffsets[sourceStartIndex] ?? 0,
      end: normalized.sourceOffsets[sourceEndIndex + 1] ?? normalized.source.length,
    };
  }

  function rawCharacterForNormalizedIndex(normalized, normalizedIndex) {
    const sourceCharacterIndex = normalized.sourceCharacterIndexes[normalizedIndex];
    return normalized.sourceCharacters[sourceCharacterIndex] || '';
  }

  function splitHighlightRange(text, start, end) {
    const source = String(text || '');
    const safeStart = Math.max(0, Math.min(Number(start) || 0, source.length));
    const safeEnd = Math.max(safeStart, Math.min(Number(end) || safeStart, source.length));
    return {
      before: source.slice(0, safeStart),
      highlight: source.slice(safeStart, safeEnd),
      after: source.slice(safeEnd),
    };
  }

  function buildDifferenceHighlightSegments(text, differences = [], activeIndex = 0) {
    const source = String(text || '');
    const ranges = (Array.isArray(differences) ? differences : [])
      .map((difference, index) => ({
        index,
        start: Math.max(0, Math.min(Number(difference?.referenceStart) || 0, source.length)),
        end: Math.max(0, Math.min(Number(difference?.referenceEnd) || 0, source.length)),
      }))
      .map(range => ({ ...range, end: Math.max(range.start, range.end) }))
      .sort((left, right) =>
        left.start - right.start || left.end - right.end || left.index - right.index);
    const segments = [];
    let cursor = 0;

    ranges.forEach(range => {
      if (range.end < cursor || (range.start < cursor && range.end === range.start)) return;
      const start = Math.max(cursor, range.start);
      const end = Math.max(start, range.end);
      if (start > cursor) {
        segments.push({
          type: 'text',
          text: source.slice(cursor, start),
          start: cursor,
          end: start,
        });
      }
      segments.push({
        type: 'difference',
        text: source.slice(start, end),
        start,
        end,
        differenceIndex: range.index,
        active: range.index === Number(activeIndex),
      });
      cursor = Math.max(cursor, end);
    });

    if (cursor < source.length || !segments.length) {
      segments.push({
        type: 'text',
        text: source.slice(cursor),
        start: cursor,
        end: source.length,
      });
    }
    return segments;
  }

  function chooseReferenceStartHint({ pageNum, ranges = [] } = {}) {
    const currentPage = Number(pageNum);
    if (!Number.isFinite(currentPage)) return null;
    const validRanges = (Array.isArray(ranges) ? ranges : [])
      .filter(range => Number.isFinite(Number(range?.pageNum)));
    const current = validRanges
      .filter(range =>
        Number(range.pageNum) === currentPage
        && Number.isFinite(Number(range.referenceStart)))
      .at(-1);
    if (current) return Number(current.referenceStart);
    const previous = validRanges
      .filter(range =>
        Number(range.pageNum) < currentPage
        && Number.isFinite(Number(range.referenceEnd)))
      .sort((left, right) => Number(right.pageNum) - Number(left.pageNum))[0];
    return previous ? Number(previous.referenceEnd) : null;
  }

  function longestCommonSubstring(left, right) {
    if (!left.length || !right.length) return { leftStart: 0, rightStart: 0, length: 0 };
    let previous = new Uint32Array(right.length + 1);
    let bestLength = 0;
    let bestLeftEnd = 0;
    let bestRightEnd = 0;

    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
      const current = new Uint32Array(right.length + 1);
      for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
        if (left[leftIndex - 1] !== right[rightIndex - 1]) continue;
        current[rightIndex] = previous[rightIndex - 1] + 1;
        if (current[rightIndex] > bestLength) {
          bestLength = current[rightIndex];
          bestLeftEnd = leftIndex;
          bestRightEnd = rightIndex;
        }
      }
      previous = current;
    }

    return {
      leftStart: bestLeftEnd - bestLength,
      rightStart: bestRightEnd - bestLength,
      length: bestLength,
    };
  }

  function buildSequenceOperations(left, right) {
    if (left.length > MAX_ALIGNMENT_CHARS || right.length > MAX_ALIGNMENT_CHARS) {
      throw new Error(`单次对照文字过长（上限 ${MAX_ALIGNMENT_CHARS} 个有效字符）`);
    }
    const rows = Array.from(
      { length: left.length + 1 },
      () => new Uint32Array(right.length + 1),
    );
    for (let i = 1; i <= left.length; i += 1) {
      for (let j = 1; j <= right.length; j += 1) {
        rows[i][j] = left[i - 1] === right[j - 1]
          ? rows[i - 1][j - 1] + 1
          : Math.max(rows[i - 1][j], rows[i][j - 1]);
      }
    }

    const operations = [];
    let i = left.length;
    let j = right.length;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && left[i - 1] === right[j - 1]) {
        operations.push({ type: 'equal', leftIndex: i - 1, rightIndex: j - 1 });
        i -= 1;
        j -= 1;
      } else if (j > 0 && (i === 0 || rows[i][j - 1] >= rows[i - 1][j])) {
        operations.push({ type: 'insert', leftIndex: null, rightIndex: j - 1 });
        j -= 1;
      } else {
        operations.push({ type: 'delete', leftIndex: i - 1, rightIndex: null });
        i -= 1;
      }
    }
    return operations.reverse();
  }

  function trimOuterReferenceInsertions(operations) {
    const first = operations.findIndex(operation => operation.leftIndex !== null);
    if (first < 0) return { operations: [], leadingReferenceInsertions: 0 };
    let last = operations.length - 1;
    while (last >= first && operations[last].leftIndex === null) last -= 1;
    return {
      operations: operations.slice(first, last + 1),
      leadingReferenceInsertions: operations
        .slice(0, first)
        .filter(operation => operation.type === 'insert').length,
    };
  }

  function createContentDifferences(operations, ocr, reference, referenceWindowStart) {
    const differences = [];
    let leftCursor = 0;
    let rightCursor = 0;
    let group = null;

    const flush = () => {
      if (!group) return;
      const ocrRange = sourceCodeUnitRange(ocr, group.leftStart, group.leftEnd);
      const referenceRange = sourceCodeUnitRange(
        reference,
        group.rightStart + referenceWindowStart,
        group.rightEnd + referenceWindowStart,
      );
      differences.push({
        kind: 'content',
        ocrStart: ocrRange.start,
        ocrEnd: ocrRange.end,
        referenceStart: referenceRange.start,
        referenceEnd: referenceRange.end,
        ocrText: ocr.source.slice(ocrRange.start, ocrRange.end),
        referenceText: reference.source.slice(referenceRange.start, referenceRange.end),
      });
      group = null;
    };

    operations.forEach(operation => {
      if (operation.type === 'equal') {
        flush();
        leftCursor += 1;
        rightCursor += 1;
        return;
      }
      if (!group) {
        group = {
          leftStart: leftCursor,
          leftEnd: leftCursor,
          rightStart: rightCursor,
          rightEnd: rightCursor,
        };
      }
      if (operation.type === 'delete') leftCursor += 1;
      if (operation.type === 'insert') rightCursor += 1;
      group.leftEnd = leftCursor;
      group.rightEnd = rightCursor;
    });
    flush();
    return differences;
  }

  function createGlyphDifferences(operations, ocr, reference, referenceWindowStart) {
    const glyphs = [];
    operations.forEach(operation => {
      if (operation.type !== 'equal') return;
      const canonical = ocr.characters[operation.leftIndex] || '';
      const ocrRaw = rawCharacterForNormalizedIndex(ocr, operation.leftIndex);
      const referenceIndex = operation.rightIndex + referenceWindowStart;
      const referenceRaw = rawCharacterForNormalizedIndex(reference, referenceIndex);
      // 普通繁简：一侧就是归一后的规范字符，另一侧为对应繁/简字，默认隐藏。
      // 只有两侧均不是归一字符但又归到同一字符时，才作为可能的一对多字形问题提示。
      if (!ocrRaw || !referenceRaw || ocrRaw === referenceRaw) return;
      if (ocrRaw === canonical || referenceRaw === canonical) return;
      const ocrRange = sourceCodeUnitRange(ocr, operation.leftIndex, operation.leftIndex + 1);
      const referenceRange = sourceCodeUnitRange(reference, referenceIndex, referenceIndex + 1);
      glyphs.push({
        kind: 'glyph',
        ocrStart: ocrRange.start,
        ocrEnd: ocrRange.end,
        referenceStart: referenceRange.start,
        referenceEnd: referenceRange.end,
        ocrText: ocrRaw,
        referenceText: referenceRaw,
      });
    });

    return glyphs.reduce((merged, current) => {
      const previous = merged[merged.length - 1];
      if (
        previous
        && previous.ocrEnd === current.ocrStart
        && previous.referenceEnd === current.referenceStart
      ) {
        previous.ocrEnd = current.ocrEnd;
        previous.referenceEnd = current.referenceEnd;
        previous.ocrText += current.ocrText;
        previous.referenceText += current.referenceText;
      } else {
        merged.push({ ...current });
      }
      return merged;
    }, []);
  }

  function compareContinuousText({
    ocrRaw,
    ocrCanonical = ocrRaw,
    referenceRaw,
    referenceCanonical = referenceRaw,
    referenceStartHint = null,
  }) {
    const ocr = normalizeForComparison(ocrRaw, ocrCanonical);
    const reference = normalizeForComparison(referenceRaw, referenceCanonical);
    if (!ocr.characters.length) {
      return { matched: false, reason: '本页没有可对照的 OCR 文字', differences: [] };
    }
    if (!reference.characters.length) {
      return { matched: false, reason: '整理稿没有可对照的文字', differences: [] };
    }

    const margin = Math.max(8, Math.min(64, Math.floor(ocr.characters.length * 0.12)));
    const hasReferenceHint =
      referenceStartHint !== null
      && referenceStartHint !== ''
      && Number.isFinite(Number(referenceStartHint));
    const hintedNormalizedStart = hasReferenceHint
      ? normalizedIndexForSourcePosition(reference, Number(referenceStartHint))
      : 0;
    const anchorSearchStart = hasReferenceHint
      ? Math.max(0, hintedNormalizedStart - margin)
      : 0;
    const anchorSearchEnd = hasReferenceHint
      ? Math.min(
        reference.characters.length,
        hintedNormalizedStart + ocr.characters.length + margin * 2,
      )
      : reference.characters.length;
    const localAnchor = longestCommonSubstring(
      ocr.characters,
      reference.characters.slice(anchorSearchStart, anchorSearchEnd),
    );
    const anchor = {
      ...localAnchor,
      rightStart: localAnchor.rightStart + anchorSearchStart,
    };
    const minimumAnchor = Math.min(8, Math.max(3, Math.floor(ocr.characters.length * 0.08)));
    if (anchor.length < minimumAnchor) {
      return {
        matched: false,
        reason: '未找到可靠对应段落，请先在整理稿中定位相关文字',
        anchorLength: anchor.length,
        differences: [],
      };
    }

    // 未指定当前页的整理稿位置时，重复段落不能默认取全书第一次命中。
    // 那会让中间正文页的核对突然跳回整理稿首页；应当要求用户先建立本页锚点。
    if (!hasReferenceHint) {
      const anchorText = ocr.characters
        .slice(anchor.leftStart, anchor.leftStart + anchor.length)
        .join('');
      const referenceCharacterText = reference.characters.join('');
      const firstAnchor = referenceCharacterText.indexOf(anchorText);
      const secondAnchor = firstAnchor >= 0
        ? referenceCharacterText.indexOf(anchorText, firstAnchor + 1)
        : -1;
      if (secondAnchor >= 0) {
        return {
          matched: false,
          reason: '本页文字在整理稿中有重复位置，请先从右侧对应文字或存疑标记建立本页位置',
          anchorLength: anchor.length,
          differences: [],
        };
      }
    }

    const estimatedStart = Math.max(0, anchor.rightStart - anchor.leftStart);
    const referenceWindowStart = Math.max(0, estimatedStart - margin);
    const referenceWindowEnd = Math.min(
      reference.characters.length,
      estimatedStart + ocr.characters.length + margin,
    );
    const referenceWindow = reference.characters.slice(referenceWindowStart, referenceWindowEnd);
    const trimmedAlignment = trimOuterReferenceInsertions(
      buildSequenceOperations(ocr.characters, referenceWindow),
    );
    const operations = trimmedAlignment.operations;
    const alignedReferenceStart =
      referenceWindowStart + trimmedAlignment.leadingReferenceInsertions;
    const equalCount = operations.filter(operation => operation.type === 'equal').length;
    const similarity = equalCount / Math.max(ocr.characters.length, 1);
    if (similarity < 0.25) {
      return {
        matched: false,
        reason: '对应段落相似度过低，请人工确认整理稿位置',
        anchorLength: anchor.length,
        similarity,
        differences: [],
      };
    }

    const contentDifferences = createContentDifferences(
      operations,
      ocr,
      reference,
      alignedReferenceStart,
    );
    const glyphDifferences = createGlyphDifferences(
      operations,
      ocr,
      reference,
      referenceWindowStart,
    );
    const differences = [...contentDifferences, ...glyphDifferences]
      .sort((left, right) =>
        left.referenceStart - right.referenceStart || left.ocrStart - right.ocrStart);
    const alignedReferenceLength = operations
      .filter(operation => operation.type !== 'delete')
      .length;
    const referenceRange = sourceCodeUnitRange(
      reference,
      alignedReferenceStart,
      Math.min(reference.characters.length, alignedReferenceStart + alignedReferenceLength),
    );

    return {
      matched: true,
      anchorLength: anchor.length,
      similarity,
      referenceStart: referenceRange.start,
      referenceEnd: referenceRange.end,
      differences,
      locationStrategy: hasReferenceHint ? 'hinted' : 'global',
      ignored: {
        punctuation: true,
        whitespace: true,
        ordinaryTraditionalSimplified: true,
      },
      mappingReliable: ocr.mappingReliable && reference.mappingReliable,
    };
  }

  return {
    normalizeForComparison,
    longestCommonSubstring,
    compareContinuousText,
    chooseReferenceStartHint,
    buildDifferenceHighlightSegments,
    splitHighlightRange,
  };
});
