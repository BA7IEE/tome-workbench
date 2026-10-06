import {
  useEffect,
  useLayoutEffect,
  useRef,
  useId,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "./components";

/** Contextual actions remain visible at narrow widths and cooperate with native dialogs. */
export function CommandMenu({
  label,
  open,
  onOpenChange,
  children,
}: {
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const popupId = useId();
  const keyboard = useRef(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!anchor.current || !popup.current) return;
      const rect = anchor.current.getBoundingClientRect();
      const bounds = popup.current.getBoundingClientRect();
      const top =
        rect.bottom + 6 + bounds.height <= innerHeight - 8
          ? rect.bottom + 6
          : Math.max(8, rect.top - bounds.height - 6);
      setPosition({
        top,
        left: Math.max(
          8,
          Math.min(rect.right - bounds.width, innerWidth - bounds.width - 8),
        ),
      });
    };
    place();
    if (keyboard.current)
      popup.current
        ?.querySelector<HTMLElement>("button, a")
        ?.focus({ preventScroll: true });
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!anchor.current?.contains(target) && !popup.current?.contains(target))
        onOpenChange(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onOpenChange(false);
      anchor.current?.querySelector("button")?.focus();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
    };
  }, [open, onOpenChange]);
  return (
    <>
      <span ref={anchor}>
        <Button
          className="catalog-row-menu"
          type="text"
          aria-label={label}
          aria-controls={popupId}
          aria-expanded={open}
          onClick={(event) => {
            keyboard.current = event.detail === 0;
            onOpenChange(!open);
          }}
        >
          •••
        </Button>
      </span>
      {open &&
        createPortal(
          <div
            ref={popup}
            id={popupId}
            role="group"
            aria-label={label.replace(/更多操作$/, "操作菜单")}
            className="foundation-command-popup"
            style={position}
            onClickCapture={(event) => {
              // Restore a connected trigger before a domain action opens its native dialog.
              if ((event.target as Element).closest("button, a"))
                anchor.current
                  ?.querySelector("button")
                  ?.focus({ preventScroll: true });
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
