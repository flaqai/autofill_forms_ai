import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { chatAPI } from '@/services/api'
import { API_CONFIG, STORAGE_KEYS } from '@/config/constants'
import { createJSONStorage } from 'zustand/middleware'
import { chromeStorage } from './chromeStorage'

interface SettingsState {
  apiKey: string
  apiBaseURL: string
  model: string
  temperature: number

  setApiKey: (key: string) => void
  setApiBaseURL: (url: string) => void
  setModel: (model: string) => void
  setTemperature: (temperature: number) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      apiKey: '',
      apiBaseURL: API_CONFIG.DEFAULT_BASE_URL,
      model: API_CONFIG.DEFAULT_MODEL,
      temperature: API_CONFIG.DEFAULT_TEMPERATURE,

      setApiKey: (key) => {
        set({ apiKey: key })
        chatAPI.setApiKey(key)
      },

      setApiBaseURL: (url) => {
        set({ apiBaseURL: url })
        chatAPI.setBaseURL(url)
      },

      setModel: (model) => {
        set({ model })
        chatAPI.setDefaultModel(model)
      },

      setTemperature: (temperature) => {
        set({ temperature })
        chatAPI.setDefaultTemperature(temperature)
      }
    }),
    {
      name: STORAGE_KEYS.SETTINGS,
      storage: createJSONStorage(() => chromeStorage),
    }
  )
)
