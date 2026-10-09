import './controls.css';

export function Button({ variant = 'secondary', size = 'standard', className = '', type = 'button', ...props }) {
  return <button type={type} className={`ui-button ui-button--${variant} ui-button--${size} ${className}`} {...props} />;
}

export function Panel({ as: Element = 'section', className = '', ...props }) {
  return <Element className={`ui-panel ${className}`} {...props} />;
}

export function Input({ className = '', ...props }) {
  return <input className={`ui-input ${className}`} {...props} />;
}

export function Badge({ tone = 'neutral', className = '', ...props }) {
  return <span className={`ui-badge ui-badge--${tone} ${className}`} {...props} />;
}

export function SegmentedControl({ label, value, options, onChange, className = '' }) {
  return (
    <div role="group" aria-label={label} className={`ui-segmented ${className}`}>
      {options.map(option => (
        <Button key={option.value} size="compact" variant="quiet" aria-pressed={value === option.value}
          disabled={option.disabled} onClick={() => onChange(option.value)} title={option.description}>
          {option.label}
        </Button>
      ))}
    </div>
  );
}
