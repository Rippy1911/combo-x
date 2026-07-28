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
  JarvisNativePort,
  JarvisNativeRequest,
  JarvisNativeResponse,
  MacToolDeps,
  MacToolName,
} from "./bridge.js";
