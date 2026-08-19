import DOMPurify from 'dompurify'
import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: true })

/**
 * Post bodies are written by officers, but they are still user input that
 * gets injected as HTML — always sanitize.
 */
export function renderMarkdown(body: string): string {
  const raw = marked.parse(body ?? '', { async: false })
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'p', 'br', 'hr', 'strong', 'em', 'del', 'code',
      'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'table', 'thead',
      'tbody', 'tr', 'th', 'td',
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'target', 'rel'],
  })
}
