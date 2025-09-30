import { useCallback, useEffect, useMemo, useState } from 'react'

import { toast } from '@/components/ui/use-toast'

const STORAGE_KEY = 'reader.keymap.v1'
const KEYMAP_VERSION = 1

const MODIFIER_ORDER = ['ctrl', 'alt', 'shift', 'meta'] as const
const MODIFIER_LABEL: Record<ModifierKey, string> = {
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  meta: typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? 'Cmd' : 'Meta'
}

const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight'
])

type ModifierKey = (typeof MODIFIER_ORDER)[number]

interface KeyboardTrigger {
  kind: 'keyboard'
  code: string
  modifiers: ModifierKey[]
}

interface MouseTrigger {
  kind: 'mouse'
  button: number
  modifiers: ModifierKey[]
}

type Trigger = KeyboardTrigger | MouseTrigger
export type ActionCategory = 'Navigation' | 'Layout' | 'View' | 'System'

function sortModifiers(modifiers: Iterable<ModifierKey>) {
  const unique = new Set(modifiers)
  return Array.from(unique).sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b))
}

function capitalizeModifier(mod: ModifierKey) {
  return MODIFIER_LABEL[mod]
}

function serializeKeyboardTrigger(code: string, modifiers: ModifierKey[] = []): string {
  const parts = sortModifiers(modifiers)
  const prefix = parts.map(capitalizeModifier)
  prefix.push(code)
  return `keyboard:${prefix.join('+')}`
}

function serializeMouseTrigger(button: number, modifiers: ModifierKey[] = []): string {
  if (!Number.isFinite(button) || button < 0) {
    throw new Error('Invalid mouse button')
  }
  const parts = sortModifiers(modifiers)
  const prefix = parts.map(capitalizeModifier)
  prefix.push(`Button${button}`)
  return `mouse:${prefix.join('+')}`
}

function parseTriggerString(binding: string): Trigger | null {
  if (typeof binding !== 'string') {
    return null
  }
  const [kind, payload] = binding.split(':')
  if (!payload) {
    return null
  }
  const segments = payload.split('+').map((segment) => segment.trim()).filter(Boolean)
  if (segments.length === 0) {
    return null
  }
  const modifiers: ModifierKey[] = []
  for (let i = 0; i < segments.length - 1; i += 1) {
    const value = segments[i].toLowerCase()
    if (value === 'ctrl' || value === 'control') {
      modifiers.push('ctrl')
    } else if (value === 'alt' || value === 'option') {
      modifiers.push('alt')
    } else if (value === 'shift') {
      modifiers.push('shift')
    } else if (value === 'cmd' || value === 'meta' || value === 'command') {
      modifiers.push('meta')
    } else {
      return null
    }
  }
  const last = segments[segments.length - 1]
  if (kind === 'keyboard') {
    return { kind: 'keyboard', code: last, modifiers: sortModifiers(modifiers) }
  }
  if (kind === 'mouse') {
    if (!/^Button\d+$/.test(last)) {
      return null
    }
    const button = Number(last.replace('Button', ''))
    return { kind: 'mouse', button, modifiers: sortModifiers(modifiers) }
  }
  return null
}

function keyboardTriggerFromEvent(event: KeyboardEvent): string | null {
  const code = event.code
  if (!code || MODIFIER_CODES.has(code)) {
    return null
  }
  const modifiers: ModifierKey[] = []
  if (event.ctrlKey) modifiers.push('ctrl')
  if (event.altKey) modifiers.push('alt')
  if (event.shiftKey) modifiers.push('shift')
  if (event.metaKey) modifiers.push('meta')
  return serializeKeyboardTrigger(code, modifiers)
}

function mouseTriggerFromEvent(event: PointerEvent): string | null {
  if (event.button < 0) {
    return null
  }
  const modifiers: ModifierKey[] = []
  if (event.ctrlKey) modifiers.push('ctrl')
  if (event.altKey) modifiers.push('alt')
  if (event.shiftKey) modifiers.push('shift')
  if (event.metaKey) modifiers.push('meta')
  if (event.button === 0 && modifiers.length === 0) {
    return null
  }
  return serializeMouseTrigger(event.button, modifiers)
}

function formatKeyboardCode(code: string) {
  if (code.startsWith('Key')) {
    return code.slice(3).toUpperCase()
  }
  if (code.startsWith('Digit')) {
    return code.slice(5)
  }
  switch (code) {
    case 'ArrowLeft':
      return '←'
    case 'ArrowRight':
      return '→'
    case 'ArrowUp':
      return '↑'
    case 'ArrowDown':
      return '↓'
    case 'Space':
    case 'Spacebar':
      return 'Space'
    case 'Comma':
      return ','
    case 'Period':
      return '.'
    case 'Slash':
      return '/'
    case 'Backslash':
      return '\\'
    case 'BracketLeft':
      return '['
    case 'BracketRight':
      return ']'
    case 'Minus':
      return '-'
    case 'Equal':
      return '='
    case 'Backquote':
      return '`'
    case 'Escape':
      return 'Esc'
    case 'PageUp':
      return 'PageUp'
    case 'PageDown':
      return 'PageDown'
    case 'NumpadAdd':
      return 'Numpad+'
    case 'NumpadSubtract':
      return 'Numpad-'
    case 'NumpadDivide':
      return 'Numpad/'
    case 'NumpadMultiply':
      return 'Numpad*'
    case 'NumpadEnter':
      return 'NumpadEnter'
    default:
      return code
  }
}

function formatMouseButton(button: number) {
  switch (button) {
    case 0:
      return 'Mouse1'
    case 1:
      return 'Mouse2'
    case 2:
      return 'Mouse3'
    case 3:
      return 'Mouse4'
    case 4:
      return 'Mouse5'
    default:
      return `Mouse${button + 1}`
  }
}

export function formatTrigger(binding: string): string {
  const trigger = parseTriggerString(binding)
  if (!trigger) {
    return binding
  }
  if (trigger.kind === 'keyboard') {
    const modifiers = sortModifiers(trigger.modifiers).map(capitalizeModifier)
    const label = formatKeyboardCode(trigger.code)
    return modifiers.length > 0 ? `${modifiers.join('+')}+${label}` : label
  }
  const modifiers = sortModifiers(trigger.modifiers).map(capitalizeModifier)
  const label = formatMouseButton(trigger.button)
  return modifiers.length > 0 ? `${modifiers.join('+')}+${label}` : label
}

const ACTIONS = [
  {
    id: 'reader.page.next',
    label: 'Next page',
    description: 'Advance to the next page or spread.',
    category: 'Navigation',
    defaults: [
      serializeKeyboardTrigger('ArrowRight'),
      serializeKeyboardTrigger('PageDown'),
      serializeMouseTrigger(4)
    ]
  },
  {
    id: 'reader.page.previous',
    label: 'Previous page',
    description: 'Return to the previous page or spread.',
    category: 'Navigation',
    defaults: [
      serializeKeyboardTrigger('ArrowLeft'),
      serializeKeyboardTrigger('PageUp'),
      serializeMouseTrigger(3)
    ]
  },
  {
    id: 'reader.page.first',
    label: 'First page',
    description: 'Jump to the beginning of the book.',
    category: 'Navigation',
    defaults: [serializeKeyboardTrigger('Home')]
  },
  {
    id: 'reader.page.last',
    label: 'Last page',
    description: 'Jump to the final page of the book.',
    category: 'Navigation',
    defaults: [serializeKeyboardTrigger('End')]
  },
  {
    id: 'reader.page.jump',
    label: 'Go to page…',
    description: 'Open the quick jump prompt.',
    category: 'Navigation',
    defaults: [
      serializeKeyboardTrigger('KeyG', ['ctrl']),
      serializeKeyboardTrigger('KeyG', ['meta'])
    ]
  },
  {
    id: 'reader.layout.single',
    label: 'Single page layout',
    description: 'Display one page at a time.',
    category: 'Layout',
    defaults: [serializeKeyboardTrigger('KeyS')]
  },
  {
    id: 'reader.layout.double',
    label: 'Double page layout',
    description: 'Display two pages side by side.',
    category: 'Layout',
    defaults: [serializeKeyboardTrigger('KeyD')]
  },
  {
    id: 'reader.layout.vertical',
    label: 'Continuous scroll layout',
    description: 'Show pages in a vertical scroll strip.',
    category: 'Layout',
    defaults: [serializeKeyboardTrigger('KeyC')]
  },
  {
    id: 'reader.layout.toggle-direction',
    label: 'Toggle reading direction',
    description: 'Swap between left-to-right and right-to-left reading.',
    category: 'Layout',
    defaults: [serializeKeyboardTrigger('KeyL')]
  },
  {
    id: 'reader.fit.original',
    label: 'Original size',
    description: 'View the page at its native resolution.',
    category: 'View',
    defaults: [serializeKeyboardTrigger('Digit1')]
  },
  {
    id: 'reader.fit.width',
    label: 'Fit to width',
    description: 'Scale the page to match the viewport width.',
    category: 'View',
    defaults: [serializeKeyboardTrigger('Digit2')]
  },
  {
    id: 'reader.fit.height',
    label: 'Fit to height',
    description: 'Scale the page to match the viewport height.',
    category: 'View',
    defaults: [serializeKeyboardTrigger('Digit3')]
  },
  {
    id: 'reader.fit.contain',
    label: 'Best fit',
    description: 'Scale the page to fit entirely on screen.',
    category: 'View',
    defaults: [serializeKeyboardTrigger('Digit0')]
  },
  {
    id: 'reader.zoom.in',
    label: 'Zoom in',
    description: 'Increase zoom level.',
    category: 'View',
    defaults: [serializeKeyboardTrigger('Equal'), serializeKeyboardTrigger('NumpadAdd')]
  },
  {
    id: 'reader.zoom.out',
    label: 'Zoom out',
    description: 'Decrease zoom level.',
    category: 'View',
    defaults: [serializeKeyboardTrigger('Minus'), serializeKeyboardTrigger('NumpadSubtract')]
  },
  {
    id: 'reader.zoom.reset',
    label: 'Reset zoom & rotation',
    description: 'Reset the view to defaults.',
    category: 'View',
    defaults: [serializeKeyboardTrigger('Digit9')]
  },
  {
    id: 'reader.rotate.cw',
    label: 'Rotate clockwise',
    description: 'Rotate the current view clockwise.',
    category: 'View',
    defaults: [serializeKeyboardTrigger('KeyR')]
  },
  {
    id: 'reader.rotate.ccw',
    label: 'Rotate counterclockwise',
    description: 'Rotate the current view counterclockwise.',
    category: 'View',
    defaults: [serializeKeyboardTrigger('KeyR', ['shift'])]
  },
  {
    id: 'reader.rotate.reset',
    label: 'Reset rotation',
    description: 'Restore rotation to the default orientation.',
    category: 'View',
    defaults: [serializeKeyboardTrigger('KeyR', ['ctrl'])]
  },
  {
    id: 'reader.command.palette',
    label: 'Command palette',
    description: 'Open or close the command palette.',
    category: 'System',
    defaults: [
      serializeKeyboardTrigger('KeyK', ['ctrl']),
      serializeKeyboardTrigger('KeyK', ['meta'])
    ]
  },
  {
    id: 'reader.settings.open',
    label: 'Reader settings',
    description: 'Open the reader settings sheet.',
    category: 'System',
    defaults: [
      serializeKeyboardTrigger('Comma', ['ctrl']),
      serializeKeyboardTrigger('Comma', ['meta'])
    ]
  },
  {
    id: 'reader.library.open',
    label: 'Open library',
    description: 'Open a library or folder.',
    category: 'System',
    defaults: [
      serializeKeyboardTrigger('KeyO', ['ctrl']),
      serializeKeyboardTrigger('KeyO', ['meta'])
    ]
  },
  {
    id: 'reader.fullscreen.toggle',
    label: 'Toggle fullscreen',
    description: 'Enter or exit fullscreen mode.',
    category: 'System',
    defaults: [serializeKeyboardTrigger('KeyF')]
  },
  {
    id: 'reader.fullscreen.immersive',
    label: 'Immersive mode',
    description: 'Toggle immersive reading chrome.',
    category: 'System',
    defaults: [serializeKeyboardTrigger('KeyF', ['shift'])]
  },
  {
    id: 'reader.bookmark.toggle',
    label: 'Toggle bookmark',
    description: 'Add or remove a bookmark on the current page.',
    category: 'System',
    defaults: [serializeKeyboardTrigger('KeyB')]
  }
]

export type KeymapActionDefinition = (typeof ACTIONS)[number]
export type ActionId = KeymapActionDefinition['id']
export const KEYMAP_ACTIONS: readonly KeymapActionDefinition[] = ACTIONS

export type KeymapBindings = Record<ActionId, string[]>

interface KeymapStorage {
  version: number
  bindings: Partial<Record<ActionId, string[]>>
}

function getDefaultBindings(): KeymapBindings {
  const result = {} as KeymapBindings
  for (const action of ACTIONS) {
    result[action.id] = [...action.defaults]
  }
  return result
}

function sanitizeBindings(input: Partial<Record<ActionId, string[]>> | null | undefined) {
  const next = getDefaultBindings()
  if (!input) {
    return next
  }
  const seen = new Map<string, ActionId>()
  for (const action of ACTIONS) {
    const assigned = input[action.id]
    if (!Array.isArray(assigned)) {
      continue
    }
    const filtered: string[] = []
    for (const raw of assigned) {
      const parsed = parseTriggerString(raw)
      if (!parsed) {
        continue
      }
      const serialized = parsed.kind === 'keyboard'
        ? serializeKeyboardTrigger(parsed.code, parsed.modifiers)
        : serializeMouseTrigger(parsed.button, parsed.modifiers)
      const owner = seen.get(serialized)
      if (owner && owner !== action.id) {
        continue
      }
      seen.set(serialized, action.id)
      filtered.push(serialized)
    }
    if (filtered.length > 0) {
      next[action.id] = filtered
    }
  }
  return next
}

function loadBindings(): KeymapBindings {
  if (typeof window === 'undefined') {
    return getDefaultBindings()
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return getDefaultBindings()
    }
    const parsed = JSON.parse(raw) as KeymapStorage
    if (!parsed || parsed.version !== KEYMAP_VERSION) {
      return getDefaultBindings()
    }
    return sanitizeBindings(parsed.bindings)
  } catch (error) {
    console.warn('[keymap] Failed to load stored keymap', error)
    return getDefaultBindings()
  }
}

function persistBindings(bindings: KeymapBindings) {
  if (typeof window === 'undefined') {
    return
  }
  try {
    const payload: KeymapStorage = { version: KEYMAP_VERSION, bindings }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch (error) {
    console.warn('[keymap] Failed to persist keymap', error)
  }
}

function cloneBindings(source: KeymapBindings) {
  const result = {} as KeymapBindings
  for (const action of ACTIONS) {
    result[action.id] = [...source[action.id]]
  }
  return result
}

export interface BindingChangeError {
  reason: 'conflict' | 'invalid'
  conflictWith?: ActionId
}

export interface ImportResult {
  ok: boolean
  error?: string
}

export interface ReaderKeymap {
  bindings: KeymapBindings
  triggerMap: Map<string, ActionId>
  addBinding: (id: ActionId, trigger: string) => BindingChangeError | null
  replaceBinding: (id: ActionId, previous: string, next: string) => BindingChangeError | null
  removeBinding: (id: ActionId, trigger: string) => void
  resetAction: (id: ActionId) => void
  resetAll: () => void
  exportToString: () => string
  importFromString: (payload: string) => ImportResult
}

function buildTriggerMap(bindings: KeymapBindings) {
  const map = new Map<string, ActionId>()
  for (const action of ACTIONS) {
    for (const trigger of bindings[action.id]) {
      map.set(trigger, action.id)
    }
  }
  return map
}

export function useReaderKeymap(): ReaderKeymap {
  const [bindings, setBindings] = useState<KeymapBindings>(() => loadBindings())

  useEffect(() => {
    persistBindings(bindings)
  }, [bindings])

  const triggerMap = useMemo(() => buildTriggerMap(bindings), [bindings])

  const addBinding = useCallback<ReaderKeymap['addBinding']>((id, trigger) => {
    const parsed = parseTriggerString(trigger)
    if (!parsed) {
      return { reason: 'invalid' }
    }
    const serialized = parsed.kind === 'keyboard'
      ? serializeKeyboardTrigger(parsed.code, parsed.modifiers)
      : serializeMouseTrigger(parsed.button, parsed.modifiers)
    const existingOwner = triggerMap.get(serialized)
    if (existingOwner && existingOwner !== id) {
      return { reason: 'conflict', conflictWith: existingOwner }
    }
    setBindings((prev) => {
      if (prev[id].includes(serialized)) {
        return prev
      }
      const next = cloneBindings(prev)
      next[id] = [...prev[id], serialized]
      return next
    })
    toast({ title: 'Shortcut updated', description: `Mapped to ${formatTrigger(serialized)}.` })
    return null
  }, [triggerMap])

  const replaceBinding = useCallback<ReaderKeymap['replaceBinding']>((id, previous, next) => {
    const parsed = parseTriggerString(next)
    if (!parsed) {
      return { reason: 'invalid' }
    }
    const serialized = parsed.kind === 'keyboard'
      ? serializeKeyboardTrigger(parsed.code, parsed.modifiers)
      : serializeMouseTrigger(parsed.button, parsed.modifiers)
    const existingOwner = triggerMap.get(serialized)
    if (existingOwner && existingOwner !== id) {
      return { reason: 'conflict', conflictWith: existingOwner }
    }
    setBindings((prev) => {
      if (!prev[id].includes(previous)) {
        return prev
      }
      const nextBindings = cloneBindings(prev)
      nextBindings[id] = prev[id].map((binding) => (binding === previous ? serialized : binding))
      return nextBindings
    })
    toast({ title: 'Shortcut updated', description: `Mapped to ${formatTrigger(serialized)}.` })
    return null
  }, [triggerMap])

  const removeBinding = useCallback<ReaderKeymap['removeBinding']>((id, trigger) => {
    setBindings((prev) => {
      if (!prev[id].includes(trigger)) {
        return prev
      }
      const next = cloneBindings(prev)
      next[id] = prev[id].filter((value) => value !== trigger)
      return next
    })
  }, [])

  const resetAction = useCallback<ReaderKeymap['resetAction']>((id) => {
    setBindings((prev) => {
      const defaults = ACTIONS.find((action) => action.id === id)?.defaults
      if (!defaults) {
        return prev
      }
      const next = cloneBindings(prev)
      next[id] = [...defaults]
      return next
    })
  }, [])

  const resetAll = useCallback<ReaderKeymap['resetAll']>(() => {
    setBindings(getDefaultBindings())
  }, [])

  const exportToString = useCallback<ReaderKeymap['exportToString']>(() => {
    const payload: KeymapStorage = { version: KEYMAP_VERSION, bindings }
    return JSON.stringify(payload, null, 2)
  }, [bindings])

  const importFromString = useCallback<ReaderKeymap['importFromString']>((payload) => {
    try {
      const parsed = JSON.parse(payload) as KeymapStorage
      if (!parsed || typeof parsed !== 'object') {
        return { ok: false, error: 'Malformed keymap data.' }
      }
      if (parsed.version !== KEYMAP_VERSION) {
        return { ok: false, error: 'Incompatible keymap version.' }
      }
      const sanitized = sanitizeBindings(parsed.bindings)
      const map = buildTriggerMap(sanitized)
      if (map.size === 0) {
        return { ok: false, error: 'No bindings found in imported data.' }
      }
      setBindings(sanitized)
      return { ok: true }
    } catch (error) {
      console.warn('[keymap] Failed to import keymap', error)
      return { ok: false, error: error instanceof Error ? error.message : 'Failed to parse keymap JSON.' }
    }
  }, [])

  return useMemo(() => ({
    bindings,
    triggerMap,
    addBinding,
    replaceBinding,
    removeBinding,
    resetAction,
    resetAll,
    exportToString,
    importFromString
  }), [addBinding, bindings, exportToString, importFromString, removeBinding, replaceBinding, resetAction, resetAll, triggerMap])
}

export function resolveAction(trigger: string, triggerMap: Map<string, ActionId>) {
  return triggerMap.get(trigger)
}

export function isTextInputElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  if (target.isContentEditable) {
    return true
  }
  const tagName = target.tagName
  if (tagName === 'INPUT') {
    const input = target as HTMLInputElement
    const type = input.type
    if (!type) {
      return true
    }
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'color', 'range', 'date'].includes(type)
  }
  return tagName === 'TEXTAREA'
}

export function useKeymapEventBridge(triggerMap: Map<string, ActionId>, handlers: Partial<Record<ActionId, () => void>>) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return
      }
      if (isTextInputElement(event.target) && !event.ctrlKey && !event.metaKey) {
        return
      }
      const trigger = keyboardTriggerFromEvent(event)
      if (!trigger) {
        return
      }
      const owner = triggerMap.get(trigger)
      if (!owner) {
        return
      }
      const handler = handlers[owner]
      if (!handler) {
        return
      }
      event.preventDefault()
      handler()
    }

    const handlePointerUp = (event: PointerEvent) => {
      if (!event.isPrimary && event.pointerType !== 'mouse') {
        return
      }
      const trigger = mouseTriggerFromEvent(event)
      if (!trigger) {
        return
      }
      const owner = triggerMap.get(trigger)
      if (!owner) {
        return
      }
      const handler = handlers[owner]
      if (!handler) {
        return
      }
      event.preventDefault()
      handler()
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    window.addEventListener('pointerup', handlePointerUp, { capture: true })

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true } as EventListenerOptions)
      window.removeEventListener('pointerup', handlePointerUp, { capture: true } as EventListenerOptions)
    }
  }, [handlers, triggerMap])
}

export function formatCategory(category: ActionCategory) {
  switch (category) {
    case 'Navigation':
      return 'Navigation'
    case 'Layout':
      return 'Layout'
    case 'View':
      return 'View'
    case 'System':
      return 'System'
    default:
      return category
  }
}

export function keyboardEventToTrigger(event: KeyboardEvent) {
  return keyboardTriggerFromEvent(event)
}

export function pointerEventToTrigger(event: PointerEvent) {
  return mouseTriggerFromEvent(event)
}
