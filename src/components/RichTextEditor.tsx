import { useCallback, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import { FigureNode, GalleryNode, insertImages } from './media/editorNodes'
import { imageFilesFrom } from '../lib/images'

/**
 * Word-processor style editor for post bodies. Stores HTML, which is
 * sanitized again on render — see lib/markdown.ts.
 */

function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()} // keep the selection
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`grid size-8 place-items-center rounded-md text-sm transition disabled:opacity-40 ${
        active
          ? 'bg-navy-600 text-white'
          : 'hover:bg-[var(--surface)] text-[var(--ink)]'
      }`}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <span className="mx-1 h-6 w-px bg-[var(--line)]" aria-hidden />
}

function Toolbar({ editor }: { editor: Editor }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)

  const addLink = useCallback(() => {
    const previous = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('Link URL', previous ?? 'https://')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }, [editor])

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-[var(--line)] p-2">
      <select
        value={
          editor.isActive('heading', { level: 1 })
            ? 'h1'
            : editor.isActive('heading', { level: 2 })
              ? 'h2'
              : editor.isActive('heading', { level: 3 })
                ? 'h3'
                : 'p'
        }
        onChange={(e) => {
          const value = e.target.value
          if (value === 'p') editor.chain().focus().setParagraph().run()
          else {
            const level = Number(value.slice(1)) as 1 | 2 | 3
            editor.chain().focus().toggleHeading({ level }).run()
          }
        }}
        className="mr-1 rounded-md border border-[var(--line)] bg-transparent px-2 py-1 text-sm"
        aria-label="Text style"
      >
        <option value="p">Normal text</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
      </select>

      <Divider />

      <ToolbarButton
        title="Bold (Ctrl+B)"
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <strong>B</strong>
      </ToolbarButton>
      <ToolbarButton
        title="Italic (Ctrl+I)"
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <em>I</em>
      </ToolbarButton>
      <ToolbarButton
        title="Underline (Ctrl+U)"
        active={editor.isActive('underline')}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <span className="underline">U</span>
      </ToolbarButton>
      <ToolbarButton
        title="Strikethrough"
        active={editor.isActive('strike')}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <span className="line-through">S</span>
      </ToolbarButton>

      <Divider />

      <ToolbarButton
        title="Bulleted list"
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        •≡
      </ToolbarButton>
      <ToolbarButton
        title="Numbered list"
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        1≡
      </ToolbarButton>
      <ToolbarButton
        title="Quote"
        active={editor.isActive('blockquote')}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        ❝
      </ToolbarButton>

      <Divider />

      <ToolbarButton
        title="Align left"
        active={editor.isActive({ textAlign: 'left' })}
        onClick={() => editor.chain().focus().setTextAlign('left').run()}
      >
        ≡
      </ToolbarButton>
      <ToolbarButton
        title="Align centre"
        active={editor.isActive({ textAlign: 'center' })}
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
      >
        ☰
      </ToolbarButton>

      <Divider />

      <ToolbarButton title="Add link" active={editor.isActive('link')} onClick={addLink}>
        🔗
      </ToolbarButton>
      <ToolbarButton title="Insert photo — pick several to make a gallery" onClick={() => fileRef.current?.click()}>
        🖼️
      </ToolbarButton>
      <ToolbarButton title="Insert photo gallery — grids, collages, carousels…" onClick={() => galleryRef.current?.click()}>
        <svg viewBox="0 0 20 20" className="size-4 fill-current" aria-hidden>
          <rect x="1" y="1" width="8" height="8" rx="1.5" />
          <rect x="11" y="1" width="8" height="5" rx="1.5" />
          <rect x="11" y="8" width="8" height="11" rx="1.5" />
          <rect x="1" y="11" width="8" height="8" rx="1.5" />
        </svg>
      </ToolbarButton>
      <ToolbarButton
        title="Horizontal line"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        —
      </ToolbarButton>

      <Divider />

      <ToolbarButton
        title="Clear formatting"
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
      >
        ⌫
      </ToolbarButton>
      <ToolbarButton
        title="Undo (Ctrl+Z)"
        disabled={!editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
      >
        ↶
      </ToolbarButton>
      <ToolbarButton
        title="Redo (Ctrl+Y)"
        disabled={!editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
      >
        ↷
      </ToolbarButton>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        className="hidden"
        onChange={(e) => {
          insertImages(editor, Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        className="hidden"
        onChange={(e) => {
          insertImages(editor, Array.from(e.target.files ?? []), { gallery: true })
          e.target.value = ''
        }}
      />
    </div>
  )
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder = 'Write the story…',
}: {
  value: string
  onChange: (html: string) => void
  placeholder?: string
}) {
  // editorProps are fixed at creation; they reach the live editor via this.
  const editorRef = useRef<Editor | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Placeholder.configure({ placeholder }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Link.configure({ openOnClick: false, autolink: true }),
      FigureNode,
      GalleryNode,
    ],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: 'prose-club min-h-80 px-4 py-3 focus:outline-none',
      },
      // Photos pasted or dropped anywhere in the text become a photo (one)
      // or a gallery (several) right there.
      handlePaste: (_view, event) => {
        const files = imageFilesFrom(event.clipboardData)
        if (!files.length || !editorRef.current) return false
        event.preventDefault()
        insertImages(editorRef.current, files)
        return true
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false
        const files = imageFilesFrom(event.dataTransfer)
        if (!files.length || !editorRef.current) return false
        event.preventDefault()
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        insertImages(editorRef.current, files, { at })
        return true
      },
    },
    // The editor owns its own DOM; React must not try to render it during SSR.
    immediatelyRender: false,
  })

  editorRef.current = editor
  if (!editor) return null

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--card)]">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  )
}
