import { realmPlugin, addExportVisitor$ } from '@mdxeditor/editor';
import { $isLineBreakNode } from 'lexical';
// MDXEditor 4.5.0 defaults to exporting a Lexical LineBreakNode as text LF.
// Hard breaks import as LineBreakNode; soft newlines stay inside TextNode.
// Override only that export path using the public extension API.
export const hardBreakPlugin = realmPlugin({
  init(realm) {
    realm.pub(addExportVisitor$, {
      priority: 10,
      testLexicalNode: $isLineBreakNode,
      visitLexicalNode: ({ mdastParent, actions }) => actions.appendToParent(mdastParent, { type: 'break' })
    });
  }
});
