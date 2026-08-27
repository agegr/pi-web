import React, { useState, useEffect, useRef, type ReactNode, type ReactElement } from 'react'

export interface IconProps {
  size?: number | string
  className?: string
  style?: React.CSSProperties
  onClick?: (e: React.MouseEvent) => void
}

export type PropsRuntime<T = any> = any

export async function writeClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  }
  return false
}

export function StateDot({ state = 'idle', className = '', size = 6 }: { state?: string; className?: string; size?: number }) {
  const color = state === 'running' ? '#10b981' : state === 'error' ? '#ef4444' : '#9ca3af'
  return (
    <span
      className={className}
      style={{
        display: 'inline-block',
        width: `${size}px`, height: `${size}px`,
        borderRadius: '50%',
        backgroundColor: color,
      }}
    />
  )
}

export function Tooltip({
  title,
  label,
  children,
  placement = 'top',
  side,
  delayMs = 300,
}: {
  title?: ReactNode
  label?: ReactNode
  children: ReactElement
  placement?: 'top' | 'bottom' | 'left' | 'right'
  side?: 'top' | 'bottom' | 'left' | 'right'
  delayMs?: number
  [key: string]: any
}) {
  const displayTitle = title ?? label
  const effectivePlacement = side ?? placement
  const [visible, setVisible] = useState(false)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => setVisible(true), delayMs)
  }

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setVisible(false)
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  if (!displayTitle) return children

  return (
    <div
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {visible && (
        <div
          style={{
            position: 'absolute',
            zIndex: 99999,
            padding: '4px 8px',
            fontSize: '11px',
            lineHeight: '1.2',
            color: '#fff',
            backgroundColor: 'rgba(20, 20, 20, 0.92)',
            borderRadius: '4px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            ...(effectivePlacement === 'top'
              ? { bottom: '100%', left: '50%', transform: 'translateX(-50%) translateY(-4px)' }
              : effectivePlacement === 'bottom'
              ? { top: '100%', left: '50%', transform: 'translateX(-50%) translateY(4px)' }
              : effectivePlacement === 'left'
              ? { right: '100%', top: '50%', transform: 'translateY(-50%) translateX(-4px)' }
              : { left: '100%', top: '50%', transform: 'translateY(-50%) translateX(4px)' }),
          }}
        >
          {displayTitle}
        </div>
      )}
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  children,
  width = 480,
  className = '',
  closeLabel,
}: {
  open: boolean
  onClose?: () => void
  title?: ReactNode
  description?: ReactNode
  footer?: ReactNode
  children?: ReactNode
  width?: number | string
  className?: string
  closeLabel?: string
  [key: string]: any
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open && onClose) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(2px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) onClose()
      }}
    >
      <div
        className={className}
        style={{
          width,
          maxWidth: '90vw',
          maxHeight: '85vh',
          backgroundColor: 'var(--bg, #ffffff)',
          color: 'var(--text, #111827)',
          border: '1px solid var(--border, #e5e7eb)',
          borderRadius: '8px',
          boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {title && (
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--border, #e5e7eb)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontWeight: 600,
              fontSize: '14px',
            }}
          >
            <div>
              <div>{title}</div>
              {description && (
                <div style={{ fontSize: '12px', fontWeight: 400, color: 'var(--text-muted, #6b7280)', marginTop: '2px' }}>
                  {description}
                </div>
              )}
            </div>
            {onClose && (
              <button
                onClick={onClose}
                aria-label={closeLabel ?? 'Close'}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '16px',
                  color: 'var(--text-muted, #6b7280)',
                }}
              >
                ✕
              </button>
            )}
          </div>
        )}
        <div style={{ padding: '16px', overflowY: 'auto', flex: 1 }}>{children}</div>
        {footer && (
          <div
            style={{
              padding: '10px 16px',
              borderTop: '1px solid var(--border, #e5e7eb)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '8px',
              backgroundColor: 'var(--bg-panel, #f9fafb)',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export type MenuItem = {
  id?: string
  key?: string
  label?: ReactNode
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  onClick?: () => void
  submenu?: MenuEntry[]
  type?: 'separator' | 'divider'
  [key: string]: any
}

export type MenuEntry = MenuItem

export function Menu({
  open,
  onClose,
  items,
  onSelect,
  anchor,
  getAnchorRect,
  x,
  y,
  selectedId,
  selectedIds,
  ...rest
}: {
  open: boolean
  onClose: () => void
  items: MenuEntry[]
  onSelect?: (id: string) => void
  anchor?: any
  getAnchorRect?: () => DOMRect | null
  x?: number
  y?: number
  selectedId?: string
  selectedIds?: string[]
  [key: string]: any
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [activeSubmenuIndex, setActiveSubmenuIndex] = useState<number | null>(null)

  let calculatedX = x
  let calculatedY = y

  if (calculatedX === undefined || calculatedY === undefined) {
    const rect = getAnchorRect?.() ?? (anchor instanceof Element ? anchor.getBoundingClientRect() : null)
    if (rect) {
      calculatedX = rect.left
      calculatedY = rect.bottom + 4
    }
  }

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleOutside)
    }
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: calculatedX !== undefined ? Math.min(calculatedX, (typeof window !== 'undefined' ? window.innerWidth : 1000) - 200) : 0,
        top: calculatedY !== undefined ? Math.min(calculatedY, (typeof window !== 'undefined' ? window.innerHeight : 800) - 300) : 0,
        zIndex: 99999,
        minWidth: '170px',
        backgroundColor: 'var(--bg-panel, #ffffff)',
        color: 'var(--text, #111827)',
        border: '1px solid var(--border, #e5e7eb)',
        borderRadius: '6px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        padding: '4px 0',
        fontSize: '13px',
      }}
    >
      {items.map((item, idx) => {
        if (item.type === 'separator' || item.type === 'divider') {
          return (
            <div
              key={`sep-${idx}`}
              style={{
                height: '1px',
                backgroundColor: 'var(--border, #e5e7eb)',
                margin: '4px 0',
              }}
            />
          )
        }
        const itemId = item.id || item.key || `item-${idx}`
        const hasSubmenu = Array.isArray(item.submenu) && item.submenu.length > 0
        const isSelected = selectedId === itemId || (Array.isArray(selectedIds) && selectedIds.includes(itemId))

        return (
          <div
            key={itemId}
            style={{
              position: 'relative',
              padding: '6px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              cursor: item.disabled ? 'not-allowed' : 'pointer',
              opacity: item.disabled ? 0.5 : 1,
              color: item.danger ? '#ef4444' : 'inherit',
              backgroundColor: isSelected ? 'var(--bg-selected, #e5e7eb)' : 'transparent',
            }}
            onClick={() => {
              if (!item.disabled && !hasSubmenu) {
                item.onClick?.()
                onSelect?.(itemId)
                onClose()
              }
            }}
            onMouseEnter={(e) => {
              if (!item.disabled) {
                e.currentTarget.style.backgroundColor = isSelected ? 'var(--bg-selected, #e5e7eb)' : 'var(--bg-hover, #f3f4f6)'
                if (hasSubmenu) setActiveSubmenuIndex(idx)
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = isSelected ? 'var(--bg-selected, #e5e7eb)' : 'transparent'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {item.icon && <span>{item.icon}</span>}
              <span>{item.label}</span>
            </div>
            {hasSubmenu && <span style={{ fontSize: '10px', opacity: 0.6 }}>▶</span>}

            {hasSubmenu && activeSubmenuIndex === idx && (
              <div
                style={{
                  position: 'absolute',
                  left: '100%',
                  top: '-4px',
                  minWidth: '160px',
                  backgroundColor: 'var(--bg-panel, #ffffff)',
                  color: 'var(--text, #111827)',
                  border: '1px solid var(--border, #e5e7eb)',
                  borderRadius: '6px',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
                  padding: '4px 0',
                }}
              >
                {item.submenu!.map((sub, subIdx) => {
                  const subId = sub.id || sub.key || `sub-${subIdx}`
                  return (
                    <div
                      key={subId}
                      style={{
                        padding: '6px 12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        cursor: sub.disabled ? 'not-allowed' : 'pointer',
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (!sub.disabled) {
                          sub.onClick?.()
                          onSelect?.(subId)
                          onClose()
                        }
                      }}
                      onMouseEnter={(e) => {
                        if (!sub.disabled) e.currentTarget.style.backgroundColor = 'var(--bg-hover, #f3f4f6)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent'
                      }}
                    >
                      {sub.icon && <span>{sub.icon}</span>}
                      <span>{sub.label}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function Button({
  children,
  onClick,
  disabled,
  className = '',
  style,
  type = 'button',
  variant,
  size,
  ...rest
}: any) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`px-2.5 py-1 text-xs rounded border border-[var(--border)] bg-[var(--bg-panel)] hover:bg-[var(--bg-hover)] text-[var(--text)] transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      style={style}
      {...rest}
    >
      {children}
    </button>
  )
}

export const Input = React.forwardRef<HTMLInputElement, any>(function Input(
  { className = '', style, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={`px-2 py-1 text-xs rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)] transition ${className}`}
      style={style}
      {...props}
    />
  )
})

export function MarkdownText({ content, text, codeLabels }: { content?: string; text?: string; codeLabels?: any }) {
  const display = content ?? text ?? ''
  return (
    <div className="prose dark:prose-invert max-w-none text-sm whitespace-pre-wrap">
      {display}
    </div>
  )
}

// Icons
export const IconCloseFill14 = ({ size = 14, className, style, onClick }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} onClick={onClick}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

export const IconCloseOutline16 = ({ size = 16, className, style, onClick }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} onClick={onClick}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

export const IconCheckOutline16 = ({ size = 16, className, style, onClick }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} onClick={onClick}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

export const IconRefreshOutline16 = ({ size = 16, className, style, onClick }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} onClick={onClick}>
    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
  </svg>
)

export const IconRefreshOutline14 = ({ size = 14, className, style, onClick }: IconProps) => (
  <IconRefreshOutline16 size={size} className={className} style={style} onClick={onClick} />
)

export const IconFolderOpen16 = ({ size = 16, className, style, onClick }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} onClick={onClick}>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
)

export const IconBranchOutline16 = ({ size = 16, className, style, onClick }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} onClick={onClick}>
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </svg>
)

export const IconCodeOutline16 = ({ size = 16, className, style, onClick }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} onClick={onClick}>
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
)

export const IconNewChatOutline16 = ({ size = 16, className, style, onClick }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} onClick={onClick}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
)

export const IconPanelLeftOutline16 = ({ size = 16, className, style, onClick }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} onClick={onClick}>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <line x1="9" y1="3" x2="9" y2="21" />
  </svg>
)

export const IconThinkOutline16 = ({ size = 16, className, style, onClick }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} onClick={onClick}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
)

export const IconDownloadOutline16 = ({ size = 16, className, style, onClick }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} onClick={onClick}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)

export const IconListPenOutline16 = ({ size = 16, className, style, onClick }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} onClick={onClick}>
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
)

export const IconCopyOutline16 = ({ size = 16, className, style, onClick }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} onClick={onClick}>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
)

export const IconChevronLeftOutline14 = ({ size = 14, className, style, onClick }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} onClick={onClick}>
    <polyline points="15 18 9 12 15 6" />
  </svg>
)

export const IconChevronRightOutline14 = ({ size = 14, className, style, onClick }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} onClick={onClick}>
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

export const IconChevronDownOutline14 = ({ size = 14, className, style, onClick }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} onClick={onClick}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
)

export const IconLinkOutline14 = ({ size = 14, className, style, onClick }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} onClick={onClick}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
)

export const IconLinkOutline16 = ({ size = 16, className, style, onClick }: IconProps) => (
  <IconLinkOutline14 size={size} className={className} style={style} onClick={onClick} />
)

export const IconWarningOutline16 = ({ size = 16, className, style, onClick }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} onClick={onClick}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
)

export const IconTrashOutline16 = ({ size = 16, className, style, onClick }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} onClick={onClick}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
)

export const IconUploadOutline16 = ({ size = 16, className, style, onClick }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} onClick={onClick}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
)

export const IconPlusOutline16 = ({ size = 16, className, style, onClick }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} onClick={onClick}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

export const IconSettingsOutline16 = ({ size = 16, className, style, onClick }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} onClick={onClick}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

export const IconSendOutline16 = ({ size = 16, className, style, onClick }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} onClick={onClick}>
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
)

export const IconStopFill16 = ({ size = 16, className, style, onClick }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} onClick={onClick}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
  </svg>
)
