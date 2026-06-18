'use client'

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
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

// ─── Notification Icon & Color Mapping ─────────────────────────────────────

const NOTIFICATION_CONFIG: Record<NotificationType, { icon: typeof CheckCircle2; color: string; bgColor: string }> = {
  job_completed: { icon: CheckCircle2, color: 'text-lime-400', bgColor: 'bg-lime-500/10' },
  job_review: { icon: AlertTriangle, color: 'text-yellow-300', bgColor: 'bg-yellow-500/10' },
  job_failed: { icon: XCircle, color: 'text-rose-400', bgColor: 'bg-rose-500/10' },
  job_cancelled: { icon: Ban, color: 'text-[var(--app-state-neutral-text)]', bgColor: 'bg-[var(--app-state-neutral-bg)]' },
  parameter_updated: { icon: Settings, color: 'text-[var(--app-accent-text)]', bgColor: 'bg-[var(--app-accent-bg)]' },
  scad_updated: { icon: Code2, color: 'text-amber-400', bgColor: 'bg-amber-500/10' },
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
        className="h-6 text-xs gap-1 text-[var(--app-text-muted)] hover:text-[var(--app-text-secondary)] relative"
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

      {/* Notification Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute right-0 top-8 w-80 linear-surface linear-border rounded-lg linear-shadow-md z-50"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-[color:var(--app-border)]">
              <div className="flex items-center gap-2">
                <Bell className="w-3.5 h-3.5 text-[var(--app-accent-text)]" />
                <span className="text-sm font-medium text-[var(--app-text-secondary)]">Updates</span>
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
                    <CheckCheck className="w-2.5 h-2.5" />Mark all read
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
                Notifications {notifications.length > 0 ? notifications.length : ''}
              </button>
              <button
                className={`h-6 rounded-md px-2 text-[11px] font-medium transition-colors ${
                  activeView === 'activity'
                    ? 'bg-[var(--app-accent-bg)] text-[var(--app-accent-text)]'
                    : 'text-[var(--app-text-muted)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-secondary)]'
                }`}
                onClick={() => setActiveView('activity')}
              >
                Activity {activityEvents.length > 0 ? activityEvents.length : ''}
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
