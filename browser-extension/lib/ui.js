const ICON_PATHS = {
  user: 'M20 21v-2a7 7 0 0 0-14 0v2 M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  logout: 'M9 4H4v16h5 M13 7l5 5-5 5 M8 12h13',
  video: 'm9 7 8 5-8 5Z M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z',
  audio: 'M9 18V5l12-2v13 M9 8l12-2 M9 18a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3Z M21 16a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3Z',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z M14 2v6h6 M8 13h8 M8 17h5',
  magnet: 'M6 3v9a6 6 0 0 0 12 0V3h-4v9a2 2 0 0 1-4 0V3Z M6 7h4 M14 7h4',
  copy: 'M9 9h11v11H9Z M15 5V3H3v12h2',
  download: 'M12 3v12 m-5-5 5 5 5-5 M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
  check: 'm5 12 4 4L19 6',
  refresh: 'M20 7v5h-5 M4 17v-5h5 M6.1 6.1A8 8 0 0 1 20 12 M4 12a8 8 0 0 0 13.9 5.9',
  external: 'M14 3h7v7 M21 3l-9 9 M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z',
  loader: 'M21 12a9 9 0 1 1-9-9',
  chevron: 'm6 9 6 6 6-6',
  sliders: 'M4 7h7 M15 7h5 M4 17h3 M11 17h9 M11 4v6 M7 14v6',
  link: 'm10 13 4-4 M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0 M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
  search: 'M20 20l-4-4 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',
  playlist: 'M4 5h16 M4 10h10 M4 15h7 M16 13l6 4-6 4Z'
}

export function hydrateIcons(root = document) {
  for (const node of root.querySelectorAll('[data-icon]')) node.replaceChildren(icon(node.dataset.icon))
}

export function decorateToggles(root = document) {
  for (const label of root.querySelectorAll('label.check')) {
    if (label.classList.contains('chip-toggle')) continue
    label.classList.add('chip-toggle')
    label.querySelector('input').after(icon('check'))
  }
}

export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value)
  svg.classList.add('ui-icon')
  if (name === 'loader') svg.classList.add('spin')
  const path = document.createElementNS(svg.namespaceURI, 'path')
  path.setAttribute('d', ICON_PATHS[name] || ICON_PATHS.file)
  svg.append(path)
  return svg
}

