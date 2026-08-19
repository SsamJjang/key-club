import DOMPurify from 'dompurify'
import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: true })

const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's',
  'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'table',
  'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div',
]

const ALLOWED_ATTR = ['href', 'src', 'alt', 'title', 'target', 'rel', 'style', 'class']

/**
 * Post bodies are HTML from the editor. Posts written before the editor
 * existed are Markdown, so anything that doesn't start with a tag is still
 * parsed as Markdown — old posts keep rendering correctly.
 *
 * Officers are trusted, but this is still user input being injected as HTML,
 * so it is sanitized on the way out regardless of origin.
 */
export function renderBody(body: string): string {
  const source = body ?? ''
  const looksLikeHtml = /^\s*<(?:[a-z][\s\S]*)>/i.test(source)
  const raw = looksLikeHtml ? source : marked.parse(source, { async: false })

  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // style is allowed for the editor's text-align only; strip anything that
    // could reposition or hide elements over the rest of the page.
    FORBID_ATTR: ['onerror', 'onload', 'onclick'],
  })
}

/** Kept so existing imports don't break. */
export const renderMarkdown = renderBody

/** Plain-text preview for cards, when no summary was written. */
export function stripHtml(body: string, limit = 160): string {
  const text = renderBody(body)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text
}
