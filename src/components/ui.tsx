import { forwardRef, useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Loader2, Search, X, AlertTriangle, type LucideIcon } from 'lucide-react'
import { initials } from '@/lib/format'
import { BUCKETS, signedUrl } from '@/lib/supabase'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'whatsapp'
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-ink hover:bg-brand-hover font-semibold',
  secondary: 'bg-ink-700 text-white border border-ink-600 hover:border-ink-500 hover:bg-ink-600',
  ghost: 'text-muted hover:text-white hover:bg-ink-700',
  danger: 'bg-bad/15 text-bad border border-bad/30 hover:bg-bad/25',
  whatsapp: 'bg-wa text-ink hover:brightness-110 font-semibold',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
  icon?: LucideIcon
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon: Icon, loading, className, children, disabled, ...rest },
  ref,
) {
  const sizes = { sm: 'h-9 px-3 text-sm gap-1.5', md: 'h-11 px-4 text-sm gap-2', lg: 'h-14 px-6 text-base gap-2' }
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center rounded-xl transition select-none whitespace-nowrap',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANTS[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
      {children}
    </button>
  )
})

export function IconButton({ icon: Icon, label, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx('inline-flex h-10 w-10 items-center justify-center rounded-xl text-muted hover:bg-ink-700 hover:text-white transition', className)}
      {...rest}
    >
      <Icon className="h-5 w-5" />
    </button>
  )
}

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('rounded-2xl border border-ink-600 bg-ink-800', className)} {...rest}>
      {children}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide leading-none">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-bad">{error}</span> : hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  )
}

const inputBase =
  'w-full rounded-xl border border-ink-600 bg-ink-900 px-3.5 text-[15px] text-white placeholder:text-ink-500 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand transition'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(inputBase, 'h-11', className)} {...rest} />
})

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(inputBase, 'py-2.5 min-h-[84px]', className)} {...rest} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(inputBase, 'h-11 pr-8 appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat', className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23A3A3A3' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
      {...rest}>
      {children}
    </select>
  )
}

export function SearchInput({ value, onChange, placeholder = 'Buscar…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cx('relative', className)}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-10 pr-9" type="search" />
      {value && (
        <button onClick={() => onChange('')} aria-label="Limpiar búsqueda" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted hover:text-white">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral' | 'brand'
const TONES: Record<Tone, string> = {
  ok: 'bg-ok/15 text-ok border-ok/30',
  warn: 'bg-warn/15 text-warn border-warn/30',
  bad: 'bg-bad/15 text-bad border-bad/30',
  info: 'bg-info/15 text-info border-info/30',
  neutral: 'bg-ink-700 text-muted border-ink-600',
  brand: 'bg-brand-dim text-brand border-brand/30',
}
export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide whitespace-nowrap', TONES[tone], className)}>
      {children}
    </span>
  )
}

export const feeTone = (s: string): Tone =>
  s === 'pagado' || s === 'al_corriente' ? 'ok' : s === 'vencido' ? 'bad' : s === 'parcial' ? 'warn' : 'info'

export function Spinner({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-muted" role="status">
      <Loader2 className="h-5 w-5 animate-spin text-brand" />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function Empty({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 rounded-2xl bg-ink-700 p-3.5">
        <Icon className="h-6 w-6 text-muted" />
      </div>
      <p className="font-semibold">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-muted">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Card className="border-bad/40 p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-bad" />
        <div className="min-w-0">
          <p className="font-semibold">No se pudo cargar la información</p>
          <p className="mt-1 text-sm text-muted break-words">{(error as Error)?.message ?? String(error)}</p>
          {onRetry && <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>Reintentar</Button>}
        </div>
      </div>
    </Card>
  )
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className={cx('relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl border border-ink-600 bg-ink-800 shadow-2xl sm:rounded-3xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="flex items-center justify-between gap-3 border-b border-ink-600 px-5 py-4">
          <h2 className="font-display text-xl font-bold uppercase tracking-wide">{title}</h2>
          <IconButton icon={X} label="Cerrar" onClick={onClose} />
        </div>
        <div className="overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-ink-600 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  )
}

export function ConfirmDialog({ open, title, text, confirmLabel = 'Confirmar', danger, loading, onConfirm, onClose }: { open: boolean; title: string; text: ReactNode; confirmLabel?: string; danger?: boolean; loading?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
      </>}>
      <div className="text-sm text-muted">{text}</div>
    </Modal>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; icon?: LucideIcon }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="tablist">
      <div className="flex min-w-max gap-1 border-b border-ink-600">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} role="tab" aria-selected={value === id} onClick={() => onChange(id)}
            className={cx('flex items-center gap-2 border-b-2 px-3.5 py-3 text-sm font-medium transition -mb-px',
              value === id ? 'border-brand text-white' : 'border-transparent text-muted hover:text-white')}>
            {Icon && <Icon className="h-4 w-4" />}
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl border border-ink-600 bg-ink-900 p-1">
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)}
          className={cx('rounded-lg px-3 py-1.5 text-sm font-medium transition', value === o.id ? 'bg-brand text-ink' : 'text-muted hover:text-white')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function StatCard({ label, value, icon: Icon, hint, tone, onClick }: { label: string; value: ReactNode; icon: LucideIcon; hint?: ReactNode; tone?: 'brand' | 'bad' | 'ok'; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag onClick={onClick} className={cx('group rounded-2xl border border-ink-600 bg-ink-800 p-4 text-left transition', onClick && 'hover:border-ink-500 hover:bg-ink-700')}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted">{label}</p>
        <Icon className={cx('h-5 w-5', tone === 'bad' ? 'text-bad' : tone === 'ok' ? 'text-ok' : 'text-brand')} />
      </div>
      <p className={cx('mt-2 font-display text-3xl font-bold leading-none', tone === 'bad' && 'text-bad')}>{value}</p>
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </Tag>
  )
}

export function Avatar({ name, path, size = 40, className }: { name: string; path?: string | null; size?: number; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setUrl(null)
    if (path) signedUrl(BUCKETS.photos, path).then((u) => alive && setUrl(u))
    return () => { alive = false }
  }, [path])
  return (
    <div className={cx('shrink-0 overflow-hidden rounded-full bg-ink-600 flex items-center justify-center font-display font-bold text-brand', className)}
      style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {url ? <img src={url} alt={name} className="h-full w-full object-cover" /> : initials(name)}
    </div>
  )
}

export function Stars({ value, onChange, size = 'md' }: { value: number; onChange?: (v: number) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="flex gap-1" role={onChange ? 'radiogroup' : undefined}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" disabled={!onChange} onClick={() => onChange?.(n)} aria-label={`${n} de 5`}
          className={cx('rounded-lg font-display font-bold transition',
            size === 'sm' ? 'h-7 w-7 text-sm' : 'h-10 w-10 text-lg',
            n <= value ? 'bg-brand text-ink' : 'bg-ink-700 text-muted',
            onChange && 'hover:ring-2 hover:ring-brand/50')}>
          {n}
        </button>
      ))}
    </div>
  )
}
