"use client";

import { forwardRef, useId, type SelectHTMLAttributes } from "react";
import { useFormControlAttributes } from "./form-field-context";

interface SelectOption {
  value: string;
  label: string;
  /** Heading this option sits under. Options with no group stay flat, above the groups. */
  group?: string;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options?: SelectOption[];
  placeholder?: string;
}

/**
 * Options in source order, with each `group` opened once where its first option appears.
 *
 * Grouping by a map keyed on the name would reorder the list to first-seen-group order,
 * which silently moves an option the caller deliberately placed. Ungrouped options render
 * as bare `<option>`s wherever they sit, so every existing caller is byte-identical.
 */
function optionNodes(options: SelectOption[]) {
  const nodes = [];
  for (let index = 0; index < options.length; index += 1) {
    const group = options[index].group;
    if (!group) {
      nodes.push(
        <option key={options[index].value} value={options[index].value}>
          {options[index].label}
        </option>,
      );
      continue;
    }
    const run = [];
    while (index < options.length && options[index].group === group) {
      run.push(options[index]);
      index += 1;
    }
    index -= 1;
    nodes.push(
      <optgroup key={group} label={group}>
        {run.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </optgroup>,
    );
  }
  return nodes;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    options,
    placeholder,
    children,
    className = "",
    id,
    required,
    "aria-describedby": ariaDescribedBy,
    "aria-invalid": ariaInvalid,
    ...props
  },
  ref,
) {
  const generatedId = useId();
  const field = useFormControlAttributes({
    id,
    required,
    describedBy: ariaDescribedBy,
    invalid: ariaInvalid,
  });
  const selectId = field.id ?? (label ? generatedId : undefined);

  return (
    <div>
      {label && (
        <label
          htmlFor={selectId}
          className="mb-2 block text-xs font-medium uppercase tracking-wider text-(--ui-muted)"
        >
          {label}
        </label>
      )}
      <select
        ref={ref}
        id={selectId}
        required={field.required}
        aria-describedby={field.describedBy}
        aria-invalid={field.invalid}
        className={`h-9 w-full rounded-[var(--ui-radius)] border border-(--ui-separator) bg-(--ui-surface) px-3 text-[length:var(--fs-base)] text-(--ui-fg) transition-colors focus:border-(--ui-accent)/60 focus:outline-none focus:ring-1 focus:ring-(--ui-accent)/20 ${className}`}
        {...props}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options ? optionNodes(options) : children}
      </select>
    </div>
  );
});

export { Select };
export type { SelectProps, SelectOption };
