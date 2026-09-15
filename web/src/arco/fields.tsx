import { Checkbox, Input } from "@arco-design/web-react";
import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
export function TextField({
  name,
  label,
  value = "",
  required,
  placeholder,
  multiline,
  decimal,
}: {
  name: string;
  label: string;
  value?: string | number;
  required?: boolean;
  placeholder?: string;
  multiline?: number;
  decimal?: boolean;
}) {
  const id = useId();
  const attrs = {
    "aria-label": label,
    name,
    id,
    defaultValue: String(value),
    required,
    placeholder,
  };
  return (
    <label className="field arco-field" htmlFor={id}>
      <span>
        {label}
        {required && <em aria-hidden="true"> *</em>}
      </span>
      {multiline ? (
        <Input.TextArea {...attrs} rows={multiline} />
      ) : (
        <Input {...attrs} inputMode={decimal ? "decimal" : undefined} />
      )}
    </label>
  );
}
// These controls deliberately retain native select semantics, including the
// condition/color/material contract and category-triggered dictionary reloads.
export function SelectField({
  name,
  label,
  choices,
  value = "",
  ariaLabel,
}: {
  name: string;
  label: string;
  choices: Record<string, string>;
  value?: string;
  ariaLabel?: string;
}) {
  const id = useId();
  return (
    <label className="field arco-field" htmlFor={id}>
      <span>{label}</span>
      <select
        id={id}
        name={name}
        defaultValue={value}
        aria-label={ariaLabel || label}
      >
        {Object.entries(choices).map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
export function OptionalSection({
  title,
  name,
  children,
}: {
  title: string;
  name: string;
  children: ReactNode;
}) {
  return (
    <details className="studio-card studio-optional" data-section={name}>
      <summary>{title}</summary>
      <div className="studio-optional-body">{children}</div>
    </details>
  );
}

// Arco forwards native attributes to its label. Expose the actual input's
// accessible name and mixed state so pointer, keyboard and assistive tools agree.
export function SelectionBox({
  label,
  id,
  pick,
  checked,
  mixed = false,
  disabled = false,
  onChange,
  children,
}: {
  label: string;
  id?: string;
  pick?: string;
  checked: boolean;
  mixed?: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLLabelElement>(null);
  useLayoutEffect(() => {
    const input = ref.current!.querySelector("input")!;
    input.setAttribute("aria-label", label);
    input.indeterminate = mixed;
    if (id) input.id = id;
    if (pick) input.dataset.pick = pick;
  }, [label, id, pick, mixed]);
  return (
    <Checkbox
      ref={ref}
      checked={checked}
      indeterminate={mixed}
      disabled={disabled}
      onChange={onChange}
    >
      {children}
    </Checkbox>
  );
}
