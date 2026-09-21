// A few line icons, drawn once. Decorative: the label next to them carries the meaning.
const paths: Record<string, string> = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  docs: 'M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M9 13h6M9 17h6',
  search: 'M17.5 11a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0zM20 20l-4.3-4.3',
  collapse: 'M15 6l-6 6 6 6',
  expand: 'M9 6l6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  menu: 'M4 7h16M4 12h16M4 17h16',
  space: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  share: 'M4 13v6a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6M12 15V4M8 8l4-4 4 4',
  history: 'M3 12a9 9 0 1 0 2.6-6.4M3 4v5h5M12 8v4l3 2',
  comment: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 4v-4H6a2 2 0 0 1-2-2z',
}

export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={paths[name]} />
    </svg>
  )
}
