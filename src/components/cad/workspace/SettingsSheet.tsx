'use client'

import { useI18n } from '@/components/i18n-provider'

import * as React from 'react'
import { X } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ProviderSettingsPanel } from '@/components/cad/provider-settings-panel'
import { ThemePanel } from '@/components/cad/theme-panel'
import { LanguagePanel } from '@/components/cad/language-panel'

/*
 * Settings, per DESIGN.md "Secondary surfaces".
 *
 * The v1 shell spread eight unrelated things across one "Workspace Tools &
 * Preferences" dropdown. Settings now has a single named entry point (the gear
 * on the brand module) and owns model configuration, appearance, and interface
 * language. Export-all lives at the bottom because it is a
 * maintenance action, not a daily one.
 *
 * The sheet must never clear the composer draft - it renders above the shell
 * and takes no part in the composer's state.
 */

export type SettingsTab = 'providers' | 'theme' | 'language'

export function SettingsSheet({
  open,
  onOpenChange,
  initialTab = 'providers',
  providerRevision,
  onProvidersChanged,
  onExportAllData,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTab?: SettingsTab
  providerRevision?: number
  onProvidersChanged?: () => void
  onExportAllData?: () => void
}) {
  const { t } = useI18n()

  const [tab, setTab] = React.useState<SettingsTab>(initialTab)

  // Opening from a specific entry point (e.g. the first-run provider link)
  // should land on that tab.
  React.useEffect(() => {
    if (open) setTab(initialTab)
  }, [open, initialTab])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        /* The header below carries the shell's own close control; without this the
           primitive's default X stacks on top of it. */
        showCloseButton={false}
        className="w-full sm:max-w-[560px] p-0 gap-0 border-l border-[color:var(--shell-border)] bg-[var(--shell-module-solid)]/97 backdrop-blur-2xl shadow-[inset_1px_0_0_rgba(255,255,255,0.07),-24px_0_48px_-12px_rgba(0,0,0,0.7)]"
        aria-describedby={undefined}
      >
        <SheetHeader className="px-5 pt-4 pb-3 border-b border-[color:var(--shell-border)]">
          <div className="flex items-center justify-between">
            <SheetTitle className="font-mono text-[10px] font-medium tracking-[0.16em] uppercase text-[var(--shell-text-label)]">
              {t("Settings")}
            </SheetTitle>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label={t("Close settings")}
              className="w-6 h-6 grid place-items-center rounded-[4px] text-[var(--shell-text-dim)] hover:text-[var(--shell-text)] hover:bg-[var(--shell-hover)] transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <SheetDescription className="font-mono text-[10.5px] text-[var(--shell-text-dim)] leading-[1.6]">
            {t("Configure your model, appearance and interface language.")}
          </SheetDescription>
        </SheetHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as SettingsTab)}
          className="flex-1 min-h-0 flex flex-col"
        >
          <TabsList className="mx-5 mt-3 self-start bg-[var(--shell-well)] p-0.5 rounded-[5px] gap-0.5">
            <TabsTrigger
              value="providers"
              className="h-6 px-3 rounded-[4px] font-mono text-[10px] tracking-[0.1em] text-[var(--shell-text-dim)] data-[state=active]:bg-[var(--shell-signal)] data-[state=active]:text-[#1A0F08] data-[state=active]:font-bold"
            >
              {t("Providers")}
            </TabsTrigger>
            <TabsTrigger
              value="theme"
              className="h-6 px-3 rounded-[4px] font-mono text-[10px] tracking-[0.1em] text-[var(--shell-text-dim)] data-[state=active]:bg-[var(--shell-signal)] data-[state=active]:text-[#1A0F08] data-[state=active]:font-bold"
            >
              {t("Appearance")}
            </TabsTrigger>
            <TabsTrigger
              value="language"
              className="h-6 px-3 rounded-[4px] font-mono text-[10px] tracking-[0.1em] text-[var(--shell-text-dim)] data-[state=active]:bg-[var(--shell-signal)] data-[state=active]:text-[#1A0F08] data-[state=active]:font-bold"
            >
              {t('Language')}
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 pb-5 pt-3">
            <TabsContent value="providers" forceMount className="mt-0 data-[state=inactive]:hidden">
              <ProviderSettingsPanel key={providerRevision} onProvidersChanged={onProvidersChanged} />
            </TabsContent>
            <TabsContent value="theme" forceMount className="mt-0 data-[state=inactive]:hidden">
              <ThemePanel />
            </TabsContent>
            <TabsContent value="language" forceMount className="mt-0 data-[state=inactive]:hidden">
              <LanguagePanel />
            </TabsContent>
          </div>
        </Tabs>

        {onExportAllData && (
          <div className="border-t border-[color:var(--shell-border)] px-5 py-3">
            <button
              type="button"
              onClick={onExportAllData}
              className="font-mono text-[10px] tracking-[0.1em] text-[var(--shell-text-dim)] hover:text-[var(--shell-text-muted)] transition-colors"
            >
              {t("Export all workspace data")}
            </button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
