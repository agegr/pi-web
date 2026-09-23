/** 内置的可用界面语言。 */
export type Locale = "en" | "zh-CN" | "zh-TW";

/** 翻译字符串使用的简单插值参数。 */
export type TranslationParams = Record<string, string | number>;

/** 可注册的语言包定义。 */
export interface LocalePlugin {
  /** 语言包唯一标识。 */
  id: string;
  /** 用于语言选择菜单的显示名称。 */
  label: string;
  /** 以稳定 key 索引的翻译消息。 */
  messages: Record<string, string>;
}
