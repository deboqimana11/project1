import { cloneElement } from 'react'

import { ToastProvider, ToastViewport, Toast, ToastClose, ToastTitle, ToastDescription } from '@/components/ui/toast'
import type { ToastProps } from '@/components/ui/toast'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Sparkles, type LucideIcon } from 'lucide-react'

type ToastVariant = NonNullable<ToastProps['variant']>

const iconByVariant: Record<ToastVariant, LucideIcon> = {
  default: Sparkles,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  destructive: AlertCircle
}

const accentByVariant: Record<ToastVariant, string> = {
  default: 'bg-accent-2',
  info: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-danger'
}

const iconColorByVariant: Record<ToastVariant, string> = {
  default: 'text-accent',
  info: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-danger'
}

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider duration={5000} swipeDirection="right" label="Notifications">
      {toasts.map(({ id, title, description, action, variant, ...props }) => {
        const toastVariant = (variant ?? 'default') as ToastVariant
        const Icon = iconByVariant[toastVariant] ?? Sparkles
        const accentClass = accentByVariant[toastVariant] ?? accentByVariant.default
        const iconTone = iconColorByVariant[toastVariant] ?? iconColorByVariant.default
        const enhancedAction = action
          ? cloneElement(action, {
              className: cn('mt-3 self-start', (action.props as { className?: string }).className)
            })
          : null

        return (
          <Toast key={id} variant={toastVariant} {...props}>
            <span className={cn('pointer-events-none absolute inset-y-2 left-0 w-1 rounded-full', accentClass)} aria-hidden />
            <div className="flex flex-1 items-start gap-3">
              <div className={cn('mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-surface text-text shadow-soft/40', iconTone)}>
                <Icon className="h-4 w-4" aria-hidden />
              </div>
              <div className="grid flex-1 gap-1 pr-6">
                {title ? <ToastTitle>{title}</ToastTitle> : null}
                {description ? <ToastDescription>{description}</ToastDescription> : null}
                {enhancedAction}
              </div>
            </div>
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
