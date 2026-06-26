import { ScrollArea } from '@/components/ui'
import { SettingsPanel } from '@/components/settings/SettingsPanel'

export const SettingsPage = () => {
  return (
    <ScrollArea className="h-full">
      <SettingsPanel />
    </ScrollArea>
  )
}
