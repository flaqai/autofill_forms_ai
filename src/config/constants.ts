/**
 * Application configuration constants
 * Centralized configuration to avoid hardcoding values throughout the codebase
 */

// API Configuration
export const API_CONFIG = {
  DEFAULT_BASE_URL: 'https://api.openai.com/v1',
  DEFAULT_MODEL: 'gpt-3.5-turbo',
  DEFAULT_TEMPERATURE: 0.7,
  TIMEOUT: 60000, // Increased to 60s for slower APIs
  RETRY_LIMIT: 2
} as const

// Available AI Models
export const AVAILABLE_MODELS = [
  { value: 'gpt-4', label: 'GPT-4' },
  { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
  { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' }
] as const

// Supported Languages
export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'zh-CN', label: '简体中文' },
  { code: 'zh-TW', label: '繁體中文' }
] as const

// Storage Keys
export const STORAGE_KEYS = {
  SETTINGS: 'chat4o-settings',
  LANGUAGE: 'chat4o-language'
} as const

// App Metadata
export const APP_METADATA = {
  NAME: 'Chat4o AI',
  VERSION: '1.0.0',
  DESCRIPTION: 'An AI conversational tool like Monica / Sider'
} as const

// UI Configuration
export const UI_CONFIG = {
  MESSAGE_MAX_WIDTH: '90%',
  SIDEBAR_WIDTH: '420px',
  ANIMATION_DURATION: 300
} as const
