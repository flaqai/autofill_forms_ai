import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/store/settingsStore'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { AVAILABLE_MODELS, SUPPORTED_LANGUAGES, STORAGE_KEYS } from '@/config/constants'

export const SettingsPanel = () => {
  const { t, i18n } = useTranslation()
  const { apiKey, apiBaseURL, model, temperature, setApiKey, setApiBaseURL, setModel, setTemperature } =
    useSettingsStore()
  const [localApiKey, setLocalApiKey] = useState(apiKey)
  const [localBaseURL, setLocalBaseURL] = useState(apiBaseURL)
  const [localModel, setLocalModel] = useState(model)
  const [localTemperature, setLocalTemperature] = useState(temperature)
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    setApiKey(localApiKey)
    setApiBaseURL(localBaseURL)
    setModel(localModel)
    setTemperature(localTemperature)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang)
    localStorage.setItem(STORAGE_KEYS.LANGUAGE, lang)
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-semibold text-slate-800">{t('settings.title')}</h2>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">
            {t('settings.apiKey')}
          </label>
          <Input
            type="password"
            value={localApiKey}
            onChange={(e) => setLocalApiKey(e.target.value)}
            placeholder={t('settings.apiKeyPlaceholder')}
            className="w-full text-sm"
          />
          <p className="mt-1 text-[11px] text-slate-500">{t('settings.apiKeyDescription')}</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">
            {t('settings.apiBaseURL')}
          </label>
          <Input
            type="text"
            value={localBaseURL}
            onChange={(e) => setLocalBaseURL(e.target.value)}
            placeholder={t('settings.apiBaseURLPlaceholder')}
            className="w-full text-sm"
          />
          <p className="mt-1 text-[11px] text-slate-500">{t('settings.apiBaseURLDescription')}</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">
            {t('settings.model')}
          </label>
          <Input
            list="available-models"
            value={localModel}
            onChange={(e) => setLocalModel(e.target.value)}
            placeholder="Type or select a model"
            className="w-full text-sm"
          />
          <datalist id="available-models">
            {AVAILABLE_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </datalist>
          <p className="mt-1 text-[11px] text-slate-500">{t('settings.modelDescription')}</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">
            {t('settings.temperature')}: {localTemperature.toFixed(1)}
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={localTemperature}
            onChange={(e) => setLocalTemperature(parseFloat(e.target.value))}
            className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
          />
          <p className="mt-1 text-[11px] text-slate-500">{t('settings.temperatureDescription')}</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">
            {t('settings.language')}
          </label>
          <div className="grid grid-cols-3 gap-2">
            {SUPPORTED_LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                onClick={() => handleLanguageChange(lang.code)}
                className={`px-3 py-2 text-xs rounded-lg border transition-all ${i18n.language === lang.code
                    ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium'
                    : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                  }`}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </div>

        <Button onClick={handleSave} className="w-full">
          {saved ? t('common.saved') : t('common.save')}
        </Button>
      </div>

      <div className="pt-4 border-t border-slate-200">
        <h3 className="text-sm font-semibold text-slate-800 mb-2">{t('settings.about')}</h3>
        <div className="space-y-1 text-xs text-slate-600">
          <p>{t('settings.version')}</p>
          <p>{t('settings.poweredBy')}</p>
        </div>
      </div>
    </div>
  )
}
