'use client'

import { useI18n } from '@/components/i18n-provider'

import { useState, useRef, useEffect, useSyncExternalStore } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createPortal } from 'react-dom'
import {
  Bell, CheckCircle2, XCircle, Ban, Settings, Code2, AlertTriangle,
  CheckCheck, Trash2, X, Activity
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { JobActivityFeed, type ActivityEvent } from './job-activity-feed'

// ─── Notification Types ────────────────────────────────────────────────────

export type NotificationType =
  | 'job_completed'
  | 'job_review'
  | 'job_failed'
  | 'job_cancelled'
  | 'parameter_updated'
  | 'scad_updated'

export interface Notification {
  id: string
  type: NotificationType
  title: string
  description: string
  timestamp: Date
  read: boolean
}

/*
 * The drawer is portalled to <body>, which is a client-only concern: rendering it
 * during SSR would produce markup React cannot hydrate against.
 *
 * This is deliberately not `useState(false)` + `useEffect(() => setMounted(true))`:
 * setting state synchronously in an effect triggers a cascading render
 * (`react-hooks/set-state-in-effect`), and the effect is not synchronising with an
 * external system - it is only asking "is this the client yet". `useSyncExternalStore`
 * answers that question during render with no extra commit.
 */
const subscribeToNothing = () => () => {}
const onClient = () => true
const onServer = () => false

/* DESIGN.md section 14: the shell's one focus ring. */
const FOCUS = 'linear-focus-ring outline-none'
/* A view chip is a control with a visible selected state; 28px tall so it is a real
   target rather than an 8px label with padding. */
const VIEW_CHIP = `inline-flex h-7 items-center rounded-[4px] px-2.5 text-[11px] font-medium transition-colors ${FOCUS}`

// ─── Notification Icon & Color Mapping ─────────────────────────────────────

const NOTIFICATION_CONFIG: Record<NotificationType, { icon: typeof CheckCircle2; color: string; plate: string }> = {
  /* Semantic colours from the palette, never Tailwind steps (DESIGN.md section 11). */
  job_completed: {
    icon: CheckCircle2,
    color: 'text-[var(--shell-ok)]',
    plate: 'border-[color:color-mix(in_srgb,var(--shell-ok)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--shell-ok)_10%,transparent)]',
  },
  job_review: {
    icon: AlertTriangle,
    color: 'text-[var(--shell-warn)]',
    plate: 'border-[color:color-mix(in_srgb,var(--shell-warn)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--shell-warn)_10%,transparent)]',
  },
  job_failed: {
    icon: XCircle,
    color: 'text-[var(--shell-fail)]',
    plate: 'border-[color:color-mix(in_srgb,var(--shell-fail)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--shell-fail)_10%,transparent)]',
  },
  job_cancelled: {
    icon: Ban,
    color: 'text-[var(--shell-text-label)]',
    plate: 'border-[color:var(--shell-border)] bg-[var(--shell-well)]',
  },
  parameter_updated: {
    icon: Settings,
    color: 'text-[var(--shell-signal-soft)]',
    plate: 'border-[color:color-mix(in_srgb,var(--shell-signal)_45%,transparent)] bg-[color-mix(in_srgb,var(--shell-signal)_10%,transparent)]',
  },
  scad_updated: {
    icon: Code2,
    color: 'text-[var(--shell-signal-soft)]',
    plate: 'border-[color:color-mix(in_srgb,var(--shell-signal)_45%,transparent)] bg-[color-mix(in_srgb,var(--shell-signal)_10%,transparent)]',
  },
}

// ─── Time ago helper ───────────────────────────────────────────────────────

function notifTimeAgo(date: Date): string {
  const now = Date.now()
  const then = date.getTime()
  const diff = Math.floor((now - then) / 1000)
  if (diff < 0) return 'just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

// ─── Notification Item ─────────────────────────────────────────────────────

function NotificationItem({
  notification,
  onMarkRead,
}: {
  notification: Notification
  onMarkRead: (id: string) => void
}) {
  const { t } = useI18n()
  const config = NOTIFICATION_CONFIG[notification.type]
  const Icon = config.icon

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={`flex w-full cursor-pointer items-start gap-2.5 border-l-2 px-3 py-2.5 text-left transition-colors hover:bg-[var(--shell-hover)] ${FOCUS} ${
        !notification.read ? 'border-l-[color:var(--shell-signal)]' : 'border-l-transparent'
      }`}
      onClick={() => {
        if (!notification.read) onMarkRead(notification.id)
      }}
      aria-label={notification.read
        ? t("Notification: {0}", { 0: notification.title })
        : t("{0}. Unread. Activate to mark as read.", { 0: notification.title })}
    >
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border ${config.plate}`}>
        <Icon className={`h-3.5 w-3.5 ${config.color}`} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[13px] leading-4 ${notification.read ? 'text-[var(--shell-text-muted)]' : 'font-medium text-[var(--shell-text)]'}`}>
          {notification.title}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-[12px] leading-4 text-[var(--shell-text-muted)]">
          {notification.description}
        </span>
        <span className="mt-1 flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-[var(--shell-text-label)]">
          <span>{notifTimeAgo(notification.timestamp)}</span>
          {!notification.read && (
            <span className="inline-flex items-center gap-1 text-[var(--shell-signal-soft)]">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--shell-signal)]" />
              {t("New")}
            </span>
          )}
        </span>
      </span>
    </motion.button>
  )
}

// ─── Notification Center ───────────────────────────────────────────────────

interface NotificationCenterProps {
  notifications: Notification[]
  activityEvents: ActivityEvent[]
  onMarkRead: (id: string) => void
  onMarkAllRead: () => void
  onClearAll: () => void
  onClearActivity: () => void
  onActivityClick?: (event: ActivityEvent) => void
}

export function NotificationCenter({
  notifications,
  activityEvents,
  onMarkRead,
  onMarkAllRead,
  onClearAll,
  onClearActivity,
  onActivityClick,
}: NotificationCenterProps) {
  const { t } = useI18n()

  const [isOpen, setIsOpen] = useState(false)
  const [activeView, setActiveView] = useState<'notifications' | 'activity'>('notifications')
  const panelRef = useRef<HTMLDivElement>(null)

  const unreadCount = notifications.filter(n => !n.read).length

  const mounted = useSyncExternalStore(subscribeToNothing, onClient, onServer)

  // DESIGN.md "Secondary surfaces": a tier-2 surface is dismissed with Esc.
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen])

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell Button */}
      <Button
        variant="ghost"
        size="sm"
        /* DESIGN.md section 21: an icon-only control carries an accessible name. */
        aria-label={unreadCount > 0 ? t("Notifications, {0} unread", { 0: unreadCount }) : t("Notifications")}
        title={t("Notifications")}
        className="relative h-7 w-7 rounded-[4px] p-0 text-[var(--shell-text-muted)] hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)]"
        onClick={() => {
          setActiveView(unreadCount > 0 || notifications.length > 0 ? 'notifications' : 'activity')
          setIsOpen(!isOpen)
        }}
      >
        <Bell className="w-3.5 h-3.5" />
        {unreadCount > 0 && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--shell-signal)] px-1 font-mono text-[10px] font-semibold tabular-nums text-[var(--shell-signal-ink)]"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </motion.span>
        )}
      </Button>

      {/* DESIGN.md "Secondary surfaces": the bell opens a right-hand drawer, not a
          popover, so it never covers the part and never competes with the composer.
          Portalled to <body> because `position: fixed` inside the stage's scaled
          transform would resolve against the stage instead of the viewport. */}
      {mounted && createPortal(
        <AnimatePresence>
        {isOpen && (
          <>
          <motion.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[59] bg-black/55"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />
          <motion.aside
            key="drawer"
            role="dialog"
            aria-label={t("Notifications")}
            initial={{ x: 28, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 28, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="fixed right-0 top-0 bottom-0 z-[60] flex w-[368px] max-w-[86vw] flex-col bg-[var(--shell-module-solid)]/97 backdrop-blur-2xl border-l border-[color:var(--shell-border)] shadow-[-24px_0_48px_-12px_rgba(0,0,0,0.7)]"
          >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[color:var(--shell-border)] px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <Bell className="h-3.5 w-3.5 shrink-0 text-[var(--shell-signal-soft)]" />
                {/* The drawer's title follows its tab. It said "Notifications"
                    while opening on "Activity" whenever there was nothing unread -
                    a panel whose name does not match its contents is the first thing
                    a reader has to work around. */}
                <span className="truncate text-[13px] font-medium text-[var(--shell-text)]">
                  {activeView === 'notifications' ? t("Notifications") : t("Activity")}
                </span>
                {unreadCount > 0 && (
                  <span className="shrink-0 rounded-full border border-[color:color-mix(in_srgb,var(--shell-signal)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--shell-signal)_12%,transparent)] px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-[var(--shell-signal-soft)]">
                    {t("{0} new", { 0: unreadCount })}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {unreadCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-7 gap-1 rounded-[4px] px-2 text-[11px] text-[var(--shell-signal-soft)] hover:bg-[var(--shell-hover)] hover:text-[var(--shell-signal)] ${FOCUS}`}
                    onClick={onMarkAllRead}
                    title={t("Mark all as read")}
                  >
                    <CheckCheck className="w-3 h-3" />{t("Mark all read")}
                  </Button>
                )}
                {notifications.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-7 gap-1 rounded-[4px] px-2 text-[11px] text-[var(--shell-text-muted)] hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)] ${FOCUS}`}
                    onClick={onClearAll}
                    title={t("Clear notifications")}
                  >
                    <Trash2 className="w-3 h-3" />{t("Clear")}
                  </Button>
                )}
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  aria-label={t("Close notifications")}
                  title={t("Close")}
                  className={`grid h-7 w-7 place-items-center rounded-[4px] text-[var(--shell-text-muted)] transition-colors hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)] ${FOCUS}`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1 border-b border-[color:var(--shell-border)] px-2 py-1.5">
              <button
                type="button"
                aria-pressed={activeView === 'notifications'}
                className={`${VIEW_CHIP} ${
                  activeView === 'notifications'
                    ? 'shell-selected'
                    : 'text-[var(--shell-text-muted)] hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)]'
                }`}
                onClick={() => setActiveView('notifications')}
              >
                {t("Notifications")}
                {notifications.length > 0 && <span className="ml-1.5 font-mono text-[10px] tabular-nums opacity-80">{notifications.length}</span>}
              </button>
              <button
                type="button"
                aria-pressed={activeView === 'activity'}
                className={`${VIEW_CHIP} ${
                  activeView === 'activity'
                    ? 'shell-selected'
                    : 'text-[var(--shell-text-muted)] hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)]'
                }`}
                onClick={() => setActiveView('activity')}
              >
                {t("Activity")}
                {activityEvents.length > 0 && <span className="ml-1.5 font-mono text-[10px] tabular-nums opacity-80">{activityEvents.length}</span>}
              </button>
            </div>

            {/* Notifications List */}
            {activeView === 'notifications' ? (
              <ScrollArea className="min-h-0 flex-1">
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3 px-6 py-10">
                    <div className="flex h-10 w-10 items-center justify-center rounded-[6px] border border-[color:var(--shell-border)] bg-[var(--shell-well)]">
                      <Activity className="h-5 w-5 text-[var(--shell-text-label)]" />
                    </div>
                    <p className="text-[13px] text-[var(--shell-text-muted)]">{t("No notifications")}</p>
                    <p className="text-[12px] text-[var(--shell-text-label)]">{t("You're all caught up")}</p>
                  </div>
                ) : (
                  <div
                    className="divide-y divide-[color:var(--shell-hairline)]"
                    /*
                     * The run finished, the part failed, a decision came back -
                     * none of that reached a screen reader. The list is the
                     * product's record of what happened to a job, so it is a
                     * live region: a new entry is announced instead of arriving
                     * silently in a panel nobody had open.
                     */
                    role="log"
                    aria-live="polite"
                    aria-label={t("Notifications")}
                  >
                    <AnimatePresence>
                      {notifications.map(n => (
                        <NotificationItem
                          key={n.id}
                          notification={n}
                          onMarkRead={onMarkRead}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </ScrollArea>
            ) : (
              <div className="min-h-0 flex-1 overflow-hidden">
                <JobActivityFeed
                  events={activityEvents}
                  onClear={onClearActivity}
                  onEventClick={(event) => {
                    onActivityClick?.(event)
                    setIsOpen(false)
                  }}
                  showHeader={false}
                />
              </div>
            )}
          </motion.aside>
          </>
        )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  )
}
