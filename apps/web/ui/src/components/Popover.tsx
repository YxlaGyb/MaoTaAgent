import { useEffect, useRef, type ReactNode } from "react";

export function Popover({
  label,
  title,
  className,
  align = "start",
  open,
  disabled,
  onToggle,
  onClose,
  children,
}: {
  label: ReactNode;
  title: string;
  className?: string;
  align?: "start" | "end";
  open: boolean;
  disabled?: boolean;
  onToggle: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const down = (event: MouseEvent): void => {
      if (box.current !== null && !box.current.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open, onClose]);

  return (
    <div className={`popover-anchor ${className ?? ""}`.trim()} ref={box}>
      <button
        type="button"
        className="popover-trigger"
        title={title}
        aria-label={title}
        aria-expanded={open}
        disabled={disabled === true}
        onClick={onToggle}
      >
        {label}
      </button>
      {open ? <div className={`popover-panel${align === "end" ? " is-end" : ""}`}>{children}</div> : null}
    </div>
  );
}
