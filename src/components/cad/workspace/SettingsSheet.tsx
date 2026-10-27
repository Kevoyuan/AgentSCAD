'use client'

import { useI18n } from '@/components/i18n-provider'

import * as React from 'react'
import { Download, X } from 'lucide-react'
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
 * on the brand module) and owns exactly four sections: model configuration,
 * appearance, interface language, and the workspace data export.
 *
 * The export used to sit in a footer strip outside the tab strip, which made it
 * look like sheet chrome (a "close"-adjacent action) rather than a thing you
 * choose. It is a section now - `Data` - with a one-line consequence statement,
 * because "Export all workspace data" never said what you would get (UI-16).
 *
 * The sheet must never clear the composer draft - it renders above the shell
 * and takes no part in the composer's state.
 *
 * Height contract: the sheet is a flex column. The header is `shrink-0`; only the
 * tab body scrolls (`min-h-0 flex-1 overflow-y-auto` + the shell's persistent
 * scrollbar). Before this, the body was allowed to grow and the export row was
 * pushed past the bottom edge of the sheet with no way to reach it.
 */

export type SettingsTab = 'providers' | 'theme' | 'language' | 'data'

/* The selected tab is a tint (`.shell-tab`, globals.css), not a solid fill: the
   composer's action is the one solid signal group on a screen, and a settings tab
   filled with the accent was the second. Keeping the treatment in CSS also settles
   the primitive's `dark:data-[state=active]:bg-input/30`, which out-ranks any
   unprefixed utility and used to need a `dark:` twin at every call site. */
const TAB_TRIGGER =
  'shell-tab h-7 rounded-[4px] border-0 px-3 font-mono text-[11px] tracking-[0.08em] text-[var(--shell-text-muted)] transition-colors hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)] data-[state=active]:font-semibold data-[state=active]:shadow-none'

/* One section shape for every panel body: a label row, then content. Keeps the
   Data section reading as a peer of Providers/Appearance rather than a footer. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--shell-text-label)]">
      {children}
    </h3>
  )
}

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
        className="w-full sm:max-w-[560px] p-0 gap-0 overflow-hidden border-l border-[color:var(--shell-border)] bg-[var(--shell-module-solid)]/97 backdrop-blur-2xl shadow-[inset_1px_0_0_rgba(255,255,255,0.07),-24px_0_48px_-12px_rgba(0,0,0,0.7)]"
        aria-describedby={undefined}
      >
        <SheetHeader className="shrink-0 border-b border-[color:var(--shell-border)] px-5 pt-4 pb-3">
          <div className="flex items-center justify-between gap-3">
            <SheetTitle className="font-mono text-[10px] font-medium tracking-[0.16em] uppercase text-[var(--shell-text-label)]">
              {t("Settings")}
            </SheetTitle>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label={t("Close settings")}
              title={t("Close")}
              className="linear-focus-ring grid h-7 w-7 place-items-center rounded-[4px] text-[var(--shell-text-muted)] transition-colors hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)] outline-none"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
          <SheetDescription className="font-mono text-[12px] leading-[1.6] text-[var(--shell-text-muted)]">
            {t("Configure your model, appearance and interface language.")}
          </SheetDescription>
        </SheetHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as SettingsTab)}
          className="flex-1 min-h-0 flex flex-col gap-0"
        >
          <TabsList
            aria-label={t("Settings sections")}
            className="mx-5 mt-3 mb-0 h-auto self-start gap-0.5 rounded-[6px] border border-[color:var(--shell-hairline)] bg-[var(--shell-well)] p-0.5"
          >
            <TabsTrigger value="providers" className={TAB_TRIGGER}>
              {t("Providers")}
            </TabsTrigger>
            <TabsTrigger value="theme" className={TAB_TRIGGER}>
              {t("Appearance")}
            </TabsTrigger>
            <TabsTrigger value="language" className={TAB_TRIGGER}>
              {t('Language')}
            </TabsTrigger>
            {onExportAllData && (
              <TabsTrigger value="data" className={TAB_TRIGGER}>
                {t("Data")}
              </TabsTrigger>
            )}
          </TabsList>

          <div className="stable-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-3">
            <TabsContent value="providers" forceMount className="mt-0 data-[state=inactive]:hidden">
              <ProviderSettingsPanel key={providerRevision} onProvidersChanged={onProvidersChanged} />
            </TabsContent>
            <TabsContent value="theme" forceMount className="mt-0 data-[state=inactive]:hidden">
              <ThemePanel />
            </TabsContent>
            <TabsContent value="language" forceMount className="mt-0 data-[state=inactive]:hidden">
              <LanguagePanel />
            </TabsContent>
            {onExportAllData && (
              <TabsContent value="data" forceMount className="mt-0 data-[state=inactive]:hidden">
                <SectionLabel>{t("Workspace data")}</SectionLabel>
                <div className="rounded-[6px] border border-[color:var(--shell-hairline)] bg-[var(--shell-well)] px-3 py-3">
                  <p className="font-mono text-[12px] leading-[1.6] text-[var(--shell-text-muted)]">
                    {t("Every job, its parameter set, and its check results, as one JSON file. Nothing is uploaded anywhere — the file is written straight to your downloads.")}
                  </p>
                  <button
                    type="button"
                    onClick={onExportAllData}
                    className="linear-focus-ring mt-3 inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-[color:var(--shell-border-strong)] bg-[var(--shell-raise)] px-2.5 font-mono text-[11px] tracking-[0.04em] text-[var(--shell-text)] transition-colors hover:bg-[var(--shell-hover)] outline-none"
                  >
                    <Download aria-hidden="true" strokeWidth={1.5} className="h-[13px] w-[13px]" />
                    {t("Export all workspace data")}
                  </button>
                </div>
              </TabsContent>
            )}
          </div>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
