import React from 'react';
export default function Icon({ name, size = 21 }) {
  const paths = {
    today: <><path d="M3 11 12 4l9 7v10H3Z"/><path d="M9 21v-7h6v7"/></>,
    expenses: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
    edit: <><path d="m4 17 13-13 3 3L7 20H4v-3Z"/><path d="m15 6 3 3"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
    close: <path d="M5 5 19 19M19 5 5 19"/>,
    plane: <><path d="m2 10 20-8-8 20-4-8Z"/><path d="m10 14 12-12"/></>,
    check: <path d="m4 12 5 5L20 6"/>,
    settings: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/></>,
    trash: <><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9ZM10 21h4"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
