'use client'

import { useI18n } from '@/components/i18n-provider'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, KeyRound, Loader2, Plug, Plus, Server, ShieldCheck, Star, Trash2, Wifi } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  deleteProvider,
  clearProviders,
  fetchProviders,
  saveProvider,
  testProvider,
  type EnvProviderConfig,
  type ProviderConfig,
  type ProviderSettingsPersistence,
} from '@/components/cad/api'
import {
  DEFAULT_PROVIDER_PERSISTENCE,
  getProviderEnvironmentKey,
  getProviderSettingsUiState,
} from '@/components/cad/provider-settings-state'
import { PROVIDER_PRESETS } from '@/lib/provider-catalog'

const EMPTY_FORM = {
  id: undefined as string | undefined,
  preset: 'openai',
  name: 'OpenAI',
  type: 'openai-compatible',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  defaultModel: 'gpt-5.6',
  enabled: true,
  isDefault: false,
  keepExistingApiKey: false,
}

/* Shell tokens only (DESIGN.md section 22): this panel used the un-themed `--app-*`
   accent/active fills, which in dark mode put amber text at 4.2:1 and a 3% white
   wash where the selected tab should be. */
const FIELD =
  'shell-field h-8 rounded-[4px] border-[color:var(--shell-border)] bg-[var(--shell-module-solid)] text-[12px] text-[var(--shell-text)] placeholder:text-[var(--shell-text-muted)] focus:border-[var(--shell-signal)] focus-visible:ring-0'
const LABEL = 'flex items-center gap-1.5 text-[12px] font-medium text-[var(--shell-text-label)]'
const ICON_BUTTON =
  'linear-focus-ring h-7 w-7 shrink-0 rounded-[4px] text-[var(--shell-text-muted)] outline-none transition-colors hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)]'

export function ProviderSettingsPanel({
  onProvidersChanged,
}: {
  onProvidersChanged?: () => void
}) {
  const { t } = useI18n()

  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [envProviders, setEnvProviders] = useState<EnvProviderConfig[]>([])
  const [persistence, setPersistence] = useState<ProviderSettingsPersistence>(DEFAULT_PROVIDER_PERSISTENCE)
  const [form, setForm] = useState(EMPTY_FORM)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)

  const loadProviders = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await fetchProviders()
      setProviders(data.providers)
      setEnvProviders(data.envProviders)
      setPersistence(data.persistence)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Failed to load providers"))
    } finally {
      setIsLoading(false)
    }
  }, [t])

  useEffect(() => {
    loadProviders()
  }, [loadProviders])

  const activeEnvProviders = useMemo(
    () => envProviders.filter(provider => provider.enabled),
    [envProviders]
  )
  const selectedPreset = useMemo(
    () => PROVIDER_PRESETS.find(preset => preset.id === form.preset),
    [form.preset]
  )
  const selectedEnvKey = getProviderEnvironmentKey(selectedPreset?.apiKeyEnv)
  const persistenceUi = getProviderSettingsUiState(persistence, isLoading)

  const updateForm = (partial: Partial<typeof EMPTY_FORM>) => {
    setForm(prev => ({ ...prev, ...partial }))
  }

  const handlePresetChange = (presetId: string) => {
    const preset = PROVIDER_PRESETS.find(item => item.id === presetId) || PROVIDER_PRESETS[0]
    setForm(prev => ({
      ...prev,
      preset: preset.id,
      name: preset.label,
      type: preset.type,
      baseUrl: preset.baseUrl,
      defaultModel: preset.defaultModel,
      apiKey: preset.requiresApiKey ? prev.apiKey : '',
      keepExistingApiKey: false,
    }))
  }

  const handleEdit = (provider: ProviderConfig) => {
    setForm({
      id: provider.id,
      preset: 'custom',
      name: provider.name,
      type: provider.type,
      baseUrl: provider.baseUrl,
      apiKey: '',
      defaultModel: provider.defaultModel,
      enabled: provider.enabled,
      isDefault: provider.isDefault,
      keepExistingApiKey: provider.hasApiKey,
    })
  }

  const handleReset = () => {
    setForm(EMPTY_FORM)
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await saveProvider(form)
      toast.success(form.id ? t("Provider updated") : t("Provider added"))
      handleReset()
      await loadProviders()
      onProvidersChanged?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Failed to save provider"))
    } finally {
      setIsSaving(false)
    }
  }

  const handleTest = async () => {
    setIsTesting(true)
    try {
      await testProvider(form)
      toast.success(t("Provider connection works"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Failed to test provider"))
    } finally {
      setIsTesting(false)
    }
  }

  const handleDelete = async (provider: ProviderConfig) => {
    try {
      await deleteProvider(provider.id)
      toast.success(t("Provider removed"))
      if (form.id === provider.id) handleReset()
      await loadProviders()
      onProvidersChanged?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Failed to delete provider"))
    }
  }

  const handleClearProviders = async () => {
    try {
      await clearProviders()
      toast.success(t("Provider keys cleared from this browser session"))
      handleReset()
      await loadProviders()
      onProvidersChanged?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Failed to clear provider keys"))
    }
  }

  const handleSetDefault = async (provider: ProviderConfig) => {
    try {
      await saveProvider({
        id: provider.id,
        name: provider.name,
        type: provider.type,
        baseUrl: provider.baseUrl,
        keepExistingApiKey: true,
        defaultModel: provider.defaultModel,
        enabled: provider.enabled,
        isDefault: true,
      })
      await loadProviders()
      onProvidersChanged?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Failed to set default"))
    }
  }

  /* Honest disabled states: a dimmed Save/Test that cannot say why is worse than a
     plain disabled control that names its precondition in `title`. */
  const saveDisabledReason = isSaving
    ? t("Saving…")
    : isTesting
      ? t("Wait for the connection test to finish")
      : !persistenceUi.canSave
        ? persistence.writable
          ? t("Save is unavailable right now")
          : t("Configure {0} in Vercel Project Settings", { 0: selectedEnvKey })
        : undefined
  const testDisabledReason = isSaving
    ? t("Wait for the save to finish")
    : isTesting
      ? t("Testing…")
      : undefined

  return (
    <div className="space-y-4 p-1">
      <div className="space-y-2">
        <div className="flex min-h-8 items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Plug className="w-3.5 h-3.5 text-[var(--shell-signal-soft)]" />
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--shell-signal-soft)]">{t("Providers")}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="linear-focus-ring h-7 gap-1 rounded-[4px] px-2 text-[12px] text-[var(--shell-text-muted)] hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)]"
            onClick={handleReset}
          >
            <Plus className="w-3.5 h-3.5" />{t("Add")}
          </Button>
        </div>

        {activeEnvProviders.length > 0 && (
          <div className="rounded-[6px] border border-[color:var(--shell-border)] bg-[var(--shell-well)] px-3 py-2">
            <div className="flex items-center gap-2 text-[12px] text-[var(--shell-text-muted)]">
              <Wifi className="w-3.5 h-3.5 text-[var(--shell-ok)]" />
              {t("Environment keys detected")}
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {activeEnvProviders.map(provider => (
                <span key={provider.id} className="cad-chip">
                  {provider.name} · {provider.envKey}
                </span>
              ))}
            </div>
          </div>
        )}

        {persistenceUi.showEnvironmentNotice && (
          /*
           * Action first. The old copy opened with how Vercel stores providers and
           * closed with an apology about saving, which is deployment detail, not an
           * instruction (UI-10: "do not explain the application's own
           * architecture"). What a person needs is the variable name, where to put
           * it, and whether the Test button they can see will do anything.
           */
          <div className="rounded-[6px] border border-[color:var(--shell-border)] bg-[var(--shell-well)] px-3 py-2 text-[12px] leading-5 text-[var(--shell-text-muted)]">
            {t("This deployment reads keys from environment variables. Set")} <span className="font-mono text-[var(--shell-warn)]">{selectedEnvKey}</span> {t("in Project Settings and redeploy — a key entered here can be tested but is not saved.")}
          </div>
        )}

        {persistenceUi.showSessionNotice && (
          <div className="rounded-[6px] border border-[color:var(--shell-border)] bg-[var(--shell-well)] px-3 py-2">
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--shell-ok)]">
              <ShieldCheck className="h-3.5 w-3.5" />{t("Encrypted session storage")}
            </span>
            <div className="mt-1 text-[12px] leading-5 text-[var(--shell-text-muted)]">
              {t("API keys are encrypted, unavailable to page JavaScript, and expire when the browser session ends.")}
            </div>
          </div>
        )}

        <div className="stable-scrollbar max-h-48 space-y-2 overflow-y-auto pr-1">
          {isLoading ? (
            <div className="flex h-20 items-center justify-center">
              <Loader2 className="w-4 h-4 animate-spin text-[var(--shell-text-muted)]" />
            </div>
          ) : providers.length === 0 ? (
            <div className="rounded-[6px] border border-dashed border-[color:var(--shell-border)] px-3 py-4 text-center text-[12px] text-[var(--shell-text-muted)]">
              {t("No providers saved for this session.")}
            </div>
          ) : providers.map(provider => (
            <div key={provider.id} className="rounded-[6px] border border-[color:var(--shell-border)] bg-[var(--shell-well)] px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  className="linear-focus-ring -mx-1 min-w-0 rounded-[4px] px-1 py-0.5 text-left outline-none transition-colors hover:bg-[var(--shell-hover)]"
                  onClick={() => handleEdit(provider)}
                  title={t("Edit provider")}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-[var(--shell-text)]">{provider.name}</span>
                    {provider.isDefault && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.08em] text-[var(--shell-warn)]">
                        <Star className="h-3 w-3 fill-[var(--shell-warn)] text-[var(--shell-warn)]" />
                        {t("Default")}
                      </span>
                    )}
                    {!provider.enabled && <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--shell-text-label)]">{t("Off")}</span>}
                  </div>
                  <div className="mt-0.5 truncate text-[12px] text-[var(--shell-text-muted)]">
                    {provider.defaultModel} · {provider.apiKeyPreview || t("no key")}
                  </div>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleSetDefault(provider)}
                    aria-label={t("Set default provider")}
                    title={provider.isDefault ? t("Already the default provider") : t("Set default provider")}
                    className={`${ICON_BUTTON} ${provider.isDefault ? 'text-[var(--shell-warn)] hover:text-[var(--shell-warn)]' : 'hover:text-[var(--shell-warn)]'}`}
                  >
                    <Star className={`w-3.5 h-3.5 ${provider.isDefault ? 'fill-[var(--shell-warn)]' : ''}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(provider)}
                    aria-label={t("Delete provider")}
                    title={t("Delete provider")}
                    className={`${ICON_BUTTON} hover:text-[var(--shell-fail)]`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Separator className="bg-[var(--shell-hairline)]" />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className={LABEL}>{t("Preset")}</Label>
          <Select value={form.preset} onValueChange={handlePresetChange}>
            <SelectTrigger className={`${FIELD} w-full`} aria-label={t("Preset")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_PRESETS.map(preset => (
                <SelectItem key={preset.id} value={preset.id}>{preset.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="text-[11px] leading-4 text-[var(--shell-text-muted)]">
            {selectedPreset?.description}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className={LABEL} htmlFor="provider-name">{t("Name")}</Label>
          <Input id="provider-name" value={form.name} onChange={event => updateForm({ name: event.target.value })} className={FIELD} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className={LABEL} htmlFor="provider-base-url">
          <Server className="w-3 h-3" />{t("Base URL")}
        </Label>
        <Input id="provider-base-url" value={form.baseUrl} onChange={event => updateForm({ baseUrl: event.target.value })} className={FIELD} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className={LABEL} htmlFor="provider-api-key">
            <KeyRound className="w-3 h-3" />{t("API Key")}
          </Label>
          <Input
            id="provider-api-key"
            type="password"
            value={form.apiKey}
            onChange={event => updateForm({ apiKey: event.target.value, keepExistingApiKey: false })}
            placeholder={form.keepExistingApiKey ? t("Keep existing key") : 'sk-...'}
            className={FIELD}
          />
        </div>
        <div className="space-y-1.5">
          <Label className={LABEL} htmlFor="provider-model">{t("Model ID")}</Label>
          <Input id="provider-model" value={form.defaultModel} onChange={event => updateForm({ defaultModel: event.target.value })} className={FIELD} />
          {selectedPreset && selectedPreset.recommendedModels.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {selectedPreset.recommendedModels.map(recommended => {
                const selected = form.defaultModel === recommended.id
                return (
                  <button
                    key={recommended.id}
                    type="button"
                    title={recommended.description}
                    aria-pressed={selected}
                    onClick={() => updateForm({ defaultModel: recommended.id })}
                    className={`linear-focus-ring inline-flex min-h-6 items-center rounded-[4px] border px-2 py-0.5 text-[11px] leading-4 transition-colors ${
                      selected
                        ? 'border-[color:color-mix(in_srgb,var(--shell-signal)_55%,transparent)] bg-[color:color-mix(in_srgb,var(--shell-signal)_12%,transparent)] text-[var(--shell-signal-soft)]'
                        : 'border-[color:var(--shell-border)] text-[var(--shell-text-muted)] hover:border-[color:var(--shell-border-strong)] hover:text-[var(--shell-text)]'
                    }`}
                  >
                    {recommended.label}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-5">
          <div className="flex min-h-7 items-center gap-2">
            <Switch
              id="provider-enabled"
              checked={form.enabled}
              onCheckedChange={enabled => updateForm({ enabled })}
              aria-label={t("Enabled")}
              title={t("Enabled")}
            />
            <Label htmlFor="provider-enabled" className="text-[12px] font-normal text-[var(--shell-text-muted)]">{t("Enabled")}</Label>
          </div>
          <div className="flex min-h-7 items-center gap-2">
            <Switch
              id="provider-default"
              checked={form.isDefault}
              onCheckedChange={isDefault => updateForm({ isDefault })}
              aria-label={t("Default")}
              title={t("Default")}
            />
            <Label htmlFor="provider-default" className="text-[12px] font-normal text-[var(--shell-text-muted)]">{t("Default")}</Label>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {persistence.mode === 'encrypted-cookie' && providers.length > 0 && (
            <Button variant="ghost" size="sm" className="linear-focus-ring h-8 gap-1 rounded-[6px] px-2.5 text-[12px] text-[var(--shell-fail)] hover:bg-[var(--shell-hover)] hover:text-[var(--shell-fail)]" onClick={handleClearProviders}>
              <Trash2 className="w-3.5 h-3.5" />
              {t("Clear keys")}
            </Button>
          )}
          <span title={testDisabledReason}>
            <Button
              variant="outline"
              size="sm"
              className="linear-focus-ring h-8 gap-1 rounded-[6px] border-[color:var(--shell-border)] bg-transparent px-3 text-[12px] text-[var(--shell-text-muted)] hover:border-[color:var(--shell-border-strong)] hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)] disabled:opacity-40"
              onClick={handleTest}
              disabled={isTesting || isSaving}
            >
              {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {t("Test")}
            </Button>
          </span>
          <span title={saveDisabledReason}>
            <Button
              size="sm"
              className="linear-focus-ring h-8 gap-1 rounded-[6px] bg-[var(--shell-signal)] px-3 text-[12px] font-medium text-[var(--shell-signal-ink)] hover:bg-[var(--shell-signal-hover)] disabled:opacity-40 disabled:pointer-events-none"
              onClick={handleSave}
              disabled={isSaving || isTesting || !persistenceUi.canSave}
            >
              {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
              {t("Save")}
            </Button>
          </span>
        </div>
      </div>
    </div>
  )
}
