import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface CustomSelectOption {
  value: string;
  label: string;
  group?: string;
}

interface CustomSelectProps {
  value: string;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  testId?: string;
  className?: string;
  fullWidth?: boolean;
  disabled?: boolean;
}

interface MenuPos {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
}

/**
 * In-window accessible select component so dropdown menus render inside the
 * protected BrowserWindow DOM rather than as OS-level native <select> popups.
 */
export function CustomSelect({
  value,
  options,
  onChange,
  ariaLabel,
  testId,
  className = '',
  fullWidth = false,
  disabled = false
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const selectedOption = options.find((opt) => opt.value === value);
  const displayLabel = selectedOption?.label ?? value ?? '';

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const card = trigger.closest('.card') as HTMLElement | null;
    const cardRect = card?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    const rect = trigger.getBoundingClientRect();
    const pad = 8;
    const gap = 4;

    const spaceBelow = cardRect.bottom - rect.bottom - pad;
    const spaceAbove = rect.top - cardRect.top - pad;
    const openUpward = spaceBelow < 140 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(96, Math.min(220, openUpward ? spaceAbove - gap : spaceBelow - gap));

    const minWidth = Math.max(rect.width, fullWidth ? rect.width : 150);
    const maxLeft = Math.max(pad, cardRect.width - minWidth - pad);
    const rawLeft = rect.left - cardRect.left;
    const left = Math.min(Math.max(pad, rawLeft), maxLeft);
    const width = Math.min(minWidth, cardRect.width - pad * 2);

    if (openUpward) {
      const bottom = cardRect.bottom - rect.top + gap;
      setMenuPos({ bottom, left, width, maxHeight });
    } else {
      const top = rect.bottom - cardRect.top + gap;
      setMenuPos({ top, left, width, maxHeight });
    }
  }, [fullWidth, options.length]);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const idx = options.findIndex((o) => o.value === value);
    setActiveIndex(idx >= 0 ? idx : 0);

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onResize = () => updatePosition();
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      updatePosition();
    };

    window.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, options, value, updatePosition]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const optEl = menuRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[activeIndex];
    optEl?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const commitSelection = useCallback(
    (nextValue: string) => {
      setOpen(false);
      if (nextValue !== value) {
        onChange(nextValue);
      }
      triggerRef.current?.focus();
    },
    [onChange, value]
  );

  const onTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (!open) {
        setOpen(true);
        return;
      }
      if (e.key === 'ArrowDown') {
        setActiveIndex((prev) => (options.length === 0 ? -1 : (prev + 1) % options.length));
      } else if (e.key === 'ArrowUp') {
        setActiveIndex((prev) => (options.length === 0 ? -1 : (prev - 1 + options.length) % options.length));
      } else if (activeIndex >= 0 && options[activeIndex]) {
        commitSelection(options[activeIndex].value);
      }
    } else if (e.key === 'Home' && open && options.length > 0) {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End' && open && options.length > 0) {
      e.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === 'Tab' && open) {
      setOpen(false);
    }
  };

  const portalContainer =
    (triggerRef.current?.closest('.card') as HTMLElement | null) ?? document.body;

  let lastGroup: string | undefined;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        data-testid={testId}
        data-value={value}
        data-first-value={options[0]?.value ?? ''}
        disabled={disabled}
        className={`custom-select-trigger ${fullWidth ? 'full' : ''} ${open ? 'open' : ''} ${className}`.trim()}
        onClick={() => {
          if (!disabled) setOpen((prev) => !prev);
        }}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="custom-select-label">{displayLabel}</span>
        <svg
          className="custom-select-chevron"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3 4.5L6 7.5L9 4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            data-testid={testId ? `${testId}-menu` : undefined}
            className="custom-select-menu"
            style={{
              ...(menuPos.top !== undefined ? { top: `${menuPos.top}px` } : {}),
              ...(menuPos.bottom !== undefined ? { bottom: `${menuPos.bottom}px` } : {}),
              left: `${menuPos.left}px`,
              width: `${menuPos.width}px`,
              maxHeight: `${menuPos.maxHeight}px`
            }}
            onMouseDown={(e) => {
              // Prevent outside-click handler on .popover from closing Settings when picking a dropdown item.
              e.stopPropagation();
            }}
          >
            {options.map((opt, idx) => {
              const showGroup = opt.group && opt.group !== lastGroup;
              if (opt.group) lastGroup = opt.group;
              const isSelected = opt.value === value;
              const isActive = idx === activeIndex;
              return (
                <div key={`${opt.group ?? 'default'}-${opt.value}-${idx}`}>
                  {showGroup && (
                    <div className="custom-select-group" role="presentation">
                      {opt.group}
                    </div>
                  )}
                  <div
                    role="option"
                    aria-selected={isSelected}
                    data-value={opt.value}
                    data-testid={testId ? `${testId}-option-${opt.value}` : undefined}
                    className={`custom-select-option ${isSelected ? 'selected' : ''} ${isActive ? 'active' : ''}`.trim()}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => commitSelection(opt.value)}
                  >
                    {opt.label}
                  </div>
                </div>
              );
            })}
          </div>,
          portalContainer
        )}
    </>
  );
}
