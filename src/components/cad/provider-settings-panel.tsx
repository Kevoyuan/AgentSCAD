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
      toast.error(error instanceof Error ? error.message : t("Provider test failed"))
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

  return (
    <div className="space-y-4 p-1">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Plug className="w-3.5 h-3.5 text-[var(--app-accent-text)]" />
            <span className="text-[13px] font-mono tracking-widest text-[var(--app-accent-text)] uppercase">{t("Providers")}</span>
          </div>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={handleReset}>
            <Plus className="w-3.5 h-3.5" />{t("Add")}
          </Button>
        </div>

        {activeEnvProviders.length > 0 && (
          <div className="rounded-lg border border-[color:var(--app-border)] bg-[var(--app-bg)] px-3 py-2">
            <div className="flex items-center gap-2 text-[13px] text-[var(--app-text-secondary)]">
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
          <div className="rounded-lg border border-transparent bg-transparent px-3 py-2 text-xs leading-5 text-[var(--app-text-secondary)]">
            {t("Vercel stores providers through environment variables. Add")} <span className="font-mono text-[var(--shell-warn)]">{selectedEnvKey}</span> {t("in Vercel Project Settings, then redeploy. You can test a key here, but it will not be saved.")}
          </div>
        )}

        {persistenceUi.showSessionNotice && (
          <div className="rounded-lg border border-transparent bg-transparent px-3 py-2 text-xs leading-5 text-[var(--app-text-secondary)]">
            <span className="inline-flex items-center gap-1.5 font-medium text-[var(--shell-ok)]">
              <ShieldCheck className="h-3.5 w-3.5" />{t("Encrypted session storage")}
            </span>
            <div className="mt-1">
              {t("API keys are encrypted, unavailable to page JavaScript, and expire when the browser session ends.")}
            </div>
          </div>
        )}

        <div className="space-y-2 max-h-44 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--app-scrollbar-thumb) transparent' }}>
          {isLoading ? (
            <div className="flex h-20 items-center justify-center">
              <Loader2 className="w-4 h-4 animate-spin text-[var(--app-text-muted)]" />
            </div>
          ) : providers.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[color:var(--app-border)] px-3 py-4 text-center text-xs text-[var(--app-text-muted)]">
              {t("No providers saved for this session.")}
            </div>
          ) : providers.map(provider => (
            <div key={provider.id} className="rounded-lg border border-[color:var(--app-border)] bg-[var(--app-bg)] px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <button type="button" className="min-w-0 text-left" onClick={() => handleEdit(provider)}>
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-[var(--app-text-primary)]">{provider.name}</span>
                    {provider.isDefault && <Star className="w-3 h-3 fill-[var(--shell-warn)] text-[var(--shell-warn)]" />}
                    {!provider.enabled && <span className="text-[10px] uppercase text-[var(--app-text-muted)]">{t("Off")}</span>}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-[var(--app-text-muted)]">
                    {provider.defaultModel} · {provider.apiKeyPreview || t("no key")}
                  </div>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleSetDefault(provider)} aria-label={t("Set default provider")}>
                    <Star className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-[var(--shell-fail)] hover:text-[var(--shell-fail)]" onClick={() => handleDelete(provider)} aria-label={t("Delete provider")}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Separator className="bg-[var(--app-surface-hover)]" />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-[var(--app-text-muted)]">{t("Preset")}</Label>
          <Select value={form.preset} onValueChange={handlePresetChange}>
            <SelectTrigger className="h-8 w-full bg-[var(--app-bg)] border-[color:var(--app-border)]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_PRESETS.map(preset => (
                <SelectItem key={preset.id} value={preset.id}>{preset.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="text-[10px] leading-4 text-[var(--app-text-muted)]">
            {selectedPreset?.description}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-[var(--app-text-muted)]">{t("Name")}</Label>
          <Input value={form.name} onChange={event => updateForm({ name: event.target.value })} className="h-8 bg-[var(--app-bg)] border-[color:var(--app-border)]" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-[var(--app-text-muted)] flex items-center gap-1.5">
          <Server className="w-3 h-3" />{t("Base URL")}
        </Label>
        <Input value={form.baseUrl} onChange={event => updateForm({ baseUrl: event.target.value })} className="h-8 bg-[var(--app-bg)] border-[color:var(--app-border)]" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-[var(--app-text-muted)] flex items-center gap-1.5">
            <KeyRound className="w-3 h-3" />{t("API Key")}
          </Label>
          <Input
            type="password"
            value={form.apiKey}
            onChange={event => updateForm({ apiKey: event.target.value, keepExistingApiKey: false })}
            placeholder={form.keepExistingApiKey ? t("Keep existing key") : 'sk-...'}
            className="h-8 bg-[var(--app-bg)] border-[color:var(--app-border)]"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-[var(--app-text-muted)]">{t("Model")}</Label>
          <Input value={form.defaultModel} onChange={event => updateForm({ defaultModel: event.target.value })} className="h-8 bg-[var(--app-bg)] border-[color:var(--app-border)]" />
          {selectedPreset && selectedPreset.recommendedModels.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {selectedPreset.recommendedModels.map(recommended => (
                <button
                  key={recommended.id}
                  type="button"
                  title={recommended.description}
                  onClick={() => updateForm({ defaultModel: recommended.id })}
                  className={`rounded border px-1.5 py-0.5 text-[10px] transition-colors ${
                    form.defaultModel === recommended.id
                      ? 'border-[color:var(--app-accent)] bg-[var(--app-accent-bg)] text-[var(--app-accent-text)]'
                      : 'border-[color:var(--app-border)] text-[var(--app-text-muted)] hover:text-[var(--app-text-secondary)]'
                  }`}
                >
                  {recommended.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-[var(--app-text-secondary)]">
          <Switch checked={form.enabled} onCheckedChange={enabled => updateForm({ enabled })} />
          {t("Enabled")}
        </label>
        <label className="flex items-center gap-2 text-xs text-[var(--app-text-secondary)]">
          <Switch checked={form.isDefault} onCheckedChange={isDefault => updateForm({ isDefault })} />
          {t("Default")}
        </label>
        <div className="ml-auto flex items-center gap-2">
          {persistence.mode === 'encrypted-cookie' && providers.length > 0 && (
            <Button variant="ghost" size="sm" className="h-8 gap-1 text-[var(--shell-fail)] hover:text-[var(--shell-fail)]" onClick={handleClearProviders}>
              <Trash2 className="w-3.5 h-3.5" />
              {t("Clear keys")}
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-8 gap-1" onClick={handleTest} disabled={isTesting || isSaving}>
            {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {t("Test")}
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1 bg-[var(--app-accent)] hover:bg-[var(--app-accent-hover)]"
            onClick={handleSave}
            disabled={isSaving || isTesting || !persistenceUi.canSave}
            title={!persistence.writable ? t("Configure {0} in Vercel Project Settings", { 0: selectedEnvKey }) : undefined}
          >
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
            {t("Save")}
          </Button>
        </div>
      </div>
    </div>
  )
}
