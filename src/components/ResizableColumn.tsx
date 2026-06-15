"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";

interface ResizableColumnProps {
  width: number;
  minWidth: number;
  maxWidth: number;
  onWidthChange: (width: number) => void;
  collapsed?: boolean;
  collapsedWidth?: number;
  children: ReactNode;
  className?: string;
}

export function ResizableColumn({
  width,
  minWidth,
  maxWidth,
  onWidthChange,
  collapsed = false,
  collapsedWidth = 44,
  children,
  className = "",
}: ResizableColumnProps) {
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);

  const endDrag = useCallback(() => {
    draggingRef.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    function onMouseMove(event: MouseEvent) {
      if (!draggingRef.current) return;
      const delta = event.clientX - startXRef.current;
      onWidthChange(startWidthRef.current + delta);
    }

    function onMouseUp() {
      if (!draggingRef.current) return;
      endDrag();
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [endDrag, onWidthChange]);

  function startDrag(event: React.MouseEvent) {
    if (collapsed) return;
    event.preventDefault();
    draggingRef.current = true;
    startXRef.current = event.clientX;
    startWidthRef.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  const displayWidth = collapsed ? collapsedWidth : width;

  return (
    <div
      className={`relative flex h-full shrink-0 flex-col ${className}`}
      style={{ width: displayWidth }}
    >
      {children}
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={width}
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
          title="Drag to resize"
          onMouseDown={startDrag}
          className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize touch-none hover:bg-zendesk-green/20 active:bg-zendesk-green/30"
        />
      )}
    </div>
  );
}
