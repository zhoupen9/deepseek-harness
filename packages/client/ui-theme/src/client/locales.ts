/** `settings.theme` namespace dictionaries (the theme feature's General settings rows). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'appearance.title': '外观',
  'appearance.light': '浅色',
  'appearance.dark': '深色',
  'appearance.system': '跟随系统',
  'fontSize.title': '字号大小',
  'fontSize.description': '仅影响会话内容的字号',
  'fontSize.unit': 'px',
  'fontSize.increase': '增大字号',
  'fontSize.decrease': '减小字号',
  'fontColor.title': '字体颜色',
  'fontColor.description': '浅色与深色模式下的默认文字颜色',
  'fontColor.light': '浅色模式',
  'fontColor.dark': '深色模式',
  'fontColor.reset': '重置',
  'fontColor.invalid': '请输入有效颜色',
  'variantFont.title': '字体',
  'variantFont.description': '界面正文使用的字体',
  'variantFont.default': '默认',
  'monoFont.title': '等宽字体',
  'monoFont.description': '代码块与终端使用的字体',
  'monoFont.default': '默认',
} satisfies Record<string, string>

/** The settings.theme namespace key union. */
export type ThemeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'appearance.title': 'Appearance',
  'appearance.light': 'Light',
  'appearance.dark': 'Dark',
  'appearance.system': 'System',
  'fontSize.title': 'Font size',
  'fontSize.description': 'Only affects conversation content',
  'fontSize.unit': 'px',
  'fontSize.increase': 'Increase font size',
  'fontSize.decrease': 'Decrease font size',
  'fontColor.title': 'Font color',
  'fontColor.description': 'Default text color for light and dark mode',
  'fontColor.light': 'Light mode',
  'fontColor.dark': 'Dark mode',
  'fontColor.reset': 'Reset',
  'fontColor.invalid': 'Enter a valid color',
  'variantFont.title': 'Font',
  'variantFont.description': 'Font used for interface text',
  'variantFont.default': 'Default',
  'monoFont.title': 'Monospace font',
  'monoFont.description': 'Font used for code blocks and terminals',
  'monoFont.default': 'Default',
} satisfies Record<ThemeKey, string>
