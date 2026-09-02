import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

type MenuProps = {
  label: ComponentChildren;
  title: string;
  align?: "left" | "right";
  children: ComponentChildren;
};

/**
 * Panels the owner controls used to occupy a permanent column; here they cost
 * one button until asked for.
 */
export function Menu({ label, title, align = "right", children }: MenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div class="menu" ref={ref}>
      <button
        type="button"
        class={`menu-trigger${open ? " open" : ""}`}
        title={title}
        aria-label={title}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>
      {open ? <div class={`menu-panel menu-${align}`}>{children}</div> : null}
    </div>
  );
}

type ModalProps = {
  title: string;
  children: ComponentChildren;
  onClose: () => void;
};

export function Modal({ title, children, onClose }: ModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div class="modal-backdrop" onMouseDown={onClose}>
      <div
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
