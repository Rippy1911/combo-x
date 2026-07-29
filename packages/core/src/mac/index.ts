export {
  DEFAULT_MAC_ROOTS,
  MAC_SENSITIVE_BUNDLE_IDS,
  MAC_SENSITIVE_NAME_PATTERNS,
  checkMacPath,
  isSecureFieldRole,
  isSensitiveApp,
  isTypingTargetAllowed,
} from "./safety.js";
export type { MacAppRef, PathCheck } from "./safety.js";

export {
  COMBO_NATIVE_HOST,
  JARVIS_NATIVE_HOST,
  MAC_NAMED_KEYS,
  MAC_TOOL_NAMES,
  describeMacError,
  isMacToolName,
  macToolOp,
  parseKeyCombo,
  runMacTool,
} from "./bridge.js";
export type {
  ComboNativePort,
  ComboNativeRequest,
  ComboNativeResponse,
  JarvisNativePort,
  JarvisNativeRequest,
  JarvisNativeResponse,
  MacToolDeps,
  MacToolName,
} from "./bridge.js";
