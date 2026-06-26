import type { StateStorage } from 'zustand/middleware'

export const chromeStorage: StateStorage = {
    getItem: async (name: string): Promise<string | null> => {
        if (typeof chrome === 'undefined' || !chrome?.storage?.local) {
            return localStorage.getItem(name)
        }
        const result = await chrome.storage.local.get(name)
        if (result[name] !== undefined) {
            return result[name]
        }
        // Migration from old localStorage
        const fallback = localStorage.getItem(name)
        if (fallback) {
            await chrome.storage.local.set({ [name]: fallback })
            localStorage.removeItem(name) // cleanup
            return fallback
        }
        return null
    },
    setItem: async (name: string, value: string): Promise<void> => {
        if (typeof chrome === 'undefined' || !chrome?.storage?.local) {
            localStorage.setItem(name, value)
            return
        }
        await chrome.storage.local.set({ [name]: value })
    },
    removeItem: async (name: string): Promise<void> => {
        if (typeof chrome === 'undefined' || !chrome?.storage?.local) {
            localStorage.removeItem(name)
            return
        }
        await chrome.storage.local.remove(name)
    },
}
