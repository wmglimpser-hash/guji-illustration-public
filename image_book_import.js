(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ImageBookImport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'tif', 'tiff']);
  const IMPORT_SCHEMA = 'image-book-import-v1';

  function extensionOf(name) {
    const match = String(name || '').toLowerCase().match(/\.([^.]+)$/);
    return match ? match[1] : '';
  }

  function isSupportedImage(file) {
    return !!file && IMAGE_EXTENSIONS.has(extensionOf(file.name));
  }

  function pathParts(file) {
    return String(file?.webkitRelativePath || file?.name || '')
      .replace(/\\/g, '/')
      .split('/')
      .filter(Boolean);
  }

  function naturalCompare(a, b) {
    return String(a || '').localeCompare(String(b || ''), 'zh-CN', {
      numeric: true,
      sensitivity: 'base',
    });
  }

  function volumeNameFor(file) {
    const parts = pathParts(file);
    if (parts.length >= 2) return parts[parts.length - 2];
    const stem = String(file?.name || '').replace(/\.[^.]+$/, '');
    return stem.replace(/[-_ ]*\d+\s*$/, '').trim() || '未分卷';
  }

  function volumeOrdinal(name) {
    const match = String(name || '').match(/([0-9０-９]+)\s*$/);
    if (!match) return null;
    const digits = match[1].replace(/[０-９]/g, c => '０１２３４５６７８９'.indexOf(c));
    return Number.parseInt(digits, 10);
  }

  function commonPrefix(values) {
    if (!values.length) return '';
    let prefix = String(values[0] || '');
    for (const value of values.slice(1)) {
      const current = String(value || '');
      let i = 0;
      while (i < prefix.length && i < current.length && prefix[i] === current[i]) i += 1;
      prefix = prefix.slice(0, i);
      if (!prefix) break;
    }
    return prefix.replace(/[-_（(·\s]+$/, '').replace(/[0-9０-９]+$/, '').trim();
  }

  function suggestedTitle(files, volumeNames) {
    const firstParts = pathParts(files[0]);
    const parent = firstParts.length >= 3 ? firstParts[firstParts.length - 3] : '';
    const folderTitle = parent.replace(/^\s*(?:18|19|20)\d{2}[\s_-]*/, '').trim();
    if (folderTitle) return folderTitle;
    return commonPrefix(volumeNames) || '未命名图片书';
  }

  function analyzeImageFiles(fileList) {
    const files = Array.from(fileList || []).filter(isSupportedImage);
    const unsupportedCount = Array.from(fileList || []).length - files.length;
    const groups = new Map();
    files.forEach((file, uploadIndex) => {
      const volumeName = volumeNameFor(file);
      if (!groups.has(volumeName)) groups.set(volumeName, []);
      groups.get(volumeName).push({
        file,
        uploadIndex,
        relativePath: pathParts(file).join('/'),
        filename: file.name,
        // 单张图片无法可靠判断是否为跨页扫描。默认保留为一页，只有用户
        // 在预检中明确改为“跨页”时才生成右、左两张逻辑页。
        mode: 'single',
        splitRatio: 0.5,
      });
    });

    const volumeNames = [...groups.keys()].sort((a, b) => {
      const an = volumeOrdinal(a);
      const bn = volumeOrdinal(b);
      if (an != null && bn != null && an !== bn) return an - bn;
      return naturalCompare(a, b);
    });
    const volumes = volumeNames.map((name, index) => {
      const scans = groups.get(name).sort((a, b) => naturalCompare(a.filename, b.filename));
      if (scans[0]) scans[0].mode = 'single';
      const ordinal = volumeOrdinal(name) ?? (index + 1);
      return {
        key: `volume-${index + 1}`,
        sourceName: name,
        title: name,
        version: `卷${ordinal}`,
        scans,
      };
    });
    return {
      schema: IMPORT_SCHEMA,
      title: suggestedTitle(files, volumeNames),
      files,
      volumes,
      unsupportedCount,
      sourceScanCount: files.length,
      logicalPageCount: countLogicalPages(volumes),
    };
  }

  function countLogicalPages(volumes) {
    return (volumes || []).reduce((total, volume) => total + (volume.scans || []).reduce(
      (sum, scan) => sum + (scan.mode === 'skip' ? 0 : (scan.mode === 'spread' ? 2 : 1)),
      0,
    ), 0);
  }

  function applyModePreset(plan, preset) {
    (plan?.volumes || []).forEach(volume => {
      (volume.scans || []).forEach((scan, index) => {
        if (preset === 'all-single') scan.mode = 'single';
        else if (preset === 'all-spread') scan.mode = 'spread';
        else scan.mode = index === 0 ? 'single' : 'spread';
      });
    });
    plan.logicalPageCount = countLogicalPages(plan.volumes);
    return plan;
  }

  function buildManifest(plan, metadata) {
    const volumes = (plan?.volumes || []).map(volume => ({
      key: volume.key,
      sourceName: volume.sourceName,
      title: volume.title,
      version: volume.version,
      scans: (volume.scans || []).map(scan => ({
        uploadIndex: scan.uploadIndex,
        relativePath: scan.relativePath,
        mode: scan.mode,
        splitRatio: Number(scan.splitRatio || 0.5),
      })),
    }));
    return {
      schema: IMPORT_SCHEMA,
      title: String(metadata?.title || plan?.title || '').trim(),
      dynasty: String(metadata?.dynasty || '').trim(),
      edition: String(metadata?.edition || '').trim(),
      repository: String(metadata?.repository || '').trim(),
      printYear: String(metadata?.printYear || '').trim(),
      textLayout: String(metadata?.textLayout || 'auto'),
      volumes,
    };
  }

  function validatePlan(plan, metadata) {
    const errors = [];
    if (!String(metadata?.title || plan?.title || '').trim()) errors.push('书名不能为空');
    if (!(plan?.volumes || []).length) errors.push('未识别到卷册');
    if (!plan?.sourceScanCount) errors.push('未选择可导入的图片');
    (plan?.volumes || []).forEach(volume => {
      if (!(volume.scans || []).some(scan => scan.mode !== 'skip')) {
        errors.push(`卷册“${volume.sourceName}”不能全部跳过`);
      }
      (volume.scans || []).forEach(scan => {
        if (!['single', 'spread', 'skip'].includes(scan.mode)) {
          errors.push(`${scan.filename} 的页面方式无效`);
        }
        if (scan.mode === 'spread' && !(scan.splitRatio > 0.35 && scan.splitRatio < 0.65)) {
          errors.push(`${scan.filename} 的分割位置必须位于 35%–65%`);
        }
      });
    });
    return errors;
  }

  return {
    IMPORT_SCHEMA,
    IMAGE_EXTENSIONS,
    naturalCompare,
    analyzeImageFiles,
    countLogicalPages,
    applyModePreset,
    buildManifest,
    validatePlan,
  };
});
