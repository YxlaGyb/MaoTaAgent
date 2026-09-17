export function Icon({ d, className = "icon" }: { d: string; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

export const ICON = {
  chat: "M2.5 3.5h11V11h-4.5L6 13.5V11H2.5z M8 5.5v3 M6.5 7h3",
  clock: "M8 4.5V8l2.5 1.5 M13.5 8a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0",
  plug: "M6 2.5v3 M10 2.5v3 M3.5 5.5h9V8a4.5 4.5 0 0 1-9 0z M8 12.5v1",
  folder: "M2.5 4h4l1.5 1.5h5.5V12h-11z",
  plus: "M8 3.5v9 M3.5 8h9",
  sliders: "M2.5 5.5h11 M2.5 10.5h11 M4.5 5.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0 M8.5 10.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0",
  bulb: "M8 2.5a3.5 3.5 0 0 0-2 6.4v1.6h4V8.9A3.5 3.5 0 0 0 8 2.5 M6.5 12.5h3",
  hand: "M5.5 9V4.5a1.25 1.25 0 0 1 2.5 0V8 M8 8V3.75a1.25 1.25 0 0 1 2.5 0V8 M10.5 8V4.75a1.25 1.25 0 0 1 2.5 0V9.5a4 4 0 0 1-4 4h-1a4.5 4.5 0 0 1-3.8-2.1L3.2 9.9a1.1 1.1 0 0 1 1.8-1.2L5.5 9.5",
  shield: "M8 2.5l5 1.6v3.9c0 3-2 5-5 6.5-3-1.5-5-3.5-5-6.5V4.1z M6 8l1.5 1.5L10.5 6.5",
  alert: "M8 3l5.5 9.5h-11z M8 6.5v3 M8 11.2v.01",
  check: "M3.5 8.5l3 3 6-6.5",
  reset: "M13 8a5 5 0 1 1-1.7-3.8 M13.5 2.5v3.2h-3.2",
  chevron: "M4.5 6.5L8 10l3.5-3.5",
  info: "M13.5 8a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0 M8 7.5v4 M8 4.8v.01",
  back: "M12.5 8h-9 M7 4.5L3.5 8L7 11.5",
  search: "M11.5 7.5a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M10.5 10.5l3 3",
};
