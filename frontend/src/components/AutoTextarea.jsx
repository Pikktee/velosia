import { useLayoutEffect, useRef, useEffect } from 'react';

// A textarea that grows with its text, so nothing scrolls inside the field — the
// page scrolls instead (the usual pattern on Android). `singleLine` turns it into
// a wrapping one-line input (e.g. the title): no line breaks, Enter just closes
// the keyboard.
export default function AutoTextarea({ value, onChange, singleLine = false, focusAt = null, className = '', onKeyDown, ...rest }) {
  const ref = useRef(null);

  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const border = el.offsetHeight - el.clientHeight;
    el.style.height = `${el.scrollHeight + border}px`;
  };

  useLayoutEffect(fit, [value]);
  // Opened for editing from a preview: focus with the caret where the user tapped
  // (`focusAt` = character offset; beyond the text = at the end).
  useEffect(() => {
    if (focusAt == null || !ref.current) return;
    const el = ref.current;
    el.focus({ preventScroll: true });
    const n = Math.min(Math.max(0, focusAt), el.value.length);
    try { el.setSelectionRange(n, n); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  return (
    <textarea
      ref={ref}
      rows={1}
      className={`${className} autogrow${singleLine ? ' single' : ''}`}
      value={value}
      onChange={(e) => {
        if (singleLine && /[\r\n]/.test(e.target.value)) {
          e.target.value = e.target.value.replace(/[\r\n]+/g, ' ');
        }
        onChange(e);
      }}
      onKeyDown={(e) => {
        if (singleLine && e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
        onKeyDown?.(e);
      }}
      enterKeyHint={singleLine ? 'done' : undefined}
      {...rest}
    />
  );
}
