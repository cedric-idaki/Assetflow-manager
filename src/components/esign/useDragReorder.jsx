import React, { useCallback, useEffect, useRef, useState } from "react";
import Icon from "../AppIcon";

// Stable ids for list rows. Reordering with index keys makes React reuse rows by
// position, which drags focus (and any in-flight IME composition) onto whichever
// signatory happens to land there. Module-level counter, not Date.now() — two
// rows added in the same millisecond would collide.
let uidSeq = 0;
export const newRowUid = () => `row_${++uidSeq}`;

// Move one item of `list` from index `from` to index `to`, returning a new array.
export function reorder(list, from, to) {
  if (from === to) return list;
  if (from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Drag-to-reorder for a short vertical list of form rows, where the row's
 * position in the list IS its signing order.
 *
 * Rows wrap <input> elements, so a row is only made draggable while the pointer
 * is held on its grip — marking the whole row draggable up front lets the
 * browser hijack text selection inside those inputs. HTML5 drag is also
 * mouse-only, so ReorderHandle pairs the grip with up/down buttons: those are
 * the path that works on touch (this app also ships as a mobile TWA) and for
 * keyboard users.
 *
 * `setList` is a React state setter; the hook rewrites the array itself.
 */
export default function useDragReorder(setList) {
  const [armed, setArmed] = useState(null);      // row whose grip is held
  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(null);
  const fromRef = useRef(null);

  const move = useCallback((from, to) => setList((prev) => reorder(prev, from, to)), [setList]);

  const reset = useCallback(() => {
    setArmed(null); setDragging(null); setOver(null); fromRef.current = null;
  }, []);

  // Releasing the mouse outside the grip never fires the grip's own onMouseUp,
  // which would leave the row draggable and let a later drag start from its
  // inputs. Disarm on any release while armed.
  useEffect(() => {
    if (armed === null) return undefined;
    const onUp = () => setArmed(null);
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [armed]);

  const rowProps = (i) => ({
    draggable: armed === i,
    onDragStart: (e) => {
      fromRef.current = i;
      setDragging(i);
      e.dataTransfer.effectAllowed = "move";
      // Firefox will not start a drag unless the transfer carries a payload.
      e.dataTransfer.setData("text/plain", String(i));
    },
    onDragEnter: () => { if (fromRef.current !== null) setOver(i); },
    onDragOver: (e) => {
      if (fromRef.current === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    },
    onDrop: (e) => {
      e.preventDefault();
      const from = fromRef.current;
      if (from !== null && from !== i) move(from, i);
      reset();
    },
    onDragEnd: reset,
  });

  const handleProps = (i, count, label) => ({
    label,
    position: i + 1,
    onGrab: () => setArmed(i),
    onRelease: () => setArmed((cur) => (cur === i ? null : cur)),
    onUp: i > 0 ? () => move(i, i - 1) : null,
    onDown: i < count - 1 ? () => move(i, i + 1) : null,
  });

  // Tailwind classes for the row being dragged and the row it would land on.
  const rowClass = (i) =>
    dragging === i ? "opacity-40"
    : (dragging !== null && over === i) ? "ring-2 ring-primary/50 rounded-xl"
    : "";

  return { rowProps, handleProps, rowClass, draggingIndex: dragging };
}

// Grip + up/down cluster. Spread handleProps(i, count, label) onto it.
export function ReorderHandle({ onGrab, onRelease, onUp, onDown, position, label = "signatory" }) {
  const btn = "p-0.5 rounded text-muted-foreground/70 hover:text-foreground hover:bg-muted " +
              "disabled:opacity-25 disabled:hover:bg-transparent disabled:cursor-default transition-colors";
  return (
    <span className="flex items-center gap-0.5 flex-shrink-0">
      <span
        onMouseDown={onGrab}
        onMouseUp={onRelease}
        aria-hidden="true"
        title={`Drag to reorder — ${label} ${position}`}
        className="cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground select-none"
      >
        <Icon name="GripVertical" size={13} color="currentColor" />
      </span>
      <button type="button" onClick={onUp || undefined} disabled={!onUp}
        aria-label={`Move ${label} ${position} earlier`} className={btn}>
        <Icon name="ChevronUp" size={12} color="currentColor" />
      </button>
      <button type="button" onClick={onDown || undefined} disabled={!onDown}
        aria-label={`Move ${label} ${position} later`} className={btn}>
        <Icon name="ChevronDown" size={12} color="currentColor" />
      </button>
    </span>
  );
}
