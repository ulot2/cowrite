import { forwardRef } from 'react'
import { BlockNoteSchema, defaultBlockSpecs, type BlockNoteEditor } from '@blocknote/core'
import { createReactInlineContentSpec, FormattingToolbarController, SuggestionMenuController, type DefaultReactSuggestionItem } from '@blocknote/react'
import { BlockNoteView, components } from '@blocknote/mantine'

export type Person = { id: string; name: string; color?: string; image?: string | null }

// "@Bea" inside a comment. Stored as inline content with the user's id and name, so the
// name shows without a lookup and the object can see who was mentioned.
const Mention = createReactInlineContentSpec(
  { type: 'mention', propSchema: { user: { default: '' }, name: { default: '' } }, content: 'none' },
  { render: (props) => <span className="mention" data-user={props.inlineContent.props.user}>@{props.inlineContent.props.name}</span> },
)

// The comment editor's schema: one paragraph block, the default text styles, plus mentions.
export const commentSchema = BlockNoteSchema.create({ blockSpecs: { paragraph: defaultBlockSpecs.paragraph } }).extend({ inlineContentSpecs: { mention: Mention } })

// The members to offer after "@", filtered by what was typed.
const mentionItems = (people: Person[], editor: BlockNoteEditor<any, any, any>) => async (query: string): Promise<DefaultReactSuggestionItem[]> =>
  people.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8).map((p) => ({
    title: p.name,
    onItemClick: () => editor.insertInlineContent([{ type: 'mention', props: { user: p.id, name: p.name } }, ' ']),
  }))

// Same as the library's comment editor, with an "@" menu added. Passed in through the components
// context, which is how the UI package lets a piece be replaced.
const CommentEditor = (people: Person[]) => forwardRef<HTMLDivElement, React.ComponentProps<typeof components.Comments.Editor>>(
  function CommentEditorWithMentions({ className, autoFocus, onFocus, onBlur, editor, editable }, ref) {
    return (
      <BlockNoteView ref={ref} className={`${className ?? ""} with-mentions`} editor={editor} editable={editable} autoFocus={autoFocus} onFocus={onFocus} onBlur={onBlur}
        sideMenu={false} slashMenu={false} tableHandles={false} filePanel={false} formattingToolbar={false}>
        <FormattingToolbarController />
        {editable && <SuggestionMenuController triggerCharacter="@" getItems={mentionItems(people, editor)} minQueryLength={0} />}
      </BlockNoteView>
    )
  },
)

export const componentsWithMentions = (people: Person[]) => ({ ...components, Comments: { ...components.Comments, Editor: CommentEditor(people) } })
