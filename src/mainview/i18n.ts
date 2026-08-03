const messages = {
  zh: {
    brand: "PDF 水印工坊",
    localOnly: "本地处理",
    eyebrow: "高清 · 无损 · 不上传",
    title: "把 PDF 变成清晰、可信的图片",
    subtitle: "专为表格和小字号文档优化。添加文字水印，直接导出 300 DPI 无损 PNG。",
    dropTitle: "拖入 PDF，或点击选择",
    dropHint: "推荐单页表格文件，最大 100 MB",
    privacy: "文件不离开设备",
    tableReady: "细线清晰保留",
    highDpi: "最高 600 DPI",
    replaceFile: "更换文件",
    settingsKicker: "导出设置",
    settingsTitle: "水印与清晰度",
    reset: "重置",
    watermarkText: "水印文字",
    watermarkPlaceholder: "仅供内部使用",
    resolution: "输出精度",
    format: "图片格式",
    opacity: "透明度",
    angle: "水印角度",
    density: "平铺密度",
    sparse: "疏",
    balanced: "适中",
    dense: "密",
    fontSize: "水印字号",
    preparing: "正在准备…",
    exportPng: "导出高清 PNG",
    exportJpeg: "导出高清 JPEG",
    exportZip: "导出全部页面 ZIP",
    exportHint: "A4 约 2480 × 3508 px",
    previewKicker: "实时预览",
    previewTitle: "第 1 页",
    previewReady: "预览已更新",
    rendering: "正在渲染预览…",
    previewNote: "预览经过缩放；下载文件将按所选 DPI 重新高清渲染。",
    footer: "浏览器本地处理 · 不留存任何文件",
    filePages: "{pages} 页 · {size}",
    exportProgress: "正在处理第 {current}/{total} 页",
    complete: "高清图片已生成",
    invalidFile: "请选择有效的 PDF 文件",
    fileTooLarge: "PDF 文件不能超过 100 MB",
    loadFailed: "PDF 读取失败，请确认文件未损坏或加密",
    exportFailed: "导出失败，请降低 DPI 后重试",
  },
  en: {
    brand: "PDF Watermark",
    localOnly: "On-device",
    eyebrow: "Sharp · Lossless · Private",
    title: "Turn PDFs into clear, trusted images",
    subtitle: "Built for tables and small text. Add a watermark and export a lossless 300 DPI PNG.",
    dropTitle: "Drop a PDF, or choose one",
    dropHint: "Best for one-page tables, up to 100 MB",
    privacy: "Stays on this device",
    tableReady: "Crisp lines preserved",
    highDpi: "Up to 600 DPI",
    replaceFile: "Replace file",
    settingsKicker: "EXPORT SETUP",
    settingsTitle: "Watermark & quality",
    reset: "Reset",
    watermarkText: "Watermark text",
    watermarkPlaceholder: "INTERNAL USE ONLY",
    resolution: "Resolution",
    format: "Image format",
    opacity: "Opacity",
    angle: "Text angle",
    density: "Tile density",
    sparse: "Sparse",
    balanced: "Balanced",
    dense: "Dense",
    fontSize: "Text size",
    preparing: "Preparing…",
    exportPng: "Export HD PNG",
    exportJpeg: "Export HD JPEG",
    exportZip: "Export all as ZIP",
    exportHint: "A4 is about 2480 × 3508 px",
    previewKicker: "LIVE PREVIEW",
    previewTitle: "Page 1",
    previewReady: "Preview updated",
    rendering: "Rendering preview…",
    previewNote: "Preview is scaled. The download is rendered again at your selected DPI.",
    footer: "Processed on-device · No files retained",
    filePages: "{pages} pages · {size}",
    exportProgress: "Processing page {current}/{total}",
    complete: "HD image is ready",
    invalidFile: "Please choose a valid PDF file",
    fileTooLarge: "PDF files must be under 100 MB",
    loadFailed: "Could not read this PDF. It may be damaged or encrypted",
    exportFailed: "Export failed. Try a lower DPI",
  },
} as const;

export type Locale = keyof typeof messages;
export type MessageKey = keyof typeof messages.zh;

let locale: Locale = navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";

export const getLocale = () => locale;

export const setLocale = (nextLocale: Locale) => {
  locale = nextLocale;
};

export const t = (key: MessageKey, params: Record<string, string | number> = {}) => {
  let result: string = messages[locale][key];
  Object.entries(params).forEach(([name, value]) => {
    result = result.replace(`{${name}}`, String(value));
  });
  return result;
};

export const applyTranslations = () => {
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n as MessageKey;
    element.textContent = t(key);
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-placeholder]").forEach((element) => {
    const key = element.dataset.i18nPlaceholder as MessageKey;
    element.setAttribute("placeholder", t(key));
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach((element) => {
    const key = element.dataset.i18nAria as MessageKey;
    element.setAttribute("aria-label", t(key));
  });
};
