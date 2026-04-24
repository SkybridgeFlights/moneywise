import type { ReactNode } from 'react'
import {
  AlertTriangle,
  BellRing,
  CircleDollarSign
} from 'lucide-react'

export function SectionCard({
  title,
  subtitle,
  action,
  children
}: {
  title: string
  subtitle: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="section-card">
      <header className="section-header">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}

export function StatCard({
  title,
  value,
  icon: Icon,
  tone,
  subtext
}: {
  title: string
  value: string
  icon: typeof CircleDollarSign
  tone: 'teal' | 'amber' | 'blue' | 'green' | 'rose' | 'slate'
  subtext: string
}) {
  return (
    <div className={`stat-card tone-${tone}`}>
      <div className="stat-icon">
        <Icon size={18} />
      </div>
      <div>
        <span>{title}</span>
        <strong>{value}</strong>
        <small>{subtext}</small>
      </div>
    </div>
  )
}

export function Badge({ label, color }: { label: string; color?: string }) {
  return (
    <span className="badge" style={color ? { borderColor: `${color}40`, color, backgroundColor: `${color}15` } : undefined}>
      {label}
    </span>
  )
}

export function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export function MetricTile({ label, value, icon: Icon }: { label: string; value: string; icon: typeof CircleDollarSign }) {
  return (
    <div className="metric-tile">
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export function EmptyState({ icon: Icon, title, description }: { icon: typeof BellRing; title: string; description: string }) {
  return (
    <div className="empty-state">
      <Icon size={20} />
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  )
}

export function RiskChip({ level, label }: { level: 'low' | 'moderate' | 'high'; label?: string }) {
  return <div className={`risk-chip risk-${level}`}>{label ?? `Risk: ${level}`}</div>
}

export function InputField({
  label,
  value,
  onChange,
  type = 'text',
  hint,
  error
}: {
  label: string
  value: string | number
  onChange: (value: string) => void
  type?: string
  hint?: string
  error?: string
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={type === 'number' ? 'text' : type}
        inputMode={type === 'number' ? 'decimal' : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
      />
      {error ? <small className="field-error"><AlertTriangle size={12} /> {error}</small> : hint ? <small className="field-hint">{hint}</small> : null}
    </label>
  )
}

export function TextAreaField({
  label,
  value,
  onChange,
  hint,
  error
}: {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
  error?: string
}) {
  return (
    <label className="field field-span-2">
      <span>{label}</span>
      <textarea rows={3} value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} />
      {error ? <small className="field-error"><AlertTriangle size={12} /> {error}</small> : hint ? <small className="field-hint">{hint}</small> : null}
    </label>
  )
}

export function SelectField({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: string
  options: Array<{ label: string; value: string }>
  onChange: (value: string) => void
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="toggle-field">
      <span>{label}</span>
      <button type="button" className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
        <span />
      </button>
    </label>
  )
}

export function ScreenSkeleton() {
  return (
    <div className="screen-grid">
      <div className="skeleton-card skeleton-hero" />
      <div className="skeleton-grid">
        <div className="skeleton-card" />
        <div className="skeleton-card" />
        <div className="skeleton-card" />
      </div>
      <div className="skeleton-card skeleton-chart" />
    </div>
  )
}
