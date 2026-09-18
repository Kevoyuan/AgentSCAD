'use client'

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

// ─── Notification Icon & Color Mapping ─────────────────────────────────────

const NOTIFICATION_CONFIG: Record<NotificationType, { icon: typeof CheckCircle2; color: string; bgColor: string }> = {
  /* Semantic colours from the palette, never Tailwind steps (DESIGN.md section 11). */
  job_completed: { icon: CheckCircle2, color: 'text-[var(--shell-ok)]', bgColor: 'bg-transparent' },
  job_review: { icon: AlertTriangle, color: 'text-[var(--shell-warn)]', bgColor: 'bg-transparent' },
  job_failed: { icon: XCircle, color: 'text-[var(--shell-fail)]', bgColor: 'bg-transparent' },
  job_cancelled: { icon: Ban, color: 'text-[var(--shell-text-label)]', bgColor: 'bg-transparent' },
  parameter_updated: { icon: Settings, color: 'text-[var(--shell-signal-soft)]', bgColor: 'bg-transparent' },
  scad_updated: { icon: Code2, color: 'text-[var(--shell-signal-soft)]', bgColor: 'bg-transparent' },
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
  const config = NOTIFICATION_CONFIG[notification.type]
  const Icon = config.icon

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={`flex items-start gap-2.5 px-3 py-2.5 cursor-pointer linear-transition hover:bg-[var(--app-hover-subtle)] ${
        !notification.read ? 'border-l-2 border-l-[color:var(--app-accent)]' : 'border-l-2 border-l-transparent'
      }`}
      onClick={() => {
        if (!notification.read) onMarkRead(notification.id)
      }}
    >
      <div className={`shrink-0 w-6 h-6 rounded-md flex items-center justify-center ${config.bgColor}`}>
        <Icon className={`w-3.5 h-3.5 ${config.color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm leading-tight ${notification.read ? 'text-[var(--app-text-muted)]' : 'text-[var(--app-text-secondary)]'}`}>
          {notification.title}
        </p>
        <p className="text-xs text-[var(--app-text-dim)] mt-0.5 truncate">{notification.description}</p>
        <p className="text-[8px] text-[var(--app-text-dim)] mt-1 font-mono">{notifTimeAgo(notification.timestamp)}</p>
      </div>
      {!notification.read && (
        <div className="shrink-0 w-1.5 h-1.5 rounded-full bg-[var(--app-accent)] mt-1.5" />
      )}
    </motion.div>
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
        aria-label={unreadCount > 0 ? `通知，${unreadCount} 条未读` : '通知'}
        title="通知"
        className="h-6 w-6 p-0 rounded-[4px] text-[var(--shell-text-dim)] hover:text-[var(--shell-text)] hover:bg-[var(--shell-hover)] relative"
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
            className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] rounded-full bg-rose-500 text-white text-[7px] font-bold flex items-center justify-center px-0.5"
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
            aria-label="通知"
            initial={{ x: 28, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 28, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="fixed right-0 top-0 bottom-0 z-[60] flex w-[368px] max-w-[86vw] flex-col bg-[var(--shell-module-solid)]/97 backdrop-blur-2xl border-l border-[color:var(--shell-border)] shadow-[-24px_0_48px_-12px_rgba(0,0,0,0.7)]"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-[color:var(--app-border)]">
              <div className="flex items-center gap-2">
                <Bell className="w-3.5 h-3.5 text-[var(--app-accent-text)]" />
                <span className="text-sm font-medium text-[var(--app-text-secondary)]">通知</span>
                {unreadCount > 0 && (
                  <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full bg-[var(--app-accent-bg)] text-[var(--app-accent-text)] border border-[color:var(--app-accent-border)]">
                    {unreadCount} new
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 text-[8px] gap-0.5 text-[var(--app-accent-text)] hover:text-[var(--app-accent-text)] px-1"
                    onClick={onMarkAllRead}
                  >
                    <CheckCheck className="w-2.5 h-2.5" />全部已读
                  </Button>
                )}
                {notifications.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 text-[8px] gap-0.5 text-[var(--app-text-muted)] hover:text-[var(--app-text-muted)] px-1"
                    onClick={onClearAll}
                  >
                    <Trash2 className="w-2.5 h-2.5" />Clear
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 text-[8px] text-[var(--app-text-dim)] hover:text-[var(--app-text-muted)] px-0.5"
                  onClick={() => setIsOpen(false)}
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-1 border-b border-[color:var(--app-border)] px-2 py-1.5">
              <button
                className={`h-6 rounded-md px-2 text-[11px] font-medium transition-colors ${
                  activeView === 'notifications'
                    ? 'bg-[var(--app-accent-bg)] text-[var(--app-accent-text)]'
                    : 'text-[var(--app-text-muted)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-secondary)]'
                }`}
                onClick={() => setActiveView('notifications')}
              >
                通知 {notifications.length > 0 ? notifications.length : ''}
              </button>
              <button
                className={`h-6 rounded-md px-2 text-[11px] font-medium transition-colors ${
                  activeView === 'activity'
                    ? 'bg-[var(--app-accent-bg)] text-[var(--app-accent-text)]'
                    : 'text-[var(--app-text-muted)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-secondary)]'
                }`}
                onClick={() => setActiveView('activity')}
              >
                动态 {activityEvents.length > 0 ? activityEvents.length : ''}
              </button>
            </div>

            {/* Notifications List */}
            {activeView === 'notifications' ? (
              <ScrollArea className="max-h-70">
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 gap-3">
                    <div className="w-10 h-10 rounded border border-[color:var(--cad-border-strong)] flex items-center justify-center opacity-40">
                      <Activity className="w-5 h-5 text-[var(--cad-text-muted)]" />
                    </div>
                    <p className="text-sm text-[var(--app-text-dim)]">No notifications</p>
                    <p className="text-xs text-[var(--app-text-dim)]">You&apos;re all caught up</p>
                  </div>
                ) : (
                  <div className="divide-y divide-[color:var(--app-border)]">
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
              <div className="max-h-[420px]">
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
